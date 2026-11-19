#!/usr/bin/env node
/**
 * 题库数据管道入口：
 *
 *   node scripts/fetch.mjs [--abc N] [--cf N] [--backfill N]
 *                          [--translate-limit N] [--translate-only] [--no-translate]
 *                          [--notes-limit N] [--notes-platforms atcoder]
 *                          [--gym-pages N] [--gym-minutes N] [--gym-sweep N]
 *                          [--gym-translate-limit N] [--no-gyms]
 *
 * 流程（也是 GitHub Actions CI 的每次工作流）：
 *   0. 拉取 Clist 前 30 天～后 60 天比赛，写 data/clist.json 供日历与首页只读使用
 *   1. 拉取 AtCoder(ABC) / Codeforces / 牛客元数据（比赛列表、题目清单、难度/评分）
 *   2. 扫描最近 --abc/--cf/--nc 场比赛：新比赛的题面全部抓取（含 HTML→Markdown）
 *   3. 回填：从最旧比赛开始，补抓历史上尚未拉取的 --backfill 道题面
 *   4. AI 翻译：所有有原文、无译文的题面（gpt-6.1-sol，见 scripts/lib/llm.mjs）
 *      4b. 样例说明翻译（2026-11-17 起）：samples[].note → noteZh。AtCoder 的
 *          样例解释不在 statementMd 里，题面翻译覆盖不到，需单独一轮（默认只
 *          atcoder、--notes-limit 60 题/轮；0 关闭、负数不限）。
 *   5. cf-gyms 尾阶段（2026-11-15 起）：三平台「拉取+翻译」全部完成之后，
 *      子进程调用 scripts/fetch-cf-gyms.mjs --mode problems 做小预算题面回填，
 *      随后把 gym 缺译题面并入 CI 翻译（reuseOf 存根无原文天然跳过；
 *      PDF 题面用 pdftotext 提取文本，同样可译）。--no-gyms 可整体跳过。
 *   6. 重建 data/index.json
 *
 * 本地：node scripts/fetch.mjs --abc 10 --cf 10 --backfill 0   （初始化）
 * CI  ：node scripts/fetch.mjs --abc 3 --cf 3 --backfill 10
 */

