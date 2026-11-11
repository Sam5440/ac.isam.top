import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRich } from '../lib/render.js';

/** AtCoder 输入/输出格式块（原站 <pre><var>）与译文双重转义公式的渲染。 */

const tokens = (html) => [...html.matchAll(/data-display="0">\$([\s\S]*?)\$<\/code>/g)].map((m) => m[1]);

test('格式块：\\vdots / 下标 / \\mathrm 变成 KaTeX token', () => {
  const html = renderRich('```\nT\n\\mathrm{case}_1\n\\vdots\n\\mathrm{case}_T\n```');
  assert.match(html, /tex-format/);
  assert.deepEqual(tokens(html), ['T', '\\mathrm{case}_1', '\\vdots', '\\mathrm{case}_T']);
});

test('格式块：变量间空格保留，普通单词与省略号不进 KaTeX', () => {
  const html = renderRich('```\nn m swapLR\na_1 ... a_n\n```');
  assert.deepEqual(tokens(html), ['n', 'm', 'a_1', 'a_n']);
  assert.match(html, /swapLR/);
});

test('格式块：多字母底数改正体，A _ 1 收紧，\\cdotsc_ 补空格', () => {
  assert.deepEqual(tokens(renderRich('```\nQuery_1\n```')), ['\\mathrm{Query}_1']);
  assert.deepEqual(tokens(renderRich('```\nA _ 1 A _ 2\n```')), ['A_1', 'A_2']);
  assert.deepEqual(tokens(renderRich('```\nc_{1,1}\\cdotsc_{1,W}\n```')), ['c_{1,1}\\cdots', 'c_{1,W}']);
});

test('代码/伪代码与带语言的代码块保持原样', () => {
  for (const md of [
    '```\nprint "? {0}".format(a_1)\n```',
    '```\nfor a_1=1..n\n```',
    '```\nInput: N segments [L_1: R_1]\n```',
    '```cpp\nint a_1;\n```',
    '```\n3\n1 2 3\n```',
  ]) assert.doesNotMatch(renderRich(md), /zs-math/, md);
});

test('译文双重转义 $\\\\mathrm{case}_i$ 还原为单反斜杠，\\begin 环境内 \\\\ 换行不动', () => {
  assert.deepEqual(tokens(renderRich('其中 $\\\\mathrm{case}_i$ 表示')), ['\\mathrm{case}_i']);
  assert.deepEqual(tokens(renderRich('$1\\\\le N \\\\le 10$')), ['1\\le N \\le 10']);
  assert.match(renderRich('$\\begin{cases}1\\\\x\\end{cases}$'), /1\\\\x/);
});
