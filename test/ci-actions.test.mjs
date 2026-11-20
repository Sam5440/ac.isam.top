import test from 'node:test';
import assert from 'node:assert/strict';
import { actionsPages, mergeRemoteRuns } from '../lib/ci-actions.mjs';

const created_at = '2026-11-20T03:00:00Z';
test('仓库运行跨页去重，保留运行中、取消项，止于时间窗口', async () => {
  const pages = [[{ id: 3, created_at, status: 'queued' }, { id: 2, created_at }],
    [{ id: 2, created_at }, { id: 1, created_at, conclusion: 'cancelled' }, { id: 0, created_at: '2020-01-01' }]];
  const rows = await actionsPages({ since: Date.parse(created_at), get: async (url) => {
    assert.equal(new URL(url).pathname, '/repos/Sam5440/ac.isam.top/actions/runs');
    const page = pages.shift();
    assert.ok(page);
    return Response.json({ workflow_runs: page }, { headers: { Link: '<next>; rel="next"' } });
  } });
  assert.deepEqual(rows.map((r) => r.id), [3, 2, 1]);
});

test('旧抓取存档仅匹配主抓取，同时间其他工作流独立；工作流状态以 GitHub 为准', () => {
  const local = [{ startedAt: created_at, stats: { new: 2 } }, { runId: '3', startedAt: created_at }];
  const remote = ['ci', 'fetch', 'fetch-cf-gyms'].map((w, i) => ({ id: i + 1, created_at, name: w,
    status: 'in_progress', conclusion: [null, 'cancelled', 'timed_out'][i], path: `.github/workflows/${w}.yml` }));
  const runs = mergeRemoteRuns(local, remote);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => [r.remoteOnly, r.conclusion, r.failure]), [
    [true, 'in_progress', false], [false, 'cancelled', false], [false, 'timed_out', true],
  ]);
  assert.equal(runs[1].stats.new, 2);
});
