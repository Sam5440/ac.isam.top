import test from 'node:test';
import assert from 'node:assert/strict';
import { pickClistContests, queryClistSnapshot } from '../lib/clist-snapshot.mjs';
import { clistSnapshotUrl, fetchClistSnapshot } from '../scripts/lib/clist.mjs';
import { GET } from '../app/api/contests/clist/route.js';

const now = new Date('2026-11-19T00:00:00Z').getTime();
const snapshot = {
  fetchedAt: '2026-11-19T00:00:00Z',
  contests: [
    { id: 1, event: '过去', resource: 'a', start: '2026-10-01T00:00:00', href: 'https://a/1' },
    { id: 2, event: '近期', resource: 'b', start: '2026-11-20T00:00:00', href: 'https://b/2' },
    { id: 3, event: '远期', resource: 'c', start: '2026-12-30T00:00:00', href: 'https://c/3' },
  ],
};

test('Clist 快照：显式区间、默认未来 30 天与分页参数', () => {
  const ranged = queryClistSnapshot(snapshot, new URLSearchParams({
    start__gte: '2026-11-01T00:00:00', start__lte: '2026-11-30T00:00:00', limit: '500', order_by: 'start',
  }), now);
  assert.deepEqual(ranged.contests.map((contest) => contest.id), [2]);
  assert.equal(ranged.fetchedAt, snapshot.fetchedAt);
  assert.deepEqual(queryClistSnapshot(snapshot, new URLSearchParams(), now).contests.map((contest) => contest.id), [2]);
  const paged = queryClistSnapshot(snapshot, new URLSearchParams({ start__gte: '2020-01-01', order_by: '-start', limit: '1', offset: '1' }), now);
  assert.deepEqual(paged.contests.map((contest) => contest.id), [2]);
});

test('Clist 响应字段提取兼容数组与嵌套 contest', () => {
  const raw = { id: 9, event: '测试', resource: 'example.com', start: '2026-01-01', extra: 'discard' };
  assert.deepEqual(pickClistContests({ objects: [raw] }), [{ id: 9, event: '测试', resource: 'example.com', start: '2026-01-01', end: undefined, duration: undefined, href: undefined }]);
  assert.equal(pickClistContests({ objects: { contest: [raw] } }).length, 1);
});

test('CI 抓取覆盖前 30 天至后 61 天并分页去重', async () => {
  const current = new Date(now);
  const firstUrl = new URL(clistSnapshotUrl(current));
  assert.equal(firstUrl.searchParams.get('start__gte'), '2026-10-20T00:00:00');
  assert.equal(firstUrl.searchParams.get('start__lte'), '2027-01-19T00:00:00');
  const calls = [];
  const get = async (url, options) => {
    calls.push({ url, options });
    const offset = Number(new URL(url).searchParams.get('offset'));
    const length = offset === 0 ? 500 : 2;
    return { objects: Array.from({ length }, (_, index) => ({ id: offset === 500 && index === 0 ? 0 : offset + index, event: `比赛 ${offset + index}` })) };
  };
  const result = await fetchClistSnapshot({ apiKey: 'test-key', now: current, get });
  assert.equal(calls.length, 2);
  assert.equal(result.contests.length, 501);
  assert.equal(calls[0].options.headers.Authorization, 'test-key');
  assert.equal(new URL(calls[1].url).searchParams.get('offset'), '500');
});

test('用户请求只读 CI 快照，全局网络被禁用也能返回日程', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('用户请求不得访问上游'); };
  try {
    const response = GET(new Request('https://ac.invalid/api/contests/clist?start__gte=2020-01-01&limit=1'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-cache'), 'snapshot');
    const body = await response.json();
    assert.equal(body.contests.length, 1);
    assert.ok(body.fetchedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
