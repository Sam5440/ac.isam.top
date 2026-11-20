import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contestSiteMeta } from '../lib/contest-sites.js';
import {
  formatContestDuration, fromClistContest, fromInternalContest, homeClistRange,
  mergeUpcomingContests, resourceForPlatform, visibleUpcomingContests,
} from '../lib/home-upcoming.mjs';

const now = new Date('2026-11-18T00:00:00Z').getTime();

test('首页 Clist 区间：从当前时间开始，范围与日历未来天数一致', () => {
  assert.deepEqual(homeClistRange(now, 15), {
    start: now,
    end: Date.parse('2026-12-03T00:00:00Z'),
  });
  assert.equal(homeClistRange(now, 999).end, Date.parse('2027-01-17T00:00:00Z'));
});

test('内部比赛转换：复用日历资源域名并保留站内链接', () => {
  const row = fromInternalContest({
    platform: 'codeforces', id: 2300, title: 'Codeforces Round', titleZh: 'CF 测试赛',
    startTime: '2026-11-20T12:00:00Z', durationSeconds: 7200, problemCount: 6,
  });
  assert.equal(row.resource, 'codeforces.com');
  assert.equal(row.event, 'CF 测试赛');
  assert.equal(row.originalEvent, 'Codeforces Round');
  assert.equal(row.href, '/contests/codeforces/2300');
  assert.equal(row.end, '2026-11-20T14:00:00.000Z');
  assert.equal(resourceForPlatform('atcoder'), 'atcoder.jp');
  assert.equal(resourceForPlatform('unknown'), null);
});

test('合并去重：同站同时间同名的题库比赛优先，其余按开始时间升序', () => {
  const internal = fromInternalContest({
    platform: 'codeforces', id: 2300, title: 'Codeforces Round 1 (Div. 2)', titleZh: '第一场',
    startTime: '2026-11-20T12:00:00Z', durationSeconds: 7200,
  });
  const duplicate = fromClistContest({
    id: 1, resource: 'codeforces.com', event: 'Codeforces Round 1 (Div. 2)',
    start: '2026-11-20T12:00:00Z', href: 'https://codeforces.com/contest/2300', duration: 7200,
  });
  const earlier = fromClistContest({
    id: 2, resource: 'atcoder.jp', event: 'AtCoder Beginner Contest',
    start: '2026-11-19T12:00:00Z', href: 'https://atcoder.jp/contests/abc999', duration: 6000,
  });
  const rows = mergeUpcomingContests([internal], [duplicate, earlier]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, 'AtCoder Beginner Contest');
  assert.equal(rows[1].event, '第一场');
  assert.equal(rows[1].internal, true);
});

test('站点筛选：完全复用 calendarSites，并支持限定平台与剔除已开赛', () => {
  const rows = [
    { key: 'cf', event: 'CF', resource: 'codeforces.com', start: '2026-11-20T00:00:00Z', href: 'x' },
    { key: 'ac', event: 'AC', resource: 'atcoder.jp', start: '2026-11-21T00:00:00Z', href: 'x' },
    { key: 'past', event: 'Past', resource: 'codeforces.com', start: '2026-11-17T00:00:00Z', href: 'x' },
  ];
  assert.deepEqual(visibleUpcomingContests(rows, ['codeforces.com'], null, now).map((row) => row.key), ['cf']);
  assert.deepEqual(visibleUpcomingContests(rows, new Set(['codeforces.com', 'atcoder.jp']), 'atcoder', now).map((row) => row.key), ['ac']);
  assert.deepEqual(visibleUpcomingContests(rows, [], null, now), []);
});

test('站点标签和时长：与日历常用站点一致，长比赛可读', () => {
  assert.equal(contestSiteMeta('codeforces.com').short, 'CF');
  assert.equal(contestSiteMeta('luogu.com.cn').label, '洛谷');
  assert.ok(contestSiteMeta('example.com').badge);
  assert.equal(formatContestDuration(90 * 60), '1小时30分');
  assert.equal(formatContestDuration(26 * 3600), '1天2小时');
  assert.equal(formatContestDuration(null), '0分钟');
});
