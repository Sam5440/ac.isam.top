/**
 * CI 运行记录（工作项 3.3）：
 *
 *   fetch.mjs 每轮结束时调用 writeRunRecord()，把本轮抓取/翻译结果追加到
 *   data/ci-log.json（最新在前，上限 30 条），供 /ci 抓取日志页渲染。
 *
 *   incomplete / nextPlan 从 data/.attempts.json（backfill-all.mjs 维护的
 *   跨轮次尝试计数）汇总：未达尝试上限的题面会在后续轮次自动重试。
 *
 *   所有读写均在 try/catch 内 —— 日志记录失败绝不阻塞抓取主流程。
 */

import path from 'node:path';

import { readJson, writeJson } from './util.mjs';

const DATA_ROOT = path.resolve(process.cwd(), 'data');
const CI_LOG_FILE = path.join(DATA_ROOT, 'ci-log.json');
const ATTEMPTS_FILE = path.join(DATA_ROOT, '.attempts.json');
const STATE_FILE = path.join(DATA_ROOT, '.backfill-state.json');

const MAX_RUNS = 30; // ci-log.json 保留的运行记录条数
const MAX_LIST = 100; // incomplete / nextPlan 数组截断上限（全量见 pendingCount）
const MAX_ATTEMPTS = 3; // 与 backfill-all.mjs 默认 --max-attempts 一致

/**
 * 读取尝试计数：未达 MAX_ATTEMPTS 的题面 = 下轮继续重试的积压。
 * 键格式 `${platform}:${problemId}`（同 backfill-all.mjs）。
 */
function loadPendingRetries() {
  const attempts = readJson(ATTEMPTS_FILE) ?? {};
  const pending = [];
  for (const [key, n] of Object.entries(attempts)) {
    if (typeof n !== 'number' || n <= 0 || n >= MAX_ATTEMPTS) continue;
    const i = key.indexOf(':');
    pending.push({
      platform: i > 0 ? key.slice(0, i) : '',
      problemId: i > 0 ? key.slice(i + 1) : key,
      attempts: n,
      maxAttempts: MAX_ATTEMPTS,
    });
  }
  return pending;
}

/**
 * 汇总 incomplete / nextPlan：
 * - incomplete：本轮抓取失败且仍未达尝试上限的题（下轮自动重试）
 * - nextPlan：全部未达上限的积压题面（backfill 队列，尝试次数少者优先）
 */
export function buildBackfillSummary(failuresThisRun = []) {
  const pending = loadPendingRetries();
  const pendingKeys = new Set(pending.map((x) => `${x.platform}:${x.problemId}`));
  const messageOf = (x) =>
    String(failuresThisRun.find((f) => f.platform === x.platform && f.problemId === x.problemId)?.message ?? '')
      .slice(0, 300) || '本轮抓取失败';
  const incomplete = failuresThisRun
    .filter((x) => pendingKeys.has(`${x.platform}:${x.problemId}`))
    .slice(0, MAX_LIST)
    .map((x) => ({
      platform: x.platform,
      problemId: x.problemId,
      reason: messageOf(x),
      retryNextRun: true,
    }));
  const nextPlan = pending
    .slice()
    .sort((a, b) => a.attempts - b.attempts || a.problemId.localeCompare(b.problemId))
    .slice(0, MAX_LIST);
  return { incomplete, nextPlan, pendingCount: pending.length };
}

/** 追加一条运行记录（最新在前，超上限裁剪）；失败仅告警，返回是否成功。 */
export function writeRunRecord(record) {
  try {
    const prev = readJson(CI_LOG_FILE);
    const runs = Array.isArray(prev?.runs) ? prev.runs : [];
    runs.unshift(record);
    writeJson(CI_LOG_FILE, { updatedAt: new Date().toISOString(), runs: runs.slice(0, MAX_RUNS) });
    return true;
  } catch (e) {
    console.error('[ci-log] ⚠ 运行记录写入失败（不影响抓取数据）：', e?.message || e);
    return false;
  }
}

/** data/.backfill-state.json（backfill-all.mjs 的轮次概览），读不到返回 null。 */
export function readBackfillState() {
  return readJson(STATE_FILE);
}
