import snapshot from '../data/clist.json';
import { clistTimestamp } from './clist-snapshot.mjs';

// 构建时打包 CI 快照；先标明 Clist 的 UTC 时区，再按浏览器本地日期展示。
const contests = snapshot.contests.map((contest) => ({
  ...contest, start: clistTimestamp(contest.start), end: clistTimestamp(contest.end),
}));

export const scheduleFetchedAt = snapshot.fetchedAt;

export function contestsInRange(start, endExclusive) {
  return contests.filter((contest) => {
    const time = Date.parse(contest.start);
    return time >= start && time < endExclusive;
  });
}
