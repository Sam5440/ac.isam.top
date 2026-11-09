#!/usr/bin/env node
/**
 * 题库数据管道入口：
 *
 *   node scripts/fetch.mjs [--abc N] [--cf N] [--backfill N]
 *                          [--translate-limit N] [--translate-only] [--no-translate]
 *
 * 流程（也是 GitHub Actions CI 的每次工作流）：
 *   1. 拉取 AtCoder(ABC) / Codeforces 元数据（比赛列表、题目清单、难度/评分）
 *   2. 扫描最近 --abc/--cf 场比赛：新比赛的题面全部抓取（含 HTML→Markdown）
 *   3. 回填：从最旧比赛开始，补抓历史上尚未拉取的 --backfill 道题面
 *   4. AI 翻译：所有有原文、无译文的题面（gpt-6.1-sol，见 scripts/lib/llm.mjs）
 *   5. 重建 data/index.json
 *
 * 本地：node scripts/fetch.mjs --abc 10 --cf 10 --backfill 0   （初始化）
 * CI  ：node scripts/fetch.mjs --abc 3 --cf 3 --backfill 10
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  atcoderContestUrl,
  atcoderProblemUrl,
  fetchAtCoderContests,
  fetchAtCoderModels,
  fetchAtCoderProblems,
  fetchAtCoderStatement,
  ratedRange,
} from './lib/atcoder.mjs';
import {
  cfContestUrl,
  cfProblemUrl,
  closeCfBrowser,
  fetchCfContestHtml,
  fetchCfContests,
  fetchCfProblemset,
  getCfPage,
  parseCfProblemsPage,
} from './lib/cf.mjs';
import { llmConfig, translateStatement, translateTitles } from './lib/llm.mjs';
import {
  fetchNowcoderContests,
  fetchNowcoderProblemList,
  fetchNowcoderStatement,
  isZhTitle,
  nowcoderProblemUrl,
} from './lib/nowcoder.mjs';
import { loadProblem, problemComplete, saveProblem, upsertContest } from './lib/store.mjs';
import { buildIndex } from './build-index.mjs';
import { loadEnv, log, pLimit, parseArgs, rnd, sleep } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
const SCAN_ABC = args.abc ?? Number(process.env.ABC_SCAN ?? 3);
const SCAN_ARC = args.arc ?? Number(process.env.ARC_SCAN ?? 1);
const SCAN_AGC = args.agc ?? Number(process.env.AGC_SCAN ?? 1);
const SCAN_CF = args.cf ?? Number(process.env.CF_SCAN ?? 3);
const SCAN_NC = args.nc ?? Number(process.env.NC_SCAN ?? 2);
const BACKFILL = args.backfill ?? Number(process.env.BACKFILL ?? 10);
const TRANSLATE_LIMIT = args.translateLimit ?? Number(process.env.TRANSLATE_LIMIT ?? 0);
const TRANSLATE_ONLY = Boolean(args.translateOnly);
const NO_TRANSLATE = Boolean(args.noTranslate);

const DATA_ROOT = path.resolve(process.cwd(), 'data');
const nowIso = () => new Date().toISOString();

const summary = {
  atcoder: { contests: 0, problems: 0, backfilled: 0, errors: [] },
  codeforces: { contests: 0, problems: 0, backfilled: 0, errors: [] },
  nowcoder: { contests: 0, problems: 0, backfilled: 0, errors: [] },
  translated: 0,
  translateErrors: [],
};

/* ============================ AtCoder (ABC) ============================ */

