import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMathTex } from '../lib/math-detect.js';

/** lib/math-detect.js 纯函数：样例文本是否含 TeX 公式（决定渲染路径）。 */

test('hasMathTex: 行内 $…$ 命中（Codeforces 10^9 场景）', () => {
  assert.equal(hasMathTex('$10^9$'), true);
  assert.equal(hasMathTex('输出不超过 $10^{18}$'), true);
});

test('hasMathTex: $$…$$ 块级命中', () => {
  assert.equal(hasMathTex('$$\\sum_{i=1}^n i$$'), true);
});

test('hasMathTex: \\(…\\) / \\[…\\] 历史定界命中', () => {
  assert.equal(hasMathTex('设 \\(n\\) 为奇数'), true);
  assert.equal(hasMathTex('\\[a^2+b^2=c^2\\]'), true);
});

test('hasMathTex: \\begin{…} 环境命中', () => {
  assert.equal(hasMathTex('\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}'), true);
  assert.equal(hasMathTex('\\begin{cases}1\\\\2\\end{cases}'), true);
});

test('hasMathTex: 纯数字 / 普通样例文本不命中', () => {
  assert.equal(hasMathTex('123456'), false);
  assert.equal(hasMathTex('1 2 3\n4 5 6'), false);
  assert.equal(hasMathTex('YES'), false);
});

test('hasMathTex: 金额类 $5 and $10 不命中（定界符内侧紧邻非空白规则的镜像）', () => {
  assert.equal(hasMathTex('$5 and $10'), false);
  assert.equal(hasMathTex('成本 $5, 上限 $10'), false);
});

test('hasMathTex: 空 / 非字符串不命中', () => {
  assert.equal(hasMathTex(''), false);
  assert.equal(hasMathTex('   '), false);
  assert.equal(hasMathTex('$ $'), false);
  assert.equal(hasMathTex(null), false);
  assert.equal(hasMathTex(undefined), false);
});
