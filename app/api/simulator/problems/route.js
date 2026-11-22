import { getIndexData } from '@/lib/problem-index';
import { getContests, getProblemWithReuse } from '@/lib/data';
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
  // 原比赛开始时间（题单「按出现时间排序」用）：每个平台的比赛表只读/排序一次。
  const contestStarts = new Map();
  const startTimeOf = (platform, contestId) => {
    if (!contestStarts.has(platform)) {
      contestStarts.set(platform, new Map(getContests(platform).map((c) => [String(c.id).toLowerCase(), c.startTime ?? null])));
    }
    return contestStarts.get(platform).get(String(contestId ?? '').toLowerCase()) ?? null;
  };
  const problems = body.problems.map(({ platform, id }) => {
    const match = lookup.get(`${platform}:${id.toLowerCase()}`);
    const problem = match ? getProblemWithReuse(platform, match.id) : null;
    return match ? {
      id: match.id, title: match.title, titleZh: match.titleZh,
      difficulty: match.difficulty, translated: Boolean(match.translated || problem?.statementZhMd),
      fetched: Boolean(problem?.statementMd || problem?.statementZhMd || problem?.statementPdf), found: Boolean(problem),
      startTime: startTimeOf(platform, match.contestId),
      originalUrl: originalProblemUrl(platform, match.id),
    } : { id, found: false, startTime: null, originalUrl: originalProblemUrl(platform, id) };
  });
  return Response.json({ problems }, { headers: { 'Cache-Control': 'no-store' } });
}
