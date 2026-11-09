#!/usr/bin/env node
/**
 * 持续回填模式（手动启动，直到手动停止）：
 *
 *   node scripts/backfill-all.mjs [--budget N] [--pause S] [--max-attempts N]
 *
 * 每一轮（cycle）依次处理三个平台：从最新的比赛倒序往历史方向补抓缺失
 * 题面（每平台每轮预算 --budget 道题），随后把本轮新题面交给 AI 翻译
 * （牛客题面为中文，自动跳过），重建索引并提交推送（Vercel 自动部署），
 * 休息 --pause 秒后进入下一轮；一轮走完整个历史后重新开始（期间比赛
 * 列表会重新拉取，新比赛会被补上）。
 *
 * 每道题目最多拉取 --max-attempts 遍（跨轮次记忆，存 data/.attempts.json），
 * 连续失败 3 次的题面不再重试。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  atcoderContestUrl,
  atcoderProblemUrl,
  fetchAtCoderContests,
  fetchAtCoderModels,
  fetchAtCoderProblems,
  fetchAtCoderStatement,
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
  fetchNowcoderContests,
  fetchNowcoderProblemList,
  fetchNowcoderStatement,
  isZhTitle,
  nowcoderContestUrl,
  nowcoderProblemUrl,
  scanNowcoderContestsById,
} from './lib/nowcoder.mjs';
import { llmConfig, pingLLM, translateStatement, translateTitles } from './lib/llm.mjs';
import { loadProblem, problemComplete, saveProblem, upsertContest } from './lib/store.mjs';
import { buildIndex } from './build-index.mjs';
import { loadEnv, log, parseArgs, pLimit, rnd, sleep } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
const BUDGET = args.budget ?? Number(process.env.BACKFILL_BUDGET ?? 80);
const MAX_ATTEMPTS = args.maxAttempts ?? 3;
const PAUSE_MS = (args.pause ?? 30) * 1000;

const ROOT = path.resolve(process.cwd(), 'data');
const ATTEMPTS_FILE = path.join(ROOT, '.attempts.json');
const STATE_FILE = path.join(ROOT, '.backfill-state.json');

const nowIso = () => new Date().toISOString();

/* ---------------- attempts 记账（跨轮次持久化） ---------------- */

let attempts = {};
try {
  attempts = JSON.parse(fs.readFileSync(ATTEMPTS_FILE, 'utf8'));
} catch {}

const attemptsOf = (platform, pid) => attempts[`${platform}:${pid}`] ?? 0;
const bump = (platform, pid) => {
  attempts[`${platform}:${pid}`] = attemptsOf(platform, pid) + 1;
};
const saveAttempts = () => {
  fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify(attempts, null, 1) + '\n');
};

/** 试图拉取一道题（记一次尝试）；返回是否成功。 */
async function tryProblem(platform, pid, fn) {
  if (attemptsOf(platform, pid) >= MAX_ATTEMPTS) return false;
  bump(platform, pid);
  try {
    await fn();
    return true;
  } catch (e) {
    log(platform, `✗ ${pid}（第 ${attemptsOf(platform, pid)} 次尝试）— ${e.message}`);
    return false;
  } finally {
    if (Object.keys(attempts).length % 10 === 0) saveAttempts();
  }
}

/* ---------------- AtCoder ---------------- */

async function backfillAtCoder(budget) {
  const [contests, allProblems, models] = await Promise.all([
    fetchAtCoderContests(),
    fetchAtCoderProblems(),
    fetchAtCoderModels(),
  ]);
  const byContest = new Map();
  for (const p of allProblems) {
    (byContest.get(p.contest_id) ?? byContest.set(p.contest_id, []).get(p.contest_id)).push(p);
  }
  for (const list of byContest.values()) {
    list.sort((a, b) => a.problem_index.localeCompare(b.problem_index, undefined, { numeric: true }));
  }
  log('atcoder', `元数据就绪（${contests.length} 场，预算 ${budget}），从最新往历史回填`);

  const fetchOne = async (c, p) => {
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
  };

  let left = budget;
  let done = 0;
  for (const c of contests) {
    if (left <= 0) break;
    const list = byContest.get(c.id) ?? [];
    const missing = list.filter(
      (p) => !problemComplete('atcoder', p.id) && attemptsOf('atcoder', p.id) < MAX_ATTEMPTS,
    );
    if (missing.length === 0) continue;
    upsertContest('atcoder', {
      id: c.id,
      platform: 'atcoder',
      title: c.title,
      startTime: new Date(c.start_epoch_second * 1000).toISOString(),
      durationSeconds: c.duration_second,
      url: atcoderContestUrl(c.id),
      problems: list.map((p) => p.id),
    });
    for (const p of missing) {
      if (left <= 0) break;
      const ok = await tryProblem('atcoder', p.id, async () => fetchOne(c, p));
      if (ok) {
        done++;
        left--;
      }
      await sleep(rnd(1100, 1900));
    }
  }
  log('atcoder', `本轮新抓 ${done} 道`);
  return done;
}

