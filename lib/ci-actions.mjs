export const GH_REPO = 'Sam5440/ac.isam.top';
const base = `https://api.github.com/repos/${GH_REPO}/actions/runs`;
const labels = {
  success: '成功', failure: '失败', cancelled: '已取消', timed_out: '超时', skipped: '已跳过',
  action_required: '需要处理', neutral: '中性', stale: '已失效', startup_failure: '启动失败',
  in_progress: '运行中', queued: '排队中', pending: '待运行', waiting: '等待中', requested: '已请求',
};
export const actionLabel = (state) => labels[state] || state || '状态未知';

export async function actionsPages({ runId, since = 0, signal, get = fetch } = {}) {
  const items = new Map();
  const jobs = runId != null;
  for (let page = 1; ; page++) {
    const url = `${base}${jobs ? `/${runId}/jobs` : ''}?per_page=100&page=${page}`;
    const res = await get(url, { signal, headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    const rows = (await res.json())[jobs ? 'jobs' : 'workflow_runs'];
    for (const row of rows) if (jobs || Date.parse(row.created_at) >= since) items.set(row.id, row);
    if (!res.headers.get('link')?.includes('rel="next"') || (!jobs && Date.parse(rows.at(-1)?.created_at) < since)) break;
  }
  return [...items.values()];
}

export function mergeRemoteRuns(local, remote) {
  const archives = new Set(local);
  const byId = new Map(local.filter((a) => a.runId).map((a) => [String(a.runId), a]));
  const runs = remote.map((r) => {
    const startedAt = r.run_started_at || r.created_at;
    const archive = byId.get(String(r.id)) ?? (r.path === '.github/workflows/fetch.yml' &&
      [...archives].find((a) => !a.runId && Math.abs(Date.parse(a.startedAt) - Date.parse(startedAt)) < 180000));
    archives.delete(archive);
    return {
      ...archive, runId: r.id, workflow: r.name || r.path, startedAt, trigger: r.event, url: r.html_url,
      sha: r.head_sha?.slice(0, 7), conclusion: r.conclusion || r.status, updatedAt: r.updated_at,
      failure: ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion), remoteOnly: !archive,
      durationMs: r.conclusion && r.updated_at ? Date.parse(r.updated_at) - Date.parse(startedAt) : null,
      archiveDurationMs: archive?.durationMs,
    };
  });
  return [...runs, ...[...archives].map((a) => ({ ...a, workflow: 'Fetch & translate problems', archiveDurationMs: a.durationMs }))]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