import { spawn } from 'node:child_process';
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
import {
  llmConfig,
  pingLLM,
  translateSampleNotes,
  translateStatement,
  translateTitles,
} from './lib/llm.mjs';
import {
  applyNoteTranslations,
  meaningfulNote,
  needsNotesTranslation,
  pendingNoteIndices,
} from '../lib/sample-notes.js';
import {
  fetchNowcoderContests,
  fetchNowcoderProblemList,
  fetchNowcoderStatement,
  isZhTitle,
  nowcoderProblemUrl,
} from './lib/nowcoder.mjs';
import { loadProblem, problemComplete, saveProblem, upsertContest } from './lib/store.mjs';
import { buildIndex } from './build-index.mjs';
import { buildBackfillSummary, writeRunRecord } from './lib/ci-log.mjs';
import { updateClistSnapshot } from './lib/clist.mjs';
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
// cf-gyms 尾阶段预算（三平台拉取+翻译全部完成之后执行；见 runGymPhase）
const GYM_PAGES = args.gymPages ?? Number(process.env.GYM_PAGES ?? 60);
const GYM_MINUTES = args.gymMinutes ?? Number(process.env.GYM_MINUTES ?? 10);
const GYM_SWEEP = args.gymSweep ?? Number(process.env.GYM_SWEEP ?? 0);
const GYM_TRANSLATE_LIMIT = args.gymTranslateLimit ?? Number(process.env.GYM_TRANSLATE_LIMIT ?? 60);
const NO_GYMS = Boolean(args.noGyms);
// 样例说明（samples[].note → noteZh）翻译预算：与题面分开计（说明很短，按题计）。
// 0 = 不翻 / 负数 = 不限。默认只 atcoder：CF 的说明在正文 Note 小节随题面翻，
// 牛客题面本就是中文；cf-gyms 的 samples.note 多是 PDF/模板残留。
const NOTES_TRANSLATE_LIMIT = args.notesLimit ?? Number(process.env.NOTES_TRANSLATE_LIMIT ?? 60);
const NOTES_PLATFORMS = new Set(
  String(args.notesPlatforms ?? process.env.NOTES_PLATFORMS ?? 'atcoder')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const DATA_ROOT = path.resolve(process.cwd(), 'data');
const nowIso = () => new Date().toISOString();

const summary = {
  atcoder: { contests: 0, problems: 0, backfilled: 0, errors: [] },
  codeforces: { contests: 0, problems: 0, backfilled: 0, errors: [] },
  nowcoder: { contests: 0, problems: 0, backfilled: 0, errors: [] },
  'cf-gyms': { contests: 0, problems: 0, backfilled: 0, errors: [] },
  translated: 0,
  notesTranslated: 0,
  notesQueue: 0,
  notesAttempted: 0,
  translateErrors: [],
};

/* ===================== CI 运行记录（data/ci-log.json） ===================== */

// 本轮逐题结果（写 /ci 抓取日志页用）：按主流程实际触达的抓取/翻译点记录，
// 未逐题覆盖的批量路径（如 CF 整场抓取）按场次聚合在 stats 里。
const runRecord = {
  startedAt: nowIso(),
  trigger: process.env.GITHUB_EVENT_NAME || 'manual',
  fetched: [], // {platform, problemId, title, status: 'fetched'|'translated'|'skipped'|'failed'}
  errors: [], // {scope, message}
};
const recordFetch = (platform, problemId, title, status) => {
  if (runRecord.fetched.length < 500) {
    runRecord.fetched.push({ platform, problemId, title, status });
  }
};
const recordError = (scope, message) => {
  runRecord.errors.push({ scope: String(scope), message: String(message).slice(0, 500) });
};

/** 汇总本轮结果并写 data/ci-log.json（任何失败都不影响主流程）。 */
function writeCiLog() {
  try {
    const failures = [];
    for (const platform of ['atcoder', 'codeforces', 'nowcoder', 'cf-gyms']) {
      for (const line of summary[platform].errors) {
        // 行格式：`<problemId>: <message>` / `<contestId>/<index>: <message>`
        const i = line.indexOf(':');
        const problemId = i > 0 ? line.slice(0, i).trim() : line;
        failures.push({
          platform,
          problemId,
          message: line.slice(i + 1).trim() || line,
        });
        recordError(platform, line);
      }
    }
    for (const line of summary.translateErrors) {
      recordError('translate', line);
    }
    const translated = summary.translated;
    const translatedIds = new Set(
      runRecord.fetched.filter((x) => x.status === 'translated').map((x) => `${x.platform}:${x.problemId}`),
    );
    const stats = {
      new:
        summary.atcoder.problems +
        summary.codeforces.problems +
        summary.nowcoder.problems +
        summary['cf-gyms'].problems,
      updated:
        summary.atcoder.backfilled +
        summary.codeforces.backfilled +
        summary.nowcoder.backfilled +
        summary['cf-gyms'].backfilled,
      failed: failures.length,
      translated,
    };
    // 平台拆分（/ci 图表与明细用）：每平台 新抓/回填/失败/场次
    const platforms = {};
    for (const platform of ['atcoder', 'codeforces', 'nowcoder', 'cf-gyms']) {
      const s = summary[platform];
      platforms[platform] = {
        contests: s.contests || 0,
        new: s.problems || 0,
        updated: s.backfilled || 0,
        failed: (s.errors || []).length,
      };
    }
    const backfill = buildBackfillSummary(failures);
    writeRunRecord({
      startedAt: runRecord.startedAt,
      durationMs: Date.now() - new Date(runRecord.startedAt).getTime(),
      trigger: runRecord.trigger,
      // GitHub Actions 上下文（本地运行时为 null，页面降级不显示）
      runId: Number(process.env.GITHUB_RUN_ID) || null,
      sha: (process.env.GITHUB_SHA || '').slice(0, 7) || null,
      fetched: runRecord.fetched.map((x) =>
        // 本轮新抓的题面若随后被翻译，状态记为 translated（fetched 是其前置）
        translatedIds.has(`${x.platform}:${x.problemId}`) ? { ...x, status: 'translated' } : x,
      ),
      stats: {
        ...stats,
        translated: stats.translated,
        pendingCount: backfill.pendingCount,
      },
      platforms,
      translateQueue: summary.translateQueue ?? null,
      translateAttempted: summary.translateAttempted ?? null,
      notesQueue: summary.notesQueue ?? null,
      notesTranslated: summary.notesTranslated ?? 0,
      incomplete: backfill.incomplete,
      nextPlan: backfill.nextPlan,
      errors: runRecord.errors.slice(-50),
    });
    log('ci-log', '运行记录已写入 data/ci-log.json');
  } catch (e) {
    log('ci-log', `⚠ 运行记录生成失败（不影响抓取数据）：${e?.message || e}`);
  }
}

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
      recordFetch('atcoder', p.id, p.name, 'fetched');
      return true;
    } catch (e) {
      summary.atcoder.errors.push(`${p.id}: ${e.message}`);
      log('atcoder', `✗ ${p.id} — ${e.message}`);
      recordFetch('atcoder', p.id, p.name, 'failed');
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
      recordFetch('codeforces', id, p.title, 'fetched');
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
    const pid = `nc${c.id}p${p.index.toLowerCase()}`;
    try {
      const st = await fetchNowcoderStatement(c.id, p.index);
      saveProblem('nowcoder', {
        id: pid,
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
      // 中文题面译文即原文：翻译管线会跳过，直接记 skipped
      recordFetch('nowcoder', pid, p.title, st.statementZhMd ? 'skipped' : 'fetched');
      return true;
    } catch (e) {
      summary.nowcoder.errors.push(`${c.id}/${p.index}: ${e.message}`);
      log('nowcoder', `✗ ${c.id}/${p.index} — ${e.message}`);
      recordFetch('nowcoder', pid, p.title, 'failed');
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

function collectProblems(platforms = ['atcoder', 'codeforces', 'nowcoder']) {
  const out = [];
  for (const platform of platforms) {
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

/**
 * AI 翻译阶段。platforms/translateLimit 可参数化：主管道默认三平台；
 * cf-gyms 尾阶段用 { platforms: ['cf-gyms'], translateLimit: GYM_TRANSLATE_LIMIT }
 * 单独调用（2026-11-15 起 gym 题默认走 CI 翻译）。reuseOf 存根没有 statementMd，
 * 天然不进队列；PDF 题面的 pdftotext 提取文本同样可译。
 */
async function runTranslate({ platforms = ['atcoder', 'codeforces', 'nowcoder'], translateLimit = TRANSLATE_LIMIT } = {}) {
  const cfg = llmConfig();
  if (!cfg) {
    log('translate', '⚠ 未配置 TRANSLATE_BASE_URL / TRANSLATE_API_KEY，跳过翻译');
    return;
  }
  log('translate', `模型 ${cfg.model}，并发 ${process.env.TRANSLATE_CONCURRENCY ?? 4}`);

  // 鉴权探活（2026-10-31~11-03 三轮 CI 教训：key 失效时并发池把整批题逐一
  // 打满 401——每轮几百次无效请求、几十分钟白跑）。批量前先 1 次最小请求
  // 探活：401/403 立即中止整轮翻译并给出轮换指引；其余错误（网络抖动等）
  // 视为临时故障只告警，逐题路径自带重试。
  try {
    await pingLLM(cfg);
  } catch (e) {
    if (/HTTP 40[13]/.test(e.message)) {
      throw new Error(
        `TRANSLATE_API_KEY 无效（${e.message.slice(0, 140)}）——到 GitHub Secrets 轮换后重跑，本轮翻译全部中止`,
      );
    }
    log('translate', `⚠ 探活未通过（${e.message.slice(0, 140)}），按临时故障继续逐题翻译`);
  }

  // 逐题路径的鉴权中止标志：任一 worker 收到 401/403 即置位，并发池剩余
  // 任务直接跳过，不再向失效端点发请求（探活通过但 key 中途被撤销的场景）。
  let authAborted = false;

  // 1) 题面：新→旧（contestId 数字/字符串统一比较）
  const pending = collectProblems(platforms)
    .filter((p) => p.statementMd && !p.statementZhMd)
    .sort((a, b) => String(b.contestId).localeCompare(String(a.contestId), undefined, { numeric: true }));
  const limited = translateLimit > 0 ? pending.slice(0, translateLimit) : pending;
  if (limited.length) log('translate', `待翻译题面 ${limited.length}（共缺 ${pending.length}）`);
  // CI 日志记录翻译队列规模（/ci 页「翻译积压」统计用）。
  // 多次调用（三平台 + gym 尾阶段）累加，避免后者覆盖前者的数字。
  summary.translateQueue = (summary.translateQueue ?? 0) + pending.length;
  summary.translateAttempted = (summary.translateAttempted ?? 0) + limited.length;

  const limit = pLimit(Number(process.env.TRANSLATE_CONCURRENCY ?? 4));
  let done = 0;
  await Promise.all(
    limited.map((p) =>
      limit(async () => {
        if (authAborted) {
          summary.translateErrors.push(`${p.id}: skipped（鉴权失败，剩余任务跳过）`);
          return;
        }
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
          recordFetch(p.platform, p.id, titleZh || p.title, 'translated');
          done++;
          if (done % 10 === 0 || done === limited.length) {
            log('translate', `进度 ${done}/${limited.length}`);
          }
        } catch (e) {
          summary.translateErrors.push(`${p.id}: ${e.message}`);
          log('translate', `✗ ${p.id} — ${e.message}`);
          if (/HTTP 40[13]/.test(e.message)) {
            authAborted = true;
            log('translate', '✗ 鉴权失败（401/403），中止本轮剩余翻译');
          }
        }
      }),
    ),
  );
  summary.translated += done;

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
      if (authAborted) {
        log('translate', '✗ 鉴权已失败，剩余比赛名批次跳过');
        break;
      }
      const batch = todoTitles.slice(i, i + 20);
      try {
        const zh = await translateTitles(cfg, batch.map((x) => x.c.title));
        batch.forEach((x, j) => {
          if (zh[j]) upsertContest(x.platform, { ...x.c, titleZh: zh[j] });
        });
      } catch (e) {
        log('translate', `✗ 比赛名批次 — ${e.message}`);
        if (/HTTP 40[13]/.test(e.message)) {
          authAborted = true;
          log('translate', '✗ 鉴权失败（401/403），中止剩余比赛名批次');
        }
      }
    }
  }

  // 3) 样例说明（samples[].note → noteZh）：AtCoder 的样例解释挂在「Sample
  //    Output N」小节末尾，抓取时被摘进 samples[].note —— 不在 statementMd
  //    里，题面翻译永远覆盖不到（2026-11-17 补）。平台默认只 atcoder（见
  //    NOTES_PLATFORMS）：CF 的说明在正文 Note 小节随题面翻，牛客本就中文。
  const notesTargets = platforms.filter((pl) => NOTES_PLATFORMS.has(pl));
  if (!NO_TRANSLATE && notesTargets.length && NOTES_TRANSLATE_LIMIT !== 0) {
    const pendingNotes = collectProblems(notesTargets)
      .filter(needsNotesTranslation)
      .sort((a, b) => String(b.contestId).localeCompare(String(a.contestId), undefined, { numeric: true }));
    const limitedNotes = NOTES_TRANSLATE_LIMIT > 0 ? pendingNotes.slice(0, NOTES_TRANSLATE_LIMIT) : pendingNotes;
    summary.notesQueue = (summary.notesQueue ?? 0) + pendingNotes.length;
    summary.notesAttempted = (summary.notesAttempted ?? 0) + limitedNotes.length;
    if (limitedNotes.length) {
      log('translate', `待翻译样例说明 ${limitedNotes.length} 题（共缺 ${pendingNotes.length}）`);
    }
    let notesDone = 0;
    await Promise.all(
      limitedNotes.map((p) =>
        limit(async () => {
          if (authAborted) return;
          const indices = pendingNoteIndices(p.samples);
          if (!indices.length) return;
          try {
            const zh = await translateSampleNotes(cfg, {
              title: p.title,
              notes: indices.map((i) => meaningfulNote(p.samples[i].note)),
            });
            saveProblem(p.platform, {
              ...p,
              samples: applyNoteTranslations(p.samples, indices, zh),
              noteTranslatedAt: nowIso(),
              noteTranslateModel: cfg.model,
            });
            summary.notesTranslated = (summary.notesTranslated ?? 0) + indices.length;
            notesDone++;
            if (notesDone % 10 === 0 || notesDone === limitedNotes.length) {
              log('translate', `样例说明进度 ${notesDone}/${limitedNotes.length}`);
            }
          } catch (e) {
            summary.translateErrors.push(`${p.id} (notes): ${e.message}`);
            log('translate', `✗ ${p.id} 样例说明 — ${e.message}`);
            if (/HTTP 40[13]/.test(e.message)) authAborted = true;
          }
        }),
      ),
    );
  }
}

function loadContestsList(platform) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_ROOT, platform, 'contests.json'), 'utf8'));
  } catch {
    return [];
  }
}

