import path from 'node:path';
import { pickClistContests } from '../../lib/clist-snapshot.mjs';
import { httpGet } from './http.mjs';
import { log, writeJson } from './util.mjs';

const UPSTREAM_URL = 'https://clist.by/api/v4/json/contest/';
const SNAPSHOT_FILE = path.resolve(process.cwd(), 'data', 'clist.json');
const PAGE_SIZE = 500;
const MAX_PAGES = 8;

export function clistSnapshotUrl(now, offset = 0) {
  const start = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 19);
  const end = new Date(now.getTime() + 61 * 86_400_000).toISOString().slice(0, 19);
  const params = new URLSearchParams({
    start__gte: start,
    start__lte: end,
    limit: String(PAGE_SIZE),
    offset: String(offset),
    order_by: 'start',
  });
  return `${UPSTREAM_URL}?${params}`;
}

export async function fetchClistSnapshot({ apiKey, now = new Date(), get = httpGet } = {}) {
  if (!apiKey) throw new Error('CLIST_API_KEY 未配置');
  const contests = [];
  let pages = 0;
  for (let offset = 0; offset < MAX_PAGES * PAGE_SIZE; offset += PAGE_SIZE) {
    const body = await get(clistSnapshotUrl(now, offset), {
      json: true,
      headers: { Authorization: apiKey },
      timeout: 30_000,
      retries: 3,
    });
    const page = pickClistContests(body);
    contests.push(...page);
    pages += 1;
    if (page.length < PAGE_SIZE) break;
  }
  if (!contests.length) throw new Error('Clist 返回空日程，保留上一份快照');
  const unique = new Map(contests.map((contest) => [`${contest.resource}:${contest.id}`, contest]));
  return { fetchedAt: now.toISOString(), contests: [...unique.values()] };
}

export async function updateClistSnapshot() {
  if (!process.env.CLIST_API_KEY) {
    log('clist', '⚠ 未配置 CLIST_API_KEY，保留现有比赛日程快照');
    return null;
  }
  const snapshot = await fetchClistSnapshot({ apiKey: process.env.CLIST_API_KEY });
  writeJson(SNAPSHOT_FILE, snapshot);
  log('clist', `比赛日程快照已更新：${snapshot.contests.length} 场（前 30 天～后 60 天）`);
  return snapshot.contests.length;
}
