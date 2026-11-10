import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createViewHistory,
  filterHistory,
  upsertView,
  viewKey,
  MIN_DWELL_MS,
} from '../lib/view-history.js';

/**
 * lib/view-history.js：注入内存 backend + 固定时钟，验证 upsert 语义、
 * 停留累计、minDwellMs 过滤、判题记录与清空（IndexedDB 主路径浏览器内
 * 才可验证，此处覆盖全部纯逻辑与注入式 API）。
 */

/** 极简 Map backend（模拟 IndexedDB get/put/getAll/clear 语义）。 */
function makeBackend() {
  const map = new Map();
  return {
    map,
    async get(platform, problemId) {
      return map.get(viewKey(platform, problemId)) ?? null;
    },
    async put(record) {
      map.set(viewKey(record.platform, record.problemId), record);
    },
    async getAll() {
      return [...map.values()];
    },
    async clear() {
      map.clear();
    },
  };
}

/** 固定时钟：每次 now() 前进 step 毫秒（默认 1000）。 */
function makeClock(start = 1_000_000, step = 1000) {
  let t = start;
  return () => (t += step);
}

test('touchView: 首见建档 + 回访 upsert 保留 firstSeen/totalDwellMs/lastJudge', async () => {
  const api = createViewHistory(makeBackend(), makeClock());
  const t0 = await api.touchView({
    platform: 'codeforces',
    problemId: '1900A',
    title: 'Cover in Water',
    titleZh: null,
    url: 'https://codeforces.com/problemset/problem/1900/A',
  });
  assert.equal(t0.firstSeen, t0.lastSeen);
  assert.equal(t0.totalDwellMs, 0);
  assert.deepEqual(t0.lastJudge, { verdict: null, at: null });

  await api.heartbeat('codeforces', '1900A', 30_000);
  await api.recordJudge('codeforces', '1900A', 'ac');
  // 回访：标题更新（翻译到了）、lastSeen 前进，firstSeen/停留/判题保留
  const t1 = await api.touchView({
    platform: 'codeforces',
    problemId: '1900A',
    title: 'Cover in Water',
    titleZh: '水中覆盖',
    url: 'https://codeforces.com/problemset/problem/1900/A',
  });
  assert.equal(t1.firstSeen, t0.firstSeen);
  assert.equal(t1.totalDwellMs, 30_000);
  assert.deepEqual(t1.lastJudge, { verdict: 'ac', at: t1.lastJudge.at });
  assert.notEqual(t1.lastJudge.at, null);
  assert.equal(t1.titleZh, '水中覆盖');
  assert.ok(t1.lastSeen > t0.lastSeen);
});

test('heartbeat: 停留时长累计，非正数忽略', async () => {
  const api = createViewHistory(makeBackend(), makeClock());
  await api.touchView({ platform: 'atcoder', problemId: 'abc350a', title: 'Past ABCs', url: 'x' });
  await api.heartbeat('atcoder', 'abc350a', 5000);
  await api.heartbeat('atcoder', 'abc350a', 5000);
  await api.heartbeat('atcoder', 'abc350a', 0);
  await api.heartbeat('atcoder', 'abc350a', -3);
  await api.heartbeat('atcoder', 'abc350a', Number.NaN);
  const rows = await api.listHistory({ minDwellMs: 0 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalDwellMs, 10_000);
});

test('heartbeat: 未 touchView 时先建占位记录（兜底）', async () => {
  const api = createViewHistory(makeBackend(), makeClock());
  await api.heartbeat('nowcoder', 'P1001', 70_000);
  const rows = await api.listHistory();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'nowcoder');
  assert.equal(rows[0].totalDwellMs, 70_000);
});

test('listHistory: minDwellMs 过滤 + lastSeen 降序', async () => {
  const api = createViewHistory(makeBackend(), makeClock());
  // A：先看，停留 2s（不足 60s → 不出现）
  await api.touchView({ platform: 'atcoder', problemId: 'a', title: 'A', url: 'x' });
  await api.heartbeat('atcoder', 'a', 2000);
  // B：再看，停留 90s
  await api.touchView({ platform: 'codeforces', problemId: 'b', title: 'B', url: 'x' });
  await api.heartbeat('codeforces', 'b', 90_000);
  // C：最后看，停留 60s（恰好等于阈值 → 出现）
  await api.touchView({ platform: 'nowcoder', problemId: 'c', title: 'C', url: 'x' });
  await api.heartbeat('nowcoder', 'c', 60_000);

  const rows = await api.listHistory(); // 默认 minDwellMs = 60_000
  assert.deepEqual(
    rows.map((r) => r.problemId),
    ['c', 'b'],
  );
  assert.equal(rows[0].lastSeen > rows[1].lastSeen, true);

  // 自定义阈值
  assert.equal((await api.listHistory({ minDwellMs: 100_000 })).length, 0);
  assert.equal((await api.listHistory({ minDwellMs: 0 })).length, 3);
});

test('recordJudge: verdict 归一化（AC→ac，其余非 AC→fail）', async () => {
  const api = createViewHistory(makeBackend(), makeClock());
  await api.touchView({ platform: 'codeforces', problemId: 'x', title: 'X', url: 'x' });
  await api.recordJudge('codeforces', 'x', 'AC');
  assert.equal((await api.listHistory({ minDwellMs: 0 }))[0].lastJudge.verdict, 'ac');
  await api.recordJudge('codeforces', 'x', 'WA');
  assert.equal((await api.listHistory({ minDwellMs: 0 }))[0].lastJudge.verdict, 'fail');
  await api.recordJudge('codeforces', 'x', 'RE');
  assert.equal((await api.listHistory({ minDwellMs: 0 }))[0].lastJudge.verdict, 'fail');
  await api.recordJudge('codeforces', 'x', null);
  assert.equal((await api.listHistory({ minDwellMs: 0 }))[0].lastJudge.verdict, null);
});

test('clearHistory: 全部清空', async () => {
  const api = createViewHistory(makeBackend(), makeClock());
  await api.touchView({ platform: 'atcoder', problemId: 'a', title: 'A', url: 'x' });
  await api.touchView({ platform: 'codeforces', problemId: 'b', title: 'B', url: 'x' });
  assert.equal((await api.listHistory({ minDwellMs: 0 })).length, 2);
  await api.clearHistory();
  assert.deepEqual(await api.listHistory({ minDwellMs: 0 }), []);
});

test('upsertView/filterHistory: 纯函数边界', () => {
  assert.equal(MIN_DWELL_MS, 60_000);
  // upsertView 无 prev：firstSeen = now
  const rec = upsertView(null, { platform: 'p', problemId: '1', title: 'T' }, 123);
  assert.equal(rec.firstSeen, 123);
  assert.equal(rec.url, '');
  // prev 缺 titleZh 时回落 null
  assert.deepEqual(filterHistory(null), []);
  assert.deepEqual(filterHistory([{ totalDwellMs: 1 }, null]), []);
});