/* ====================== cf-gyms 尾阶段（三平台完成之后） ====================== */

/**
 * 子进程跑 scripts/fetch-cf-gyms.mjs（自执行脚本，import 即跑 main()，只能
 * 子进程复用）：自带浏览器会话 / Cloudflare 质询 / 重试账本 / 分钟预算。
 * stdout 逐行透传到父进程日志（CI 可见质询与逐场进度），同时返回全文供聚合。
 * 超时先 SIGTERM（gym 脚本存档退出：完成当前题面 → 保存 attempts/state），
 * 60s 仍不退再 SIGKILL。
 */
function spawnGymPull() {
  const childArgs = [
    'scripts/fetch-cf-gyms.mjs',
    '--mode',
    'problems',
    '--max-problem-pages',
    String(GYM_PAGES),
    '--minutes',
    String(GYM_MINUTES),
    '--sweep-limit',
    String(GYM_SWEEP),
    '--login',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      // 未显式指定时有头（CI 走 xvfb）——Cloudflare 质询通过率最高
      env: { ...process.env, CF_HEADLESS: process.env.CF_HEADLESS ?? '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const feed = (chunk) => {
      const text = String(chunk);
      out += text;
      if (out.length > 64 * 1024 * 1024) out = out.slice(-32 * 1024 * 1024); // 防长跑爆内存
      console.log(text.trimEnd());
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    const grace = setTimeout(() => {
      log('cf-gyms', `⏱ 子进程超过 ${(GYM_MINUTES + 5) * 60_000 / 60000} 分钟预算上限，SIGTERM 存档退出`);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 60_000).unref?.();
    }, (GYM_MINUTES + 5) * 60_000);
    child.on('close', (code) => {
      clearTimeout(grace);
      if (code === 0) resolve(out);
      else reject(new Error(`gym 子进程退出码 ${code}（日志见上）`));
    });
    child.on('error', (e) => {
      clearTimeout(grace);
      reject(e);
    });
  });
}

