import { getProblem, findProblemSummary } from '@/lib/data';

export const dynamic = 'force-dynamic';

/** 单题全量 JSON（/ide 等客户端页取题面用；题目页是服务端组件直读 lib/data）。 */
export async function GET(request, { params }) {
  const { platform, problemId } = await params;
  const summary = findProblemSummary(platform, problemId);
  const prob = summary ? getProblem(platform, summary.id) : getProblem(platform, problemId);
  if (!prob) {
    return Response.json({ error: '题目不存在' }, { status: 404 });
  }
  return Response.json(prob, {
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' },
  });
}
