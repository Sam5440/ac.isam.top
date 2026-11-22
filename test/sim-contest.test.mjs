import test from 'node:test';
import assert from 'node:assert/strict';
import { clockSnapshot, decodeSimShare, encodeSimShare, exportSimContests, formatElapsed, importSimContests, normalizeSimSort, orderSimProblems, originalProblemUrl, parseSimProblemList, reconcileSimProblems, simProblemLabel, simProblemLetter, withSimProblemKeys } from '../lib/sim-contest.mjs';

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

test('兼容模式：Base64URL 只含字母数字与 -_，跳过短链接后仍可解码', () => {
  const contest = { name: '周末模拟赛 #1 & 2/3?', minutes: 90, problems: [
    { platform: 'codeforces', id: '1519B', points: 1, alias: '道路是曲折的，前途是光明的' },
    { platform: 'cf-gyms', id: '105481A', points: 2.5, alias: 'a+b/c=d&e' },
  ] };
  const encoded = encodeSimShare(contest, true, 'base64');
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.equal(encodeURIComponent(encoded), encoded, 'Base64URL 不含需要百分号转义的字符');
  const decoded = decodeSimShare(encoded);
  assert.equal(decoded.shareMode, 'base64');
  assert.equal(decoded.name, contest.name);
  assert.equal(decoded.problems[0].alias, '道路是曲折的，前途是光明的');
  assert.equal(decoded.problems[1].alias, 'a+b/c=d&e');
  // 短链接服务把载荷再百分号编码一次也不影响
  assert.deepEqual(decodeSimShare(encodeURIComponent(encoded)).problems, decoded.problems);
});

test('兼容模式：标准 Base64（+/、填充）与旧百分号链接都能解码', () => {
  const contest = { name: '标准 Base64', problems: [{ platform: 'atcoder', id: 'abc034_b', points: 3, alias: '第三题' }] };
  const json = decodeURIComponent(encodeSimShare(contest, true, 'url'));
  const standardPadded = Buffer.from(json, 'utf8').toString('base64');
  assert.ok(standardPadded.includes('='));
  for (const value of [standardPadded, standardPadded.replace(/=+$/, '')]) {
    const decoded = decodeSimShare(value);
    assert.equal(decoded.shareMode, 'base64');
    assert.equal(decoded.problems[0].alias, '第三题');
    assert.equal(decoded.minutes, 0);
  }
  const legacy = encodeSimShare(contest, true);
  assert.equal(decodeSimShare(legacy).shareMode, 'url');
  assert.equal(decodeSimShare(encodeURIComponent(legacy)).problems[0].id, 'abc034_b');
});

test('模拟赛题目标签：1A、2B…、Z 之后按 Excel 列名进位', () => {
  assert.equal(simProblemLetter(0), 'A');
  assert.equal(simProblemLabel(0), '1A');
  assert.equal(simProblemLabel(1), '2B');
  assert.equal(simProblemLabel(25), '26Z');
  assert.equal(simProblemLabel(26), '27AA');
  assert.equal(simProblemLabel(51), '52AZ');
  assert.equal(simProblemLabel(-3), '1A');
  assert.equal(simProblemLabel(undefined), '1A');
});

