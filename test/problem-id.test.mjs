import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isSafeProblemId,
  normalizeProblemIdList,
  problemFileName,
  sanitizeProblemId,
  stripUrlQuery,
} from '../lib/problem-id.mjs';

/**
 * 事故（2026-11-17）：cf-gyms 抓取把题面链接的查询串当成了题号 ——
 * `/gym/106728/problem/E?statementsLocale=ru` 被整段当作 index，于是同一题在
 * 链接集合里出现两次（`E` 与 `E?statementsLocale=ru`），并落成磁盘文件
 * `data/cf-gyms/problems/106728e?statementslocale=ru.json`。'?' 是 Windows 保留
 * 字符：这两个文件在 Windows 上永远 checkout 不出来（git 一直显示 deleted），
 * `lib/data.js` 的 id 白名单又拒绝它 → 索引里挂着、点进去 404。
 *
 * 修复口径：id / 文件名 / 查询规则统一走 lib/problem-id.mjs（本文件）。
 * 下面守住三件事：① 查询串必须被剥掉；② 归一结果必须能被 Windows 接受；
 * ③ 归一必须幂等（重复跑脚本不产生新改动）。
 */

test('stripUrlQuery: 剥掉查询串与锚点', () => {
  assert.equal(stripUrlQuery('E?statementsLocale=ru'), 'E');
  assert.equal(stripUrlQuery('106728e?statementslocale=ru'), '106728e');
  assert.equal(stripUrlQuery('E#top'), 'E');
  assert.equal(stripUrlQuery('  E?x=1#y  '), 'E');
  assert.equal(stripUrlQuery('1000A'), '1000A');
  assert.equal(stripUrlQuery(null), '');
  assert.equal(stripUrlQuery(undefined), '');
});

test('sanitizeProblemId: 真实污染样本归一为合法题号', () => {
  // 事故里实际落盘的两条记录
  assert.equal(sanitizeProblemId('106728e?statementslocale=ru'), '106728e');
  assert.equal(sanitizeProblemId('106733h?statementslocale=en'), '106733h');
  // 链接里的原始形态（大小写保留，文件名另转小写）
  assert.equal(sanitizeProblemId('E?statementsLocale=ru'), 'E');
  assert.equal(sanitizeProblemId('H?statementsLocale=en'), 'H');
  // 大小写不能被动过：Codeforces id 是 1000A，不是 1000a
  assert.equal(sanitizeProblemId('1000A'), '1000A');
  assert.equal(sanitizeProblemId('abc001_1'), 'abc001_1');
});

test('sanitizeProblemId: 剔除 Windows 非法字符并去掉尾随点/空白', () => {
  assert.equal(sanitizeProblemId('a:b'), 'ab');
  assert.equal(sanitizeProblemId('a\\b'), 'ab');
  assert.equal(sanitizeProblemId('a/b'), 'ab');
  assert.equal(sanitizeProblemId('a*b'), 'ab');
  assert.equal(sanitizeProblemId('a|b'), 'ab');
  assert.equal(sanitizeProblemId('a<b>c'), 'abc');
  assert.equal(sanitizeProblemId('abc.'), 'abc');
  assert.equal(sanitizeProblemId('  abc  '), 'abc');
  // 纯非法字符 → 空串，调用方据此丢弃
  assert.equal(sanitizeProblemId('?'), '');
  assert.equal(sanitizeProblemId('   '), '');
});

test('isSafeProblemId: 只接受 Windows 安全字符集且非保留设备名', () => {
  for (const ok of ['1000A', 'abc001_1', '106728e', 'nc140734pb', 'a-b_c']) {
    assert.equal(isSafeProblemId(ok), true, ok);
  }
  for (const bad of ['106728e?statementslocale=ru', 'E?x=1', 'a/b', 'a:b', 'a b', '', '  ', 'abc.']) {
    assert.equal(isSafeProblemId(bad), false, bad);
  }
  // Windows 保留设备名不能作文件名主干
  for (const reserved of ['con', 'PRN', 'aux', 'nul', 'com1', 'lpt9']) {
    assert.equal(isSafeProblemId(reserved), false, reserved);
  }
  // 但不是保留名的普通前缀要放过
  assert.equal(isSafeProblemId('console'), true);
  assert.equal(isSafeProblemId('null'), true);
});

test('problemFileName: 文件名主干小写，与 store.mjs / lib/data.js 同口径', () => {
  assert.equal(problemFileName('1000A'), '1000a');
  assert.equal(problemFileName('106728e?statementslocale=ru'), '106728e');
  assert.equal(problemFileName('E?statementsLocale=ru'), 'e');
  assert.equal(problemFileName('abc001_1'), 'abc001_1');
  // 幂等：已经是文件名主干的值再过一遍不变
  for (const stem of ['1000a', 'abc001_1', '106728e', 'nc140734pb']) {
    assert.equal(problemFileName(stem), stem);
  }
});

test('normalizeProblemIdList: 归一去重并保留首次出现顺序', () => {
  const { ids, fixed, dropped } = normalizeProblemIdList([
    '106728a',
    '106728b',
    '106728e?statementslocale=ru',
    '106728e',
    '106728c',
  ]);
  assert.deepEqual(ids, ['106728a', '106728b', '106728e', '106728c']);
  assert.equal(fixed, 1); // 只修正了带查询串的那条
  assert.equal(dropped, 1); // 归一后与既有 106728e 撞车
});

test('normalizeProblemIdList: 幂等（第二次跑不产生任何改动）', () => {
  const first = normalizeProblemIdList(['A', 'B?x=1', 'B', 'C']);
  const second = normalizeProblemIdList(first.ids);
  assert.deepEqual(second.ids, first.ids);
  assert.equal(second.fixed, 0);
  assert.equal(second.dropped, 0);
});

test('normalizeProblemIdList: 空值/非法值丢弃，非数组输入安全', () => {
  assert.deepEqual(normalizeProblemIdList(['', '  ', '?', 'A']), { ids: ['A'], fixed: 0, dropped: 3 });
  assert.deepEqual(normalizeProblemIdList(null), { ids: [], fixed: 0, dropped: 0 });
  assert.deepEqual(normalizeProblemIdList(undefined), { ids: [], fixed: 0, dropped: 0 });
});

test('回归：归一后的 id 拼出的文件名不含任何 Windows 非法字符', () => {
  const samples = [
    '106728e?statementslocale=ru',
    '106733h?statementslocale=en',
    'E?statementsLocale=ru',
    'H?statementsLocale=en',
  ];
  for (const raw of samples) {
    const stem = problemFileName(raw);
    assert.match(stem, /^[a-z0-9_-]+$/, `${raw} → ${stem}`);
    assert.equal(isSafeProblemId(stem), true, stem);
    assert.doesNotMatch(stem, /[<>:"/\\|?*]/, stem);
  }
});