/**
 * cf-gyms 尾阶段（2026-11-15）：三平台的拉取与翻译全部完成之后才执行——
 * gym 题的回填与 CI 翻译排最低优先级，不与三平台抢预算/额度。
 * 大批量回填与 ID 区间补扫仍由每日 fetch-cf-gyms.yml 承担，这里只做小预算。
 * 已知小缺口（不处理）：子进程读到的 data/index.json 是上一轮快照，
 * reuseOf 题名匹配索引略旧，极小概率让本应复用的题重复拉题面，下轮自愈。
 */
async function runGymPhase() {
  if (TRANSLATE_ONLY || NO_GYMS) return;
  const gymSummary = summary['cf-gyms'];

  // 1) 题面回填（小预算子进程）
  log('cf-gyms', `尾阶段：题面回填（pages=${GYM_PAGES} minutes=${GYM_MINUTES} sweep=${GYM_SWEEP}）…`);
  try {
    const stdout = await spawnGymPull();
    // 从子进程日志聚合新题数（gym/<id>: fetched=N total=M）
    let fetched = 0;
    for (const m of stdout.matchAll(/gym\/(\d+): fetched=(\d+)/g)) fetched += Number(m[2]);
    gymSummary.problems = fetched;
    log('cf-gyms', `尾阶段回填完成：新题面 ${fetched}`);
  } catch (e) {
    // 超时 / 质询风暴 / 非零退出都到这里：子进程已自行存档，下轮续跑无缝
    gymSummary.errors.push(String(e?.message || e).slice(0, 300));
    log('cf-gyms', `⚠ 回填子进程提前结束（成果已存档，翻译继续）：${e?.message || e}`);
  }

  // 2) gym 缺译题面并入 CI 翻译（历史 PDF 提取文本的题也在队列里）
  if (!NO_TRANSLATE) {
    try {
      await runTranslate({ platforms: ['cf-gyms'], translateLimit: GYM_TRANSLATE_LIMIT });
    } catch (e) {
      gymSummary.errors.push(String(e?.message || e).slice(0, 300));
      log('cf-gyms', `✗ gym 翻译失败（不影响已抓数据）：${e?.message || e}`);
    }
  }
}