/* ---------------- Codeforces ---------------- */

async function backfillCf(budget) {
  const [contests, problemset] = await Promise.all([fetchCfContests(), fetchCfProblemset()]);
  log('cf', `元数据就绪（${contests.length} 场，预算 ${budget}），从最新往历史回填`);

  let left = budget;
  let done = 0;
  for (const c of contests) {
    if (left <= 0) break;
    const meta = problemset.byContest[c.id] ?? [];
    const missing = meta.filter(
      (m) => !problemComplete('codeforces', `${c.id}${m.index}`) && attemptsOf('codeforces', `${c.id}${m.index}`) < MAX_ATTEMPTS,
    );
    if (missing.length === 0) continue;
    try {
      const { page, ctx } = await getCfPage();
      try {
        const html = await fetchCfContestHtml(c.id, page);
        const parsed = parseCfProblemsPage(html, c.id);
        const metaByIndex = new Map(meta.map((m) => [m.index, m]));
        const savedIds = [];
        for (const p of parsed) {
          if (left <= 0) break;
          const m = metaByIndex.get(p.index);
          const ok = await tryProblem('codeforces', `${c.id}${p.index}`, async () => {
            const id = `${c.id}${p.index}`;
            // 保留已有译文（同 fetch.mjs,P1-8 同型修复）
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
          });
          if (ok) {
            done++;
            left--;
            savedIds.push(`${c.id}${p.index}`);
          }
        }
        if (parsed.length) {
          const ids = [
            ...new Set([...meta.map((m) => `${c.id}${m.index}`), ...savedIds]),
          ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
          upsertContest('codeforces', {
            id: c.id,
            platform: 'codeforces',
            title: c.name,
            startTime: new Date(c.startTimeSeconds * 1000).toISOString(),
            durationSeconds: c.durationSeconds ?? null,
            url: cfContestUrl(c.id),
            problems: ids,
          });
        }
      } finally {
        await ctx.close().catch(() => {});
      }
    } catch (e) {
      // 整场导航失败：给本场所有缺失题记一次尝试
      for (const m of missing) bump('codeforces', `${c.id}${m.index}`);
      log('cf', `✗ #${c.id} 整场失败 — ${e.message}`);
      saveAttempts();
    }
    await sleep(rnd(4500, 7000));
  }
  log('cf', `本轮新抓 ${done} 道`);
  return done;
}

/* ---------------- 牛客 ---------------- */

const NC_CURSOR_FILE = path.join(ROOT, 'nowcoder', '.scan-cursor.json');

function ncCursorLoad() {
  try {
    return JSON.parse(fs.readFileSync(NC_CURSOR_FILE, 'utf8')).lastId;
  } catch {
    return null;
  }
}

function ncCursorSave(lastId) {
  fs.mkdirSync(path.dirname(NC_CURSOR_FILE), { recursive: true });
  fs.writeFileSync(NC_CURSOR_FILE, JSON.stringify({ lastId, at: nowIso() }) + '\n');
}

const ncIdsOf = (c, index) => `nc${c.id}p${index.toLowerCase()}`;

/** 抓取并保存单场比赛的全部缺失题面；返回新抓数量。 */
async function ncFetchContestProblems(c, budget) {
  let list = [];
  try {
    list = await fetchNowcoderProblemList(c.id);
  } catch (e) {
    log('nc', `✗ #${c.id} problem-list — ${e.message}`);
    return 0;
  }
  const missing = list.filter((p) => !problemComplete('nowcoder', ncIdsOf(c, p.index)));
  upsertContest('nowcoder', {
    id: c.id,
    platform: 'nowcoder',
    title: c.title,
    titleZh: c.title,
    startTime: c.startTime ?? null,
    durationSeconds: c.durationSeconds ?? null,
    url: c.url ?? nowcoderContestUrl(c.id),
    problems: list.map((p) => ncIdsOf(c, p.index)),
  });
  if (missing.length === 0) return 0;
  let done = 0;
  for (const p of missing) {
    if (budget.left <= 0) break;
    const ok = await tryProblem('nowcoder', ncIdsOf(c, p.index), async () => {
      const st = await fetchNowcoderStatement(c.id, p.index);
      saveProblem('nowcoder', {
        id: ncIdsOf(c, p.index),
        platform: 'nowcoder',
        contestId: c.id,
        index: p.index,
        title: p.title,
        // 中文题面+中文标题：译文=原文；英文题面（ICPC 系）或英文标题：置空走翻译
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
    });
    if (ok) {
      done++;
      budget.left--;
    }
    await sleep(rnd(700, 1200));
  }
  return done;
}

async function backfillNc(budget) {
  // 1) 最新官方赛（vip-index 第一页）——覆盖新比赛
  const latest = await fetchNowcoderContests(2);
  log('nc', `最新官方赛 ${latest.length} 场；开始 id 倒序历史扫描（预算 ${budget.left}）`);

  // 2) id 倒序历史扫描：游标 = max(已入库 id, 最新列表最大 id)，每轮向下探 NC_PROBE 个
  const knownMax = Math.max(
    0,
    ...latest.map((c) => Number(c.id)),
    ...collectNcContestIds(),
  );
  const cursor = ncCursorLoad() ?? knownMax + 1;
  const probe = Number(process.env.NC_PROBE ?? 240);
  const scan = await scanNowcoderContestsById({
    fromId: cursor - 1,
    maxProbe: probe,
    onProgress: (n, total, found) => {
      if (n % 60 === 0) log('nc', `扫描进度 ${n}/${total}（发现 ${found} 场官方赛）`);
    },
  });
  ncCursorSave(scan.nextId);
  log('nc', `历史扫描：探测 ${scan.scanned} 个 id，发现官方赛 ${scan.contests.length} 场（游标 → ${scan.nextId}）`);

  // 3) 最新 + 扫描发现，统一补题面
  let done = 0;
  for (const c of [...latest, ...scan.contests]) {
    if (budget.left <= 0) break;
    done += await ncFetchContestProblems(c, budget);
  }
  log('nc', `本轮新抓 ${done} 道`);
  return done;
}

function collectNcContestIds() {
  try {
    const cs = JSON.parse(fs.readFileSync(path.join(ROOT, 'nowcoder', 'contests.json'), 'utf8'));
    return cs.map((c) => Number(c.id)).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

/* ---------------- 翻译 ---------------- */

function collectProblems(platform) {
  const dir = path.join(ROOT, platform, 'problems');
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    } catch {}
  }
  return out;
}

async function translatePlatform(platform, cfg) {
  if (!cfg) return 0;
  const pending = collectProblems(platform)
    .filter((p) => p.statementMd && !p.statementZhMd && String(p.statementMd) !== String(p.statementZhMd))
    .sort((a, b) => String(b.fetchedAt ?? '').localeCompare(String(a.fetchedAt ?? '')));
  if (!pending.length) return 0;
  // 端点探活：密钥失效（401/403）时本轮跳过翻译，抓取不受影响
  try {
    await pingLLM(cfg);
  } catch (e) {
    log('translate', `⚠ ${platform} 端点不可用，本轮跳过 ${pending.length} 题翻译 — ${e.message}`);
    return 0;
  }
  log('translate', `${platform} 待翻译 ${pending.length}`);
  const limit = pLimit(Number(process.env.TRANSLATE_CONCURRENCY ?? 4));
  let done = 0;
  await Promise.all(
    pending.map((p) =>
      limit(async () => {
        try {
          const { titleZh, bodyZh } = await translateStatement(cfg, {
            title: p.title,
            statementMd: p.statementMd,
          });
          saveProblem(platform, {
            ...p,
            titleZh,
            statementZhMd: bodyZh,
            translatedAt: nowIso(),
            translateModel: cfg.model,
          });
          done++;
        } catch (e) {
          log('translate', `✗ ${p.id} — ${e.message}`);
        }
      }),
    ),
  );
  log('translate', `${platform} 已翻译 ${done}/${pending.length}`);
  return done;
}

async function translateContestTitles(cfg) {
  if (!cfg) return;
  for (const platform of ['atcoder', 'codeforces']) {
    const file = path.join(ROOT, platform, 'contests.json');
    let contests = [];
    try {
      contests = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const todo = contests.filter((c) => !c.titleZh);
    if (!todo.length) continue;
    log('translate', `${platform} 待翻译比赛名 ${todo.length}`);
    for (let i = 0; i < todo.length; i += 20) {
      const batch = todo.slice(i, i + 20);
      try {
        const zh = await translateTitles(cfg, batch.map((x) => x.title));
        batch.forEach((x, j) => {
          if (zh[j]) x.titleZh = zh[j];
        });
        fs.writeFileSync(file, JSON.stringify(contests, null, 2) + '\n');
      } catch (e) {
        log('translate', `✗ 比赛名批次 — ${e.message}`);
      }
    }
  }
}

/* ---------------- 提交推送 ---------------- */

async function commitPush(cycle, added) {
  try {
    execFileSync('git', ['add', 'data'], { cwd: process.cwd() });
    const staged = execFileSync('git', ['diff', '--cached', '--numstat'], { cwd: process.cwd() })
      .toString()
      .trim();
    if (!staged) {
      log('git', '无数据变更，跳过提交');
      return;
    }
    execFileSync(
      'git',
      ['commit', '-m', `data: backfill cycle ${cycle} (+${added} problems) [skip ci]`],
      { cwd: process.cwd() },
    );
    for (let i = 0; i < 3; i++) {
      try {
        execFileSync('git', ['push'], { cwd: process.cwd() });
        log('git', '已推送（Vercel 自动部署）');
        return;
      } catch {
        try {
          execFileSync('git', ['pull', '--rebase', '--autostash'], { cwd: process.cwd() });
        } catch {}
        await sleep(5000);
      }
    }
    log('git', '⚠ 推送重试 3 次失败，数据保留在本地，下轮再试');
  } catch (e) {
    log('git', `⚠ 提交失败 — ${e.message}`);
  }
}

/* ---------------- 主循环 ---------------- */

let stopping = false;
const stop = () => {
  if (stopping) {
    console.error('再次收到信号，强制退出');
    process.exit(130);
  }
  stopping = true;
  log('main', '收到停止信号：完成当前题目后收尾退出…');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

async function main() {
  loadEnv();
  const cfg = llmConfig();
  log('main', `持续回填启动：budget=${BUDGET}/平台/轮，maxAttempts=${MAX_ATTEMPTS}，pause=${PAUSE_MS / 1000}s`);
  log('main', cfg ? `翻译模型 ${cfg.model}` : '⚠ 未配置翻译端点，仅抓取不翻译');

  let cycle = 0;
  for (;;) {
    cycle++;
    const t0 = Date.now();
    log('main', `—— 第 ${cycle} 轮开始 ——`);
    const ncBudget = { left: BUDGET };
    const added =
      (await backfillAtCoder(BUDGET)) +
      (await backfillCf(BUDGET)) +
      (await backfillNc(ncBudget));
    await translatePlatform('atcoder', cfg);
    await translatePlatform('codeforces', cfg);
    await translatePlatform('nowcoder', cfg); // 仅覆盖英文题（ICPC 系），中文题译文=原文自动跳过
    await translateContestTitles(cfg);
    await closeCfBrowser();
    saveAttempts();

    const idx = buildIndex();
    const state = {
      cycles: cycle,
      lastCycleAt: nowIso(),
      problems: idx.stats.problems,
      translated: idx.stats.translated,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
    log('main', `第 ${cycle} 轮完成：+${added} 题，总计 ${idx.stats.problems} 题 / ${idx.stats.contests} 场（已译 ${idx.stats.translated}），耗时 ${Math.round((Date.now() - t0) / 1000)}s`);

    commitPush(cycle, added);
    if (stopping) {
      log('main', '已停止。');
      break;
    }
    log('main', `休息 ${PAUSE_MS / 1000}s 后进入下一轮…`);
    await sleep(PAUSE_MS);
    if (stopping) {
      log('main', '已停止。');
      break;
    }
  }
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await closeCfBrowser();
  saveAttempts();
  process.exit(1);
});