async function runAtCoder() {
  log('atcoder', `拉取元数据（扫描 abc ${SCAN_ABC} / arc ${SCAN_ARC} / agc ${SCAN_AGC} 场，回填 ${BACKFILL} 题）…`);
  const [contests, allProblems, models] = await Promise.all([
    fetchAtCoderContests(),
    fetchAtCoderProblems(),
    fetchAtCoderModels(),
  ]);
  const problemsByContest = new Map();
  for (const p of allProblems) {
    (problemsByContest.get(p.contest_id) ?? problemsByContest.set(p.contest_id, []).get(p.contest_id)).push(p);
  }
  for (const list of problemsByContest.values()) {
    list.sort((a, b) => a.problem_index.localeCompare(b.problem_index, undefined, { numeric: true }));
  }
  const count = (re) => contests.filter((c) => re.test(c.id)).length;
  log(
    'atcoder',
    `已结束赛次 abc=${count(/^abc/)} arc=${count(/^arc/)} agc=${count(/^agc/)}（最新 ${contests[0]?.id}）`,
  );

  const contestMeta = (c) => ({
    id: c.id,
    platform: 'atcoder',
    title: c.title,
    startTime: new Date(c.start_epoch_second * 1000).toISOString(),
    durationSeconds: c.duration_second,
    ratedRange: ratedRange(c.rate_change),
    url: atcoderContestUrl(c.id),
    problems: (problemsByContest.get(c.id) ?? []).map((p) => p.id),
  });

  const fetchOne = async (c, p) => {
    try {
      const st = await fetchAtCoderStatement(c.id, p.id);
      saveProblem('atcoder', {
        id: p.id,
        platform: 'atcoder',
        contestId: c.id,
        index: p.problem_index,
        title: p.name,
        titleZh: null,
        url: atcoderProblemUrl(c.id, p.id),
        difficulty: models[p.id] ?? null,
        tags: [],
        ...(st.points != null ? { points: st.points } : {}),
        timeLimitMs: st.timeLimitMs,
        memoryLimitMb: st.memoryLimitMb,
        statementMd: st.statementMd,
        statementZhMd: null,
        samples: st.samples,
        language: st.language,
        fetchedAt: nowIso(),
      });
      return true;
    } catch (e) {
      summary.atcoder.errors.push(`${p.id}: ${e.message}`);
      log('atcoder', `✗ ${p.id} — ${e.message}`);
      return false;
    }
  };

  // 1) 最新 N 场（abc/arc/agc 各自取头部）：全部补齐
  const scanSet = [
    ...contests.filter((c) => /^abc/.test(c.id)).slice(0, SCAN_ABC),
    ...contests.filter((c) => /^arc/.test(c.id)).slice(0, SCAN_ARC),
    ...contests.filter((c) => /^agc/.test(c.id)).slice(0, SCAN_AGC),
  ];
  let fetched = 0;
  for (const c of scanSet) {
    const isNew = upsertContest('atcoder', contestMeta(c));
    if (isNew) {
      summary.atcoder.contests++;
      log('atcoder', `+ 比赛 ${c.id} — ${c.title}`);
    }
    const list = problemsByContest.get(c.id) ?? [];
    let newForContest = 0;
    for (const p of list) {
      if (problemComplete('atcoder', p.id)) continue;
      if (await fetchOne(c, p)) {
        fetched++;
        newForContest++;
      }
      await sleep(rnd(1200, 2200));
    }
    if (newForContest) log('atcoder', `  ${c.id}: 新增题面 ${newForContest}/${list.length}`);
  }
  summary.atcoder.problems = fetched;

  // 2) 回填：最旧比赛开始，补抓尚未收录的题面（abc/arc/agc 合并一条时间线）
  if (BACKFILL > 0) {
    let budget = BACKFILL;
    for (const c of [...contests].reverse()) {
      if (budget <= 0) break;
      const list = problemsByContest.get(c.id) ?? [];
      const missing = list.filter((p) => !problemComplete('atcoder', p.id));
      if (missing.length === 0) continue;
      upsertContest('atcoder', contestMeta(c));
      log('atcoder', `回填 ${c.id}（缺 ${missing.length} 题，预算 ${budget}）`);
      for (const p of missing) {
        if (budget <= 0) break;
        if (await fetchOne(c, p)) {
          summary.atcoder.backfilled++;
          budget--;
        }
        await sleep(rnd(1200, 2200));
      }
    }
  }
}

/* ============================== Codeforces ============================== */

