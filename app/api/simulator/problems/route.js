import { getIndexData } from '@/lib/problem-index';
import { originalProblemUrl, SIM_MAX_PROBLEMS } from '@/lib/sim-contest.mjs';
import { isSafeProblemId } from '@/lib/problem-id.mjs';

export const dynamic = 'force-dynamic';
const PLATFORMS = new Set(['atcoder', 'codeforces', 'cf-gyms', 'nowcoder']);

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: '请求不是有效 JSON' }, { status: 400 }); }
  if (!Array.isArray(body?.problems) || body.problems.length > SIM_MAX_PROBLEMS || body.problems.some((p) => !PLATFORMS.has(p?.platform) || typeof p.id !== 'string' || p.id.length > 80 || !isSafeProblemId(p.id))) return Response.json({ error: '题单格式无效或超过 300 题' }, { status: 400 });
  const index = getIndexData()?.problems;
  if (!Array.isArray(index)) return Response.json({ error: '题库索引暂时不可用' }, { status: 503 });
  const lookup = new Map(index.map((p) => [`${p.platform}:${String(p.id).toLowerCase()}`, p]));
  const problems = body.problems.map(({ platform, id }) => {
    const match = lookup.get(`${platform}:${id.toLowerCase()}`);
    return match ? {
      id: match.id, title: match.title, titleZh: match.titleZh,
      difficulty: match.difficulty, translated: match.translated, found: true,
    } : { id, found: false, originalUrl: originalProblemUrl(platform, id) };
  });
  return Response.json({ problems }, { headers: { 'Cache-Control': 'no-store' } });
}
