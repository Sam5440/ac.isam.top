#!/usr/bin/env node
/**
 * 用当前转换器重抓全部存量牛客题面（转换器修复——如换行/图片——之后刷新数据）。
 *
 *   node scripts/refetch-nowcoder.mjs [--limit N]
 *
 * 遍历 data/nowcoder/contests.json 的比赛 → 题目清单，逐题重抓题面并就地
 * 覆盖 statementMd / statementZhMd（牛客题面即中文，译文=原文）/ samples /
 * 时限；元数据（title、tags 等）沿用现有文件。抓取失败保留旧数据并记录。
 */

import fs from 'node:fs';
import path from 'node:path';

import { fetchNowcoderStatement } from './lib/nowcoder.mjs';
import { loadProblem, saveProblem } from './lib/store.mjs';
import { buildIndex } from './build-index.mjs';
import { loadEnv, log, rnd, sleep } from './lib/util.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : [])),
);
const LIMIT = Number(args.limit ?? 0);

const DATA_ROOT = path.resolve(process.cwd(), 'data');
const nowIso = () => new Date().toISOString();

async function main() {
  loadEnv();
  const contests = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'nowcoder', 'contests.json'), 'utf8'));
  const todo = [];
  for (const c of contests) {
    for (const pid of c.problems ?? []) {
      const cur = loadProblem('nowcoder', pid);
      if (cur) todo.push({ contestId: String(c.id), cur });
    }
  }
  log('refetch', `存量牛客题面 ${todo.length} 道${LIMIT ? `（取前 ${LIMIT} 道）` : ''}`);

  let done = 0;
  let failed = 0;
  const failures = [];
  for (const { contestId, cur } of LIMIT ? todo.slice(0, LIMIT) : todo) {
    try {
      const st = await fetchNowcoderStatement(contestId, cur.index);
      // AI 译文不覆盖：中文题同步官方原文；英文题（ICPC 系）译文置空走翻译/MT
      const zhIsOriginal =
        !cur.statementZhMd || cur.statementZhMd === cur.statementMd || cur.translateModel === '官方原文';
      const patch = {
        ...cur,
        statementMd: st.statementMd,
        samples: st.samples,
        language: st.language,
        ...(st.timeLimitMs != null ? { timeLimitMs: st.timeLimitMs } : {}),
        ...(st.memoryLimitMb != null ? { memoryLimitMb: st.memoryLimitMb } : {}),
        fetchedAt: nowIso(),
      };
      if (st.statementZhMd && zhIsOriginal) {
        patch.statementZhMd = st.statementMd;
      } else if (!st.statementZhMd) {
        patch.statementZhMd = null;
        if (patch.titleZh === cur.title) patch.titleZh = null;
        delete patch.translateModel;
      }
      saveProblem('nowcoder', patch);
      done++;
      if (done % 20 === 0) log('refetch', `进度 ${done}${failed ? `，失败 ${failed}` : ''}`);
    } catch (e) {
      failed++;
      failures.push(`${cur.id}: ${e.message}`);
      log('refetch', `✗ ${cur.id} — ${e.message}`);
    }
    await sleep(rnd(900, 1600));
  }

  buildIndex();
  log('refetch', `完成：${done} 成功，${failed} 失败（旧数据保留）`);
  if (failures.length) console.log(failures.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