/* ================================= 主流程 ================================= */

async function main() {
  loadEnv();
  log(
    'main',
    `开始：scan abc=${SCAN_ABC} arc=${SCAN_ARC} agc=${SCAN_AGC} cf=${SCAN_CF} nc=${SCAN_NC}，backfill=${BACKFILL}，translateLimit=${TRANSLATE_LIMIT}，notesLimit=${NOTES_TRANSLATE_LIMIT}${TRANSLATE_ONLY ? '（仅翻译）' : ''}${NO_GYMS ? '，gym=off' : `，gym 尾阶段 pages=${GYM_PAGES} minutes=${GYM_MINUTES} translateLimit=${GYM_TRANSLATE_LIMIT}`}`,
  );

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
      try {
        await updateClistSnapshot();
      } catch (e) {
        recordError('clist', e?.message || e);
        log('clist', `✗ 日程快照更新失败（保留上一份，其余平台继续）：${e?.message || e}`);
      }
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
        // translate-only（npm run translate）模式没有拉取阶段，gym 题一并纳入
        // （gym 默认走 CI 翻译）；常规轮次三平台先行，gym 留给下面的尾阶段。
        await runTranslate(
          TRANSLATE_ONLY ? { platforms: ['atcoder', 'codeforces', 'nowcoder', 'cf-gyms'] } : undefined,
        );
      } catch (e) {
        log('translate', `✗ 翻译阶段失败（已抓数据仍会提交）：${e?.message || e}`);
      }
    }
    // cf-gyms 尾阶段（2026-11-15）：gym 题面回填与翻译排在三平台全部完成之后
    if (!TRANSLATE_ONLY && !NO_GYMS) {
      try {
        await runGymPhase();
      } catch (e) {
        log('cf-gyms', `✗ gym 阶段失败（其余成果仍会提交）：${e?.message || e}`);
      }
    }
  } finally {
    await closeCfBrowser();
    buildIndex();
    // 运行记录最后写（耗时才完整）；写失败不影响抓取数据（writeCiLog 内部兜底）
    writeCiLog();
  }

  log('main', '完成', JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
