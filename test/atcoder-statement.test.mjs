import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAtCoderStatementHtml } from '../scripts/lib/atcoder.mjs';

const BASE = 'https://atcoder.jp/contests/abc034/tasks/abc034_a';

/**
 * AtCoder 题库存在多种历史版式。2015 年那批（abc034 / abc036 / abc041 / arc046 /
 * arc050 / arc052 / arc053 / arc055）没有 div.part 包裹，h3 直接嵌在平铺的
 * section 里；旧实现按「有没有 div.part」选分支，把这类页面解析成空题面，CI
 * 每小时报一批 `empty statement`，这 28 题一直进不了库（2026-11-16 修复）。
 * 这里用三种真实版式的最小样本守住回归，避免再退回按结构猜分支。
 */
const HTML_2015 = [
  '<div id="task-statement">',
  '  <span class="lang">',
  '    <span class="lang-ja">',
  '      <section><h3>問題文</h3>得点は <var>x</var> 点でした。</section>',
  '      <hr>',
  '      <div class="io-style">',
  '        <section><h3>入力</h3><p>入力は以下の形式で与えられる。</p><pre>1 2</pre></section>',
  '        <section><h3>出力</h3>出力せよ。</section>',
  '      </div>',
  '      <hr>',
  '      <section><h3>入力例 1</h3><pre>1 2</pre></section>',
  '      <section><h3>出力例 1</h3><pre>3</pre></section>',
  '    </span>',
  '  </span>',
  '</div>',
  '<p>Time Limit: 2 sec / Memory Limit: 256 MiB</p>',
].join('\n');

test('parseAtCoderStatementHtml: 2015 年平铺 section > h3（abc034 版式）', () => {
  const r = parseAtCoderStatementHtml(HTML_2015, BASE);
  assert.equal(r.language, 'ja');
  assert.match(r.statementMd, /## Problem Statement/);
  assert.ok(r.statementMd.includes("得点は $x$ 点でした。"));
  assert.match(r.statementMd, /## Input/);
  assert.match(r.statementMd, /## Output/);
  assert.equal(r.samples.length, 1);
  assert.equal(r.samples[0].input, '1 2\n');
  assert.equal(r.samples[0].output, '3\n');
  assert.equal(r.timeLimitMs, 2000);
  assert.equal(r.memoryLimitMb, 256);
  assert.ok(!/^---$/m.test(r.statementMd), 'hr 不应变成 md 分隔线');
});

test('parseAtCoderStatementHtml: 2012 年 h3 与 section 平级（arc001 / abc001 版式）', () => {
  const html = [
    '<div id="task-statement">',
    '  <div class="part"><h3>問題文</h3><section>説明です。</section></div>',
    '  <hr/>',
    '  <div class="io-style">',
    '    <div class="part"><h3>入力</h3><section><p>入力は次の通り：</p><pre>N</pre></section></div>',
    '    <div class="part"><h3>出力</h3><section>出力せよ。</section></div>',
    '  </div>',
    '  <div class="part"><h3>入力例 1</h3><section><pre>9</pre></section></div>',
    '  <div class="part"><h3>出力例 1</h3><section><pre>4 1</pre></section></div>',
    '</div>',
  ].join('\n');
  const r = parseAtCoderStatementHtml(html, BASE);
  assert.equal(r.language, 'ja');
  assert.match(r.statementMd, /## Problem Statement/);
  assert.match(r.statementMd, /説明です。/);
  assert.match(r.statementMd, /入力は次の通り：/);
  assert.equal(r.samples.length, 1);
  assert.equal(r.samples[0].input, '9\n');
  assert.equal(r.samples[0].output, '4 1\n');
});

test('parseAtCoderStatementHtml: 现代 div.part > section > h3 且英文优先', () => {
  const html = [
    '<div id="task-statement">',
    '  <span class="lang-en">',
    '    <div class="part">',
    '      <section><h3>Problem Statement</h3><p>Given <var>N</var>, output it.</p></section>',
    '      <section><h3>Constraints</h3><ul><li><var>1</var> ≤ <var>N</var></li></ul></section>',
    '    </div>',
    '    <div class="part">',
    '      <section><h3>Sample Input 1</h3><pre>5</pre></section>',
    '      <section><h3>Sample Output 1</h3><pre>5</pre></section>',
    '    </div>',
    '  </span>',
    '  <span class="lang-ja"><section><h3>問題文</h3>日本語</section></span>',
    '</div>',
    '<p>Time Limit: 2 sec / Memory Limit: 1024 MiB</p>',
  ].join('\n');
  const r = parseAtCoderStatementHtml(html, BASE);
  assert.equal(r.language, 'en');
  assert.match(r.statementMd, /## Constraints/);
  assert.ok(r.statementMd.includes("Given $N$, output it."), "var 应还原成行内公式");
  assert.equal(r.samples.length, 1);
  assert.equal(r.samples[0].input, '5\n');
  assert.equal(r.memoryLimitMb, 1024);
});

test('parseAtCoderStatementHtml: 没有任何题面内容时抛 empty statement', () => {
  assert.throws(
    () => parseAtCoderStatementHtml('<div id="task-statement"></div>', BASE),
    /empty statement/,
  );
});