async function fetchCfContestAll(c, problemset) {
  // 一次导航抓整场比赛题面；返回 {saved, total}
  const { page, ctx } = await getCfPage();
  try {
    const html = await fetchCfContestHtml(c.id, page);
    const parsed = parseCfProblemsPage(html, c.id);
    const meta = problemset.byContest[c.id] ?? [];
    const metaByIndex = new Map(meta.map((m) => [m.index, m]));
    const savedIds = [];
    for (const p of parsed) {
      const m = metaByIndex.get(p.index);
      const id = `${c.id}${p.index}`;
      // 保留已有译文（审查 2026-11-09 P1-8）：整场重抓的旧实现无条件把
      // titleZh/statementZhMd 置空 —— 一场比赛只要有一题解析失败,该场
      // 全部已完成题目的译文就被抹掉,下一轮再付费重译,循环往复（存量
      // 1331/2095 等场已实际触发）。合并保留 zh 字段与翻译元数据。
      const existing = loadProblem('codeforces', id);
      const zhKeep = existing?.statementZhMd
        ? {
            titleZh: existing.titleZh ?? null,
            statementZhMd: existing.statementZhMd,
            ...(existing.translatedAt ? { translatedAt: existing.translatedAt } : {}),
            ...(existing.translateModel ? { translateModel: existing.translateModel } : {}),
          }
        : { titleZh: null, statementZhMd: null };
      saveProblem('codeforces', {
        id,
        platform: 'codeforces',
        contestId: c.id,
        index: p.index,
        title: p.title,
        url: cfProblemUrl(c.id, p.index),
        difficulty: m?.rating ?? null,
        tags: m?.tags ?? [],
        ...(m?.points != null ? { points: m.points } : {}),
        ...(p.timeLimitMs != null ? { timeLimitMs: p.timeLimitMs } : {}),
        ...(p.memoryLimitMb != null ? { memoryLimitMb: p.memoryLimitMb } : {}),
        statementMd: p.statementMd,
        samples: p.samples,
        language: 'en',
        fetchedAt: nowIso(),
        ...zhKeep,
      });
      savedIds.push(id);
    }
    return { saved: savedIds.length, total: parsed.length, ids: savedIds };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function runCodeforces() {
  log('cf', `拉取元数据（扫描最近 ${SCAN_CF} 场，回填 ${BACKFILL} 题）…`);
  const [contests, problemset] = await Promise.all([fetchCfContests(), fetchCfProblemset()]);
  log('cf', `正式赛共 ${contests.length} 场（最新 #${contests[0]?.id}）`);

  const contestMeta = (c, extraIds = []) => {
    const ids = [
      ...new Set([...(problemset.byContest[c.id] ?? []).map((m) => `${c.id}${m.index}`), ...extraIds]),
    ];
    ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return {
      id: c.id,
      platform: 'codeforces',
      title: c.name,
      startTime: new Date(c.startTimeSeconds * 1000).toISOString(),
      durationSeconds: c.durationSeconds ?? null,
      ratedRange: null,
      url: cfContestUrl(c.id),
      problems: ids,
    };
  };

  const missingCount = (c) =>
    (problemset.byContest[c.id] ?? []).filter((m) => !problemComplete('codeforces', `${c.id}${m.index}`)).length;

  // 1) 最新 N 场
  let saved = 0;
  for (const c of contests.slice(0, SCAN_CF)) {
    const isNew = upsertContest('codeforces', contestMeta(c));
    if (isNew) {
      summary.codeforces.contests++;
      log('cf', `+ 比赛 #${c.id} — ${c.name}`);
    }
    if (missingCount(c) === 0) continue;
    try {
      const r = await fetchCfContestAll(c, problemset);
      saved += r.saved;
      if (r.ids.length) upsertContest('codeforces', contestMeta(c, r.ids));
      log('cf', `  #${c.id}: 抓到题面 ${r.saved}（页面共 ${r.total} 题）`);
    } catch (e) {
      summary.codeforces.errors.push(`#${c.id}: ${e.message}`);
      log('cf', `✗ #${c.id} — ${e.message}`);
    }
    await sleep(rnd(4500, 7000));
  }
  summary.codeforces.problems = saved;

  // 2) 回填：从最旧一场缺题面的比赛开始，整场抓取直至用完预算
  if (BACKFILL > 0) {
    let budget = BACKFILL;
    for (const c of [...contests].reverse()) {
      if (budget <= 0) break;
      const miss = missingCount(c);
      if (miss === 0) continue;
      try {
        const r = await fetchCfContestAll(c, problemset);
        if (r.ids.length) upsertContest('codeforces', contestMeta(c, r.ids));
        summary.codeforces.backfilled += r.saved;
        budget -= r.saved;
        log('cf', `回填 #${c.id}: 抓到 ${r.saved} 题（剩余预算 ${Math.max(0, budget)}）`);
      } catch (e) {
        summary.codeforces.errors.push(`#${c.id}(backfill): ${e.message}`);
        log('cf', `✗ #${c.id}(backfill) — ${e.message}`);
        // 连续失败的比赛跳过（下轮再试），避免卡死预算
      }
      await sleep(rnd(4500, 7000));
    }
  }
}

/* ================================ 牛客竞赛 ================================ */

async function runNowcoder() {
  log('nowcoder', `拉取官方比赛列表（扫描最近 ${SCAN_NC} 场，回填 ${BACKFILL} 题）…`);
  const contests = await fetchNowcoderContests(Math.max(3, Math.ceil((SCAN_NC + 2) / 4)));
  log('nowcoder', `已结束官方比赛 ${contests.length} 场（最新 ${contests[0]?.id} ${contests[0]?.title}）`);

  const fetchOne = async (c, p) => {
    try {
      const st = await fetchNowcoderStatement(c.id, p.index);
      saveProblem('nowcoder', {
        id: `nc${c.id}p${p.index.toLowerCase()}`,
        platform: 'nowcoder',
        contestId: c.id,
        index: p.index,
        title: p.title,
        // 中文题：译文存原文，翻译管线自动跳过；英文题面/英文标题（ICPC 系
        // 与部分月赛）置空，交翻译管线与站内 MT 兜底
        titleZh: st.language === 'zh' && isZhTitle(p.title) ? p.title : null,
        url: nowcoderProblemUrl(c.id, p.index),
        difficulty: null,
        tags: [],
        timeLimitMs: st.timeLimitMs,
        memoryLimitMb: st.memoryLimitMb,
        statementMd: st.statementMd,
        statementZhMd: st.statementZhMd,
        samples: st.samples,
        language: st.language,
        ...(st.statementZhMd ? { translateModel: '官方原文' } : {}),
        fetchedAt: nowIso(),
      });
      return true;
    } catch (e) {
      summary.nowcoder.errors.push(`${c.id}/${p.index}: ${e.message}`);
      log('nowcoder', `✗ ${c.id}/${p.index} — ${e.message}`);
      return false;
    }
  };

  const loadList = async (c) => {
    try {
      return await fetchNowcoderProblemList(c.id);
    } catch (e) {
      summary.nowcoder.errors.push(`#${c.id} problem-list: ${e.message}`);
      log('nowcoder', `✗ #${c.id} problem-list — ${e.message}`);
      return [];
    }
  };

  // 1) 最新 N 场：全部补齐（题面即中文，无需翻译）
  let fetched = 0;
  for (const c of contests.slice(0, SCAN_NC)) {
    const list = await loadList(c);
    const isNew = upsertContest('nowcoder', {
      id: c.id,
      platform: 'nowcoder',
      title: c.title,
      titleZh: c.title,
      startTime: c.startTime,
      durationSeconds: c.durationSeconds,
      ratedRange: null,
      url: c.url,
      problems: list.map((p) => `nc${c.id}p${p.index.toLowerCase()}`),
    });
    if (isNew) {
      summary.nowcoder.contests++;
      log('nowcoder', `+ 比赛 #${c.id} — ${c.title}`);
    }
    let newForContest = 0;
    for (const p of list) {
      if (problemComplete('nowcoder', `nc${c.id}p${p.index.toLowerCase()}`)) continue;
      if (await fetchOne(c, p)) {
        fetched++;
        newForContest++;
      }
      await sleep(rnd(900, 1600));
    }
    if (newForContest) log('nowcoder', `  #${c.id}: 新增题面 ${newForContest}/${list.length}`);
  }
  summary.nowcoder.problems = fetched;

  // 2) 回填：最旧比赛开始，补抓尚未收录的题面
  if (BACKFILL > 0) {
    let budget = BACKFILL;
    for (const c of [...contests].reverse()) {
      if (budget <= 0) break;
      const list = await loadList(c);
      const missing = list.filter((p) => !problemComplete('nowcoder', `nc${c.id}p${p.index.toLowerCase()}`));
      if (missing.length === 0) continue;
      upsertContest('nowcoder', {
        id: c.id,
        platform: 'nowcoder',
        title: c.title,
        titleZh: c.title,
        startTime: c.startTime,
        durationSeconds: c.durationSeconds,
        ratedRange: null,
        url: c.url,
        problems: list.map((p) => `nc${c.id}p${p.index.toLowerCase()}`),
      });
      log('nowcoder', `回填 #${c.id} ${c.title}（缺 ${missing.length} 题，预算 ${budget}）`);
      const done = [];
      for (const p of missing) {
        if (budget <= 0) break;
        if (await fetchOne(c, p)) {
          summary.nowcoder.backfilled++;
          budget--;
          done.push(`nc${c.id}p${p.index.toLowerCase()}`);
        }
        await sleep(rnd(900, 1600));
      }
      if (done.length) {
        const cur = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'nowcoder', 'contests.json'), 'utf8'));
        const row = cur.find((x) => String(x.id) === String(c.id));
        if (row) {
          row.problems = [...new Set([...(row.problems ?? []), ...done])];
          fs.writeFileSync(path.join(DATA_ROOT, 'nowcoder', 'contests.json'), JSON.stringify(cur, null, 2) + '\n');
        }
      }
    }
  }
}

