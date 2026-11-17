import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAtCoderStatementHtml } from '../scripts/lib/atcoder.mjs';

/**
 * AtCoder 把公式写在 <pre> 里、TeX 原文放在 <var> 子元素里，例如
 * `<pre><var>1 \leq i \leq N</var> を満たす全ての <var>i</var> に…</pre>`。
 * 旧解析把整个 <pre> 当代码块原样输出成 ```…```，而渲染层故意不碰代码块
 * （避免误伤真代码），于是页面上直接显示字面 \leq —— 存量 abc100_c / abc471_g /
 * arc106_c 就是这么暴露的（2026-11-17 修复：scripts/lib/html2md.mjs 的
 * isFormulaPre / preFormulaBlocks，只在 blockNode 的 'pre' 分支判断）。
 *
 * 这里守四件事：
 *  ① 带 TeX 命令的 <var> → $…$，整块不再是代码围栏；
 *  ② 纯变量形式（<var>N</var> <var>A_1</var> …，AtCoder 的输入格式块）同样按公式输出；
 *  ③ 真代码 <pre>（#include / printf("a\n")）一个字节都不改，仍是代码块；
 *  ④ preText() 未被改动：样例输入/输出仍逐字原样（代码片段、字面 \n）。
 */

const BASE = 'https://atcoder.jp/contests/abc100/tasks/abc100_c';

/** 现代版式：div.part > section > h3（真实页面结构的最小化）。 */
function page(sections, lang = 'en') {
  return [
    '<div id="task-statement">',
    `  <span class="lang-${lang}">`,
    '    <div class="part">',
    ...sections.map((s) => `      <section>${s}</section>`),
    '    </div>',
    '  </span>',
    '</div>',
    '<p>Time Limit: 2 sec / Memory Limit: 1024 MiB</p>',
  ].join('\n');
}

/** 可见文本里（去掉 $…$ / $$…$$ 之后）是否还有裸 TeX 命令。 */
function bareTexOutsideMath(md) {
  return (md.replace(/\$\$[\s\S]*?\$\$/g, '').replace(/\$[^$]*\$/g, '').match(/\\[a-zA-Z]{2,}/g) || []);
}

test('parseAtCoderStatementHtml: <pre> 内 <var> 带 TeX 时按公式输出（abc100_c 真实片段）', () => {
  // 与 abc100_c 日文题面原文一致（<pre> 包住整段带引号的公式散文）
  const html = page(
    [
      '<h3>問題文</h3><pre><var>1 \\leq i \\leq N</var> を満たす全ての <var>i</var> に対して, それぞれ「<var>a_i</var> の値を <var>2</var> で割る」「<var>a_i</var> の値を <var>3</var> 倍する」のどちらかを行う.</pre>',
    ],
    'ja',
  );
  const r = parseAtCoderStatementHtml(html, BASE);
  assert.equal(r.language, 'ja');
  assert.match(r.statementMd, /## Problem Statement/);
  assert.ok(r.statementMd.includes('$1 \\leq i \\leq N$'), 'TeX 原文应包成行内公式：' + r.statementMd);
  assert.ok(r.statementMd.includes('$i$'), '普通 <var> 也应还原成行内公式');
  assert.ok(r.statementMd.includes('$a_i$'));
  assert.ok(r.statementMd.includes('を満たす全ての'), 'pre 里的普通文本应保留为正文');
  assert.ok(!r.statementMd.includes('```'), '不应再输出代码围栏');
  assert.deepEqual(bareTexOutsideMath(r.statementMd), [], '渲染后不应看到裸 TeX');
});

test('parseAtCoderStatementHtml: 纯 <var> 的输入格式块也按公式输出', () => {
  const html = page(['<h3>Input</h3><pre><var>N</var>\n<var>A_1</var> <var>A_2</var></pre>']);
  const r = parseAtCoderStatementHtml(html, BASE);
  assert.match(r.statementMd, /## Input/);
  assert.ok(r.statementMd.includes('$N$'), '输入格式块的 <var>N</var> 应是公式：' + r.statementMd);
  assert.ok(r.statementMd.includes('$A_1$'));
  assert.ok(r.statementMd.includes('$A_2$'));
  assert.ok(r.statementMd.includes('$N$\\\n$A_1$ $A_2$'), '换行应保留为 GFM 硬换行（不是代码块）');
  assert.ok(!r.statementMd.includes('```'), '输入格式块不再输出代码围栏');
  assert.deepEqual(bareTexOutsideMath(r.statementMd), [], '不应有字面 \\command');
});

test('parseAtCoderStatementHtml: 真代码 <pre> 仍是代码块，逐字保留', () => {
  const html = page(['<h3>Note</h3><pre>#include &lt;bits/stdc++.h&gt;</pre>']);
  const r = parseAtCoderStatementHtml(html, BASE);
  assert.ok(
    r.statementMd.includes('```\n#include <bits/stdc++.h>\n```'),
    '纯代码 pre 必须原样输出为代码块：' + r.statementMd,
  );
  assert.ok(!r.statementMd.includes('$'), '真代码里不该凭空出现公式定界符');
});

test('parseAtCoderStatementHtml: 带字面 \\n 的 C 代码仍是代码块', () => {
  const html = page([
    '<h3>Sample Code</h3><pre>#include &lt;cstdio&gt;\nint main() {\n  printf("a\\n");\n  return 0;\n}</pre>',
  ]);
  const r = parseAtCoderStatementHtml(html, BASE);
  assert.ok(
    r.statementMd.includes(
      '```\n#include <cstdio>\nint main() {\n  printf("a\\n");\n  return 0;\n}\n```',
    ),
    'C 代码（含字面 \\n 与缩进）必须逐字保留：' + r.statementMd,
  );
});

test('parseAtCoderStatementHtml: 样例 <pre> 走 preText，逐字原样（不被公式化）', () => {
  const html = page(['<h3>Sample Input 1</h3><pre><var>N</var>\n<var>A_1</var></pre>']);
  const r = parseAtCoderStatementHtml(html, BASE);
  assert.equal(r.samples.length, 1);
  assert.equal(r.samples[0].input, 'N\nA_1\n', '样例输入必须逐字原样（preText 未被改动）');
  assert.ok(!r.statementMd.includes('$N$'), '样例内容不应进入 statementMd');
});

test('parseAtCoderStatementHtml: 散文 + 纯变量 <var> 的 <pre> 保持代码块（行为不变）', () => {
  // arc106_c 的样例解释就是这种「散文里夹 <var>5</var>」的 pre：没有 TeX 命令，
  // 也不是纯变量形式，按原口径仍是代码块。
  const html = page(['<h3>Note</h3><pre>区間 <var>5</var> を選びます。\n区間 <var>1</var> は選びません。</pre>']);
  const r = parseAtCoderStatementHtml(html, BASE);
  assert.ok(
    r.statementMd.includes('```\n区間 5 を選びます。\n区間 1 は選びません。\n```'),
    '散文型 pre 的行为不应改变：' + r.statementMd,
  );
});
