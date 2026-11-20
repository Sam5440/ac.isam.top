import test from 'node:test';
import assert from 'node:assert/strict';
import { clockSnapshot, decodeSimShare, encodeSimShare, formatElapsed, originalProblemUrl, parseSimProblemList } from '../lib/sim-contest.mjs';

test('暂停不计时，恢复后从已用预算继续；休眠越过截止时间只结算剩余预算', () => {
  const paused = { minutes: 1, elapsedMs: 40000, activeProblem: 'A', problemTimes: { A: 15000 }, runningSince: null, activeProblemSince: null };
  assert.equal(clockSnapshot(paused, 180000).elapsedMs, 40000);
  const resumed = { ...paused, runningSince: 180000, activeProblemSince: 180000 };
  assert.deepEqual(clockSnapshot(resumed, 185000), { elapsedMs: 45000, problemTimes: { A: 20000 }, expired: false });
  assert.deepEqual(clockSnapshot(resumed, 300000), { elapsedMs: 60000, problemTimes: { A: 35000 }, expired: true });
});

test('模拟赛列表：竖线/tab、多种平台别名、分值与别名', () => {
  const result = parseSimProblemList([
    'CodeForces | 1519B | 1 | 道路是曲折的，前途是光明的',
    'Gym\t105481A\t2.5\t一次又一次',
    'AtCoder | abc034_b | 1 | ',
    '牛客 | 25005 | 3',
    'platform | id | points | alias',
  ].join('\n'));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows.map(({ platform, id, points, alias }) => [platform, id, points, alias]), [
    ['codeforces', '1519B', 1, '道路是曲折的，前途是光明的'],
    ['cf-gyms', '105481A', 2.5, '一次又一次'],
    ['atcoder', 'abc034_b', 1, ''], ['nowcoder', '25005', 3, ''],
  ]);
});

test('模拟赛列表逐行指出格式问题，拒绝非法分数和无效平台', () => {
  const parsed = parseSimProblemList('bad | 1 | 1\nCF | 1519B | -1 | alias\nCF | 1519B | 1');
  assert.equal(parsed.errors.length, 2);
  assert.equal(parsed.rows.length, 1);
});

test('分享链接数据可编码/解码，可选择移除别名并保留分值', () => {
  const contest = { name: '周末模拟赛', problems: [
    { platform: 'codeforces', id: '1519B', points: 1, alias: '光明道路' },
    { platform: 'atcoder', id: 'abc034_b', points: 3, alias: '' },
  ] };
  const full = decodeSimShare(encodeSimShare(contest, true));
  assert.equal(full.name, contest.name);
  assert.equal(full.problems[0].alias, '光明道路');
  assert.equal(full.problems[1].points, 3);
  assert.equal(decodeSimShare(encodeSimShare(contest, false)).problems[0].alias, '');
  assert.throws(() => decodeSimShare('%'), /无法解码/);
});

test('不存在题目时生成对应平台的官方原题或比赛链接', () => {
  assert.equal(originalProblemUrl('codeforces', '1703A'), 'https://codeforces.com/problemset/problem/1703/A');
  assert.equal(originalProblemUrl('cf-gyms', '105481A'), 'https://codeforces.com/gym/105481/problem/A');
  assert.equal(originalProblemUrl('atcoder', 'abc034_b'), 'https://atcoder.jp/contests/abc034/tasks/abc034_b');
  assert.equal(originalProblemUrl('nowcoder', '25005'), 'https://ac.nowcoder.com/acm/problem/25005');
});

test('时长格式稳定且不输出负时间', () => {
  assert.equal(formatElapsed(3_661_999), '01:01:01');
  assert.equal(formatElapsed(-1000), '00:00:00');
});