test('题单排序：按原比赛时间/难度正反序，缺值恒排最后且同值保持题单顺序', () => {
  const problems = [
    { id: 'p1', startTime: '2024-01-02T00:00:00Z', difficulty: 1600 },
    { id: 'p2', startTime: '2024-01-01T00:00:00Z', difficulty: 800 },
    { id: 'p3', startTime: null, difficulty: null },
    { id: 'p4', startTime: '2024-01-01T00:00:00Z', difficulty: 1200 },
  ];
  const ids = (sort) => orderSimProblems(problems, sort).map((x) => x.problem.id);
  assert.deepEqual(ids({ by: 'original' }), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(ids({ by: 'time', dir: 'asc' }), ['p2', 'p4', 'p1', 'p3']);
  assert.deepEqual(ids({ by: 'time', dir: 'desc' }), ['p1', 'p2', 'p4', 'p3']);
  assert.deepEqual(ids({ by: 'difficulty', dir: 'asc' }), ['p2', 'p4', 'p1', 'p3']);
  assert.deepEqual(ids({ by: 'difficulty', dir: 'desc' }), ['p1', 'p4', 'p2', 'p3']);
  assert.deepEqual(ids({ by: 'unsupported' }), ['p1', 'p2', 'p3', 'p4']);
  // sourceIndex 保留题单原始下标，排序不会改变题目链接/计时键
  assert.deepEqual(orderSimProblems(problems, { by: 'difficulty', dir: 'desc' }).map((x) => x.sourceIndex), [0, 3, 1, 2]);
});

test('排序口径归一化：未知字段回落原始顺序，原始顺序不保留反序', () => {
  assert.deepEqual(normalizeSimSort(undefined), { by: 'original', dir: 'asc' });
  assert.deepEqual(normalizeSimSort({ by: 'time', dir: 'desc' }), { by: 'time', dir: 'desc' });
  assert.deepEqual(normalizeSimSort({ by: 'difficulty', dir: 'sideways' }), { by: 'difficulty', dir: 'asc' });
  assert.deepEqual(normalizeSimSort({ by: 'original', dir: 'desc' }), { by: 'original', dir: 'asc' });
});

test('分享链接携带排序口径，旧链接缺省为原始顺序', () => {
  const contest = { name: '排序分享', problems: [{ platform: 'codeforces', id: '1519B', points: 1 }], sort: { by: 'difficulty', dir: 'desc' } };
  assert.deepEqual(decodeSimShare(encodeSimShare(contest)).sort, { by: 'difficulty', dir: 'desc' });
  assert.deepEqual(decodeSimShare(encodeSimShare({ ...contest, sort: { by: 'original', dir: 'asc' } })).sort, { by: 'original', dir: 'asc' });
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

test('编辑题单后按题目与别名保留计时和完成状态，并清除被删除题目', () => {
  const old = withSimProblemKeys([
    { platform: 'codeforces', id: '1519B', alias: '第一份', points: 1 },
    { platform: 'codeforces', id: '1519B', alias: '第二份', points: 1 },
    { platform: 'atcoder', id: 'abc034_b', alias: '', points: 1 },
  ]);
  const contest = { problems: old, problemTimes: { [old[0].key]: 2000, [old[1].key]: 7000, [old[2].key]: 9000 }, completed: { [old[1].key]: true, [old[2].key]: true }, activeProblem: old[2].key, activeProblemSince: 10 };
  const updated = reconcileSimProblems(contest, [old[1], { ...old[0], alias: '修改后的名字' }]);
  assert.equal(updated.problemTimes[updated.problems[0].key], 7000);
  assert.equal(updated.problemTimes[updated.problems[1].key], 2000);
  assert.deepEqual(updated.completed, { [updated.problems[0].key]: true });
  assert.equal(updated.activeProblem, null);
  assert.equal(updated.activeProblemSince, null);
});

test('导出正在进行的比赛后导入，保留到导出时的计时与完成状态并处理 ID 冲突', () => {
  const problems = withSimProblemKeys([{ platform: 'codeforces', id: '1519B', points: 1, alias: '测试题' }]);
  const contest = { id: 'contest-1', name: '测试赛', minutes: 1, problems, createdAt: 100, startedAt: 1000, elapsedMs: 5000, runningSince: 1000, activeProblem: problems[0].key, activeProblemSince: 1000, problemTimes: { [problems[0].key]: 3000 }, completed: { [problems[0].key]: true } };
  const [restored] = importSimContests(exportSimContests([contest], 3000), [contest]);
  assert.notEqual(restored.id, contest.id);
  assert.equal(restored.elapsedMs, 7000);
  assert.equal(restored.problemTimes[problems[0].key], 5000);
  assert.equal(restored.completed[problems[0].key], true);
  assert.equal(restored.runningSince, null);
  assert.equal(restored.activeProblemSince, null);
  assert.equal(restored.problems[0].key, problems[0].key);
});

test('题单与分享数据拒绝无法用于题库查找的题号', () => {
  assert.equal(parseSimProblemList('CF | bad.id | 1').errors.length, 1);
  assert.throws(() => decodeSimShare(JSON.stringify({ v: 1, problems: [['codeforces', 'x'.repeat(81), 1]] })), /无效/);
});