/* ================================ 翻译 ================================ */

function collectProblems() {
  const out = [];
  for (const platform of ['atcoder', 'codeforces', 'nowcoder']) {
    const dir = path.join(DATA_ROOT, platform, 'problems');
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      } catch {}
    }
  }
  return out;
}

async function runTranslate() {
  const cfg = llmConfig();
  if (!cfg) {
    log('translate', '⚠ 未配置 TRANSLATE_BASE_URL / TRANSLATE_API_KEY，跳过翻译');
    return;
  }
  log('translate', `模型 ${cfg.model}，并发 ${process.env.TRANSLATE_CONCURRENCY ?? 4}`);

  // 1) 题面：新→旧（contestId 数字/字符串统一比较）
  const pending = collectProblems()
    .filter((p) => p.statementMd && !p.statementZhMd)
    .sort((a, b) => String(b.contestId).localeCompare(String(a.contestId), undefined, { numeric: true }));
  const limited = TRANSLATE_LIMIT > 0 ? pending.slice(0, TRANSLATE_LIMIT) : pending;
  if (limited.length) log('translate', `待翻译题面 ${limited.length}（共缺 ${pending.length}）`);

  const limit = pLimit(Number(process.env.TRANSLATE_CONCURRENCY ?? 4));
  let done = 0;
  await Promise.all(
    limited.map((p) =>
      limit(async () => {
        try {
          const { titleZh, bodyZh } = await translateStatement(cfg, {
            title: p.title,
            statementMd: p.statementMd,
          });
          saveProblem(p.platform, {
            ...p,
            titleZh,
            statementZhMd: bodyZh,
            translatedAt: nowIso(),
            translateModel: cfg.model,
          });
          done++;
          if (done % 10 === 0 || done === limited.length) {
            log('translate', `进度 ${done}/${limited.length}`);
          }
        } catch (e) {
          summary.translateErrors.push(`${p.id}: ${e.message}`);
          log('translate', `✗ ${p.id} — ${e.message}`);
        }
      }),
    ),
  );
  summary.translated = done;

  // 2) 比赛名（两平台合并批翻；牛客比赛名本就是中文，已存 titleZh 跳过）
  const todoTitles = [];
  for (const platform of ['atcoder', 'codeforces']) {
    for (const c of loadContestsList(platform)) {
      if (!c.titleZh) todoTitles.push({ platform, c });
    }
  }
  if (todoTitles.length && !NO_TRANSLATE) {
    log('translate', `待翻译比赛名 ${todoTitles.length}`);
    for (let i = 0; i < todoTitles.length; i += 20) {
      const batch = todoTitles.slice(i, i + 20);
      try {
        const zh = await translateTitles(cfg, batch.map((x) => x.c.title));
        batch.forEach((x, j) => {
          if (zh[j]) upsertContest(x.platform, { ...x.c, titleZh: zh[j] });
        });
      } catch (e) {
        log('translate', `✗ 比赛名批次 — ${e.message}`);
      }
    }
  }
}

