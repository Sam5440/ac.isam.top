import { test } from 'node:test';
import assert from 'node:assert/strict';

import { plainTitle, plainTitled } from '../lib/problem-title.mjs';

test('plainTitle: 行内公式去定界符只留正文', () => {
  assert.equal(plainTitle('一份的钱买 $k$ 份（困难版）'), '一份的钱买 k 份（困难版）');
  assert.equal(plainTitle('被 $2^n$ 整除'), '被 2^n 整除');
  assert.equal(plainTitle('删除 $2K+1$ 条边'), '删除 2K+1 条边');
  assert.equal(plainTitle('$k$-good 子数组的数量'), 'k-good 子数组的数量');
});

test('plainTitle: 块级与历史定界符（$$…$$、\\(…\\)、\\[…\\]）', () => {
  assert.equal(plainTitle('求 $$\\sum a_i$$ 的最大值'), '求 \\sum a_i 的最大值');
  assert.equal(plainTitle('区间 \\([l, r]\\) 的和'), '区间 [l, r] 的和');
  assert.equal(plainTitle('矩阵 \\[A\\] 的行列式'), '矩阵 A 的行列式');
});

test('plainTitle: 不误删 AtCoder 真实题名里的星号与尖括号', () => {
  assert.equal(plainTitle('AtCoder *** Contest'), 'AtCoder *** Contest');
  assert.equal(plainTitle('<Inversion>'), '<Inversion>');
});

test('plainTitle: 反引号与 HTML 实体归一', () => {
  assert.equal(plainTitle('数组 `a` 与 `b`'), '数组 a 与 b');
  assert.equal(plainTitle('问号 &amp; 尖括号 &lt;x&gt;'), '问号 & 尖括号 <x>');
});

test('plainTitle: 幂等且容忍非字符串', () => {
  const once = plainTitle('A $B$ C');
  assert.equal(plainTitle(once), once);
  assert.equal(plainTitle(null), '');
  assert.equal(plainTitle(undefined), '');
  assert.equal(plainTitle(42), '');
});

test('plainTitled: 双字段净化且不改原对象', () => {
  const src = { id: 'x', title: '$n$ 皇后', titleZh: 'N 皇后 $n \\le 10$' };
  const out = plainTitled(src);
  assert.equal(out.title, 'n 皇后');
  assert.equal(out.titleZh, 'N 皇后 n \\le 10');
  assert.equal(src.title, '$n$ 皇后');
  assert.equal(out.id, 'x');
});
