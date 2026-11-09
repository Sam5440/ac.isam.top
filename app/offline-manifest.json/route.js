import { getAllContests, getProblemsOfContest } from '@/lib/data';

export const dynamic = 'force-static';

/**
 * 离线清单（构建期预渲染）：最近 200 场比赛（开始时间倒序）→ 比赛详情页 +
 * 全部题目页 URL。Service Worker 后台按此清单预取进 Cache Storage（设置面板
 * 「离线缓存」可选 30/50/100/200）—— 上限与 UI 的 200 档对齐（审查 P1-9 备忘:
 * 旧实现硬编码 100,「最近 200 场」选项被静默截断为虚假承诺）。
 */
export async function GET() {
  const contests = getAllContests()
    .slice(0, 200)
    .map((c) => ({
      platform: c.platform,
      id: String(c.id),
      title: c.title ?? '',
      startTime: c.startTime ?? null,
      page: `/contests/${c.platform}/${encodeURIComponent(String(c.id))}`,
      problems: getProblemsOfContest(c).map((p) => ({
        platform: c.platform,
        id: p.id,
        page: `/problems/${c.platform}/${encodeURIComponent(String(p.id))}`,
      })),
    }));
  const problemCount = contests.reduce((n, c) => n + c.problems.length, 0);
  return Response.json(
    { generatedAt: new Date().toISOString(), contestCount: contests.length, problemCount, contests },
    { headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' } },
  );
}