function loadContestsList(platform) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_ROOT, platform, 'contests.json'), 'utf8'));
  } catch {
    return [];
  }
}

/* ================================= 主流程 ================================= */

async function main() {
  loadEnv();
  log('main', `开始：scan abc=${SCAN_ABC} arc=${SCAN_ARC} agc=${SCAN_AGC} cf=${SCAN_CF} nc=${SCAN_NC}，backfill=${BACKFILL}，translateLimit=${TRANSLATE_LIMIT}${TRANSLATE_ONLY ? '（仅翻译）' : ''}`);

  // 平台间故障隔离（审查 管线-7）：旧实现单平台元数据失败让整轮（含翻译）
  // 作废,且 buildIndex 在 try 外 —— 异常路径连索引都不重建。改为每平台
  // 独立捕获,任何阶段失败都不阻断其余平台;buildIndex 移入 finally。
  const stages = [
    ['atcoder', () => runAtCoder()],
    ['codeforces', () => runCodeforces()],
    ['nowcoder', () => runNowcoder()],
  ];
  try {
    if (!TRANSLATE_ONLY) {
      for (const [name, fn] of stages) {
        try {
          await fn();
        } catch (e) {
          summary[name] = summary[name] || {};
          summary[name].errors = [...(summary[name].errors || []), String(e?.message || e)];
          log(name, `✗ 阶段失败（其余平台继续）：${e?.message || e}`);
        }
      }
    }
    if (!NO_TRANSLATE) {
      try {
        await runTranslate();
      } catch (e) {
        log('translate', `✗ 翻译阶段失败（已抓数据仍会提交）：${e?.message || e}`);
      }
    }
  } finally {
    await closeCfBrowser();
    buildIndex();
  }

  log('main', '完成', JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
