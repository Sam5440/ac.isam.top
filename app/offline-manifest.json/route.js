import { getAllContests, getProblemsOfContest } from '@/lib/data';

export const dynamic = 'force-static';

/**
 * 离线清单（构建期预渲染）：最近 100 场比赛（开始时间倒序）→ 比赛详情页 +
 * 全部题目页 URL。Service Worker 后台按此清单预取进 Cache Storage（默认 100
 * 场，设置面板「离线缓存」可调 30/50/100/200），实现题库默认离线可用。
 */
export async function GET() {
  const contests = getAllContests()
    .slice(0, 100)
    .map((c) => ({
      platform: c.platform,
      id: String(c.id),
      title: c.title ?? '',
      startTime: c.startTime ?? null,
      page: `/contests/${c.platform}/${c.id}`,
      problems: getProblemsOfContest(c).map((p) => ({
        platform: c.platform,
        id: p.id,
        page: `/problems/${c.platform}/${p.id}`,
      })),
    }));
  const problemCount = contests.reduce((n, c) => n + c.problems.length, 0);
  return Response.json(
    { generatedAt: new Date().toISOString(), contestCount: contests.length, problemCount, contests },
    { headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' } },
  );
}
