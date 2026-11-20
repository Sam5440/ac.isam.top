import { GH_REPO } from '../../../../../../lib/ci-actions.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,17}$/.test(id)) return new Response('无效的作业编号', { status: 400 });
  const token = process.env.CI_LOG_READ_TOKEN;
  if (!token) return new Response('站点尚未配置 GitHub 日志读取凭据 CI_LOG_READ_TOKEN。', { status: 503 });
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
    const api = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/jobs/${id}/logs`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      cache: 'no-store', redirect: 'manual', signal,
    });
    if (api.status !== 302) return new Response(`GitHub 暂未提供此作业日志（HTTP ${api.status}）。`, { status: api.ok ? 502 : api.status });
    const url = new URL(api.headers.get('location'));
    if (url.protocol !== 'https:') throw new Error('invalid log URL');
    // GitHub signs this short-lived URL. Never forward credentials or expose the URL.
    const log = await fetch(url, { cache: 'no-store', redirect: 'error', signal });
    if (!log.ok) throw new Error('log unavailable');
    return new Response(log.body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=300, s-maxage=3600' } });
  } catch {
    return new Response('未能下载作业日志，请稍后重试。', { status: 502 });
  }
}
