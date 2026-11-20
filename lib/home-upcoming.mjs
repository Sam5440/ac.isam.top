export const PLATFORM_RESOURCE = {
  atcoder: 'atcoder.jp',
  codeforces: 'codeforces.com',
  nowcoder: 'ac.nowcoder.com',
};

export function resourceForPlatform(platform) {
  return PLATFORM_RESOURCE[platform] ?? null;
}

export function homeClistRange(now = Date.now(), daysAfter = 15) {
  const start = new Date(now).getTime();
  const days = Number.isFinite(Number(daysAfter)) ? Math.min(60, Math.max(1, Number(daysAfter))) : 15;
  return { start, end: start + days * 86_400_000 };
}

function normalizeName(value) {
  return String(value ?? '').toLowerCase().replace(/[\s\-_–—·,，.。:：;；()（）[\]{}]/g, '');
}

function startMs(contest) {
  const value = new Date(contest?.start ?? contest?.startTime ?? 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function fromInternalContest(contest) {
  const start = contest.startTime;
  const duration = Number(contest.durationSeconds) || 0;
  return {
    key: `internal-${contest.platform}-${contest.id}`,
    event: contest.titleZh || contest.title,
    originalEvent: contest.title,
    resource: resourceForPlatform(contest.platform) ?? contest.platform,
    start,
    end: start && duration ? new Date(new Date(start).getTime() + duration * 1000).toISOString() : null,
    duration,
    href: `/contests/${contest.platform}/${encodeURIComponent(String(contest.id))}`,
    internal: true,
    platform: contest.platform,
    problemCount: contest.problemCount ?? 0,
  };
}

export function fromClistContest(contest) {
  return {
    key: `clist-${contest.resource}-${contest.id}`,
    event: contest.event,
    originalEvent: contest.event,
    resource: contest.resource,
    start: contest.start,
    end: contest.end,
    duration: Number(contest.duration) || 0,
    href: contest.href,
    internal: false,
  };
}

export function mergeUpcomingContests(internal = [], external = []) {
  const merged = new Map();
  for (const contest of [...internal, ...external]) {
    if (!contest?.event || !contest?.resource || !contest?.href || !startMs(contest)) continue;
    const duplicateKey = `${contest.resource}|${startMs(contest)}|${normalizeName(contest.originalEvent)}`;
    if (!merged.has(duplicateKey)) merged.set(duplicateKey, contest);
  }
  return [...merged.values()].sort((a, b) => startMs(a) - startMs(b) || String(a.event).localeCompare(String(b.event)));
}

export function visibleUpcomingContests(contests, selectedSites, platform, now = Date.now()) {
  const selected = selectedSites instanceof Set ? selectedSites : new Set(selectedSites ?? []);
  const resource = platform ? resourceForPlatform(platform) : null;
  return (contests ?? []).filter((contest) => {
    if (!selected.has(contest.resource) || startMs(contest) <= now) return false;
    if (!platform) return true;
    return resource ? contest.resource === resource : contest.platform === platform;
  });
}

export function formatContestDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`;
  return `${minutes}分钟`;
}
