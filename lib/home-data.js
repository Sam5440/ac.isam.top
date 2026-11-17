import { getAllContests, getIndex, getRecentlyFetchedProblems } from './data.js';

function publicContest(contest) {
  return {
    id: contest.id,
    platform: contest.platform,
    title: contest.title,
    titleZh: contest.titleZh ?? null,
    startTime: contest.startTime ?? null,
    durationSeconds: contest.durationSeconds ?? null,
    contestType: contest.contestType ?? null,
    problemCount: (contest.problems ?? []).length,
  };
}

export function getHomeData() {
  const index = getIndex();
  if (!index?.stats?.problems) return null;
  const now = Date.now();
  const time = (contest) => new Date(contest.startTime ?? 0).getTime() || 0;
  const all = getAllContests();
  const recent = all.filter((contest) => time(contest) <= now).slice(0, 60);
  const upcoming = all
    .filter((contest) => time(contest) > now)
    .sort((a, b) => time(a) - time(b))
    .slice(0, 60);
  const contests = [...upcoming, ...recent].map(publicContest);
  const lookup = new Map(all.map((contest) => [`${contest.platform}:${contest.id}`, contest]));
  const fetchedProblems = getRecentlyFetchedProblems(60);
  const fetchedContests = [];
  const seen = new Set();
  for (const problem of fetchedProblems) {
    const key = `${problem.platform}:${problem.contestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const contest = lookup.get(key);
    fetchedContests.push({
      ...(contest ? publicContest(contest) : {
        id: problem.contestId,
        platform: problem.platform,
        title: `${problem.platform} · ${problem.contestId}`,
        titleZh: null,
        startTime: null,
        problemCount: 0,
      }),
      fetchedAt: problem.fetchedAt,
    });
    if (fetchedContests.length >= 30) break;
  }
  return {
    generatedAt: index.generatedAt ?? null,
    renderedAt: new Date().toISOString(),
    stats: index.stats,
    contests,
    fetchedContests,
    recentProblems: index.recentProblems ?? [],
    fetchedProblems,
  };
}
