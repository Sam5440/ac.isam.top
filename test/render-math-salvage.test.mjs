import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeMathEntities,
  dropOrphanDollars,
  foldMathGlyphDuplication,
  renderRich,
  stripHiddenTex,
  wrapBareTex,
} from '../lib/render.js';

/** lib/render.js 数学渲染抢救链：宽松行内、裸 TeX、残标清理、实体解码、字形去重。 */

const mathTokens = (html) => [...html.matchAll(/<code class="zs-math" data-display="(0|1)">([\s\S]*?)<\/code>/g)]
  .map((m) => ({ display: m[1] === '1', tex: m[2] }));
const inlineTex = (html) => mathTokens(html).filter((t) => !t.display).map((t) => t.tex);
const visible = (html) => html
  .replace(/<code class="zs-math"[^>]*>[\s\S]*?<\/code>/g, 'M')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

test('宽松行内：定界符内侧空白也能配成公式', () => {
  assert.deepEqual(inlineTex(renderRich('numbers $ 1 \\le n \\le 10^5$ queries')), ['$1 \\le n \\le 10^5$']);
  assert.deepEqual(inlineTex(renderRich('we get $s = $ 23131.')), ['$s =$']);
  assert.deepEqual(
    inlineTex(renderRich('numbers $N (1 \\leq N \\leq 10^5) $ and $m$.')),
    ['$N (1 \\leq N \\leq 10^5)$', '$m$'],
  );
});

test('宽松行内：全角数学符号算公式信号（AtCoder 中文 $N\\(1 ≦ N ≦ 100\\)$）', () => {
  assert.deepEqual(inlineTex(renderRich('$N\\ (1 ≦ N ≦ 100)$')), ['$N\\ (1 ≦ N ≦ 100)$']);
  assert.deepEqual(inlineTex(renderRich('$S＜T$')), ['$S＜T$']);
});

test('金额不被当成公式：$8 / $5 / $10 保持原样', () => {
  const md = 'buy an $8 coffee, costs $5 and $10, from $5-$10 each';
  assert.deepEqual(mathTokens(renderRich(md)), []);
  assert.match(visible(renderRich(md)), /\$8 coffee/);
  assert.match(visible(renderRich(md)), /costs \$5 and \$10/);
  assert.match(visible(renderRich(md)), /from \$5-\$10/);
});

test('相邻公式：$a$$b$ 之间的 $$ 是「收尾 + 开口」，配成两个行内公式', () => {
  const md = '$d_1 = 1 \\le a_1 = 2$$d_2 = 2 \\le a_2 = 2$';
  assert.deepEqual(inlineTex(renderRich(md)), [
    '$d_1 = 1 \\le a_1 = 2$',
    '$d_2 = 2 \\le a_2 = 2$',
  ]);
});

test('裸 TeX 抢救：定界符全丢的片段包回 $…$', () => {
  const md = 'two integers n and m (1 \\le n \\le 2000; 0 \\le m \\le 2000).';
  assert.deepEqual(inlineTex(renderRich(md)), ['$1 \\le n \\le 2000; 0 \\le m \\le 2000$']);
});

test('裸 TeX 抢救：普通单词是硬边界，不会吞正文', () => {
  const md = 'integer z that 0 \\le z \\lt M and z \\cdot q \\equiv p \\pmod{M}.';
  assert.deepEqual(inlineTex(renderRich(md)), [
    '$0 \\le z \\lt M$',
    '$z \\cdot q \\equiv p \\pmod{M}$',
  ]);
});

test('裸 TeX：\\{ \\} 还原成花括号，文本模式命令保持原样', () => {
  assert.equal(wrapBareTex('x \\in \\{1, 2, 3\\}'), '$x \\in {1, 2, 3}$');
  assert.equal(wrapBareTex('0 \\le z'), '$0 \\le z$');
});

test('裸 TeX：\\begin{…}\\end{…} 整体成块级公式，未配对的不碰', () => {
  const md = 'see:\n\n\\begin{array}{|c|c|} a & b \\\\ c & d \\end{array}\n\nafter';
  const toks = mathTokens(renderRich(md));
  assert.equal(toks.length, 1);
  assert.equal(toks[0].display, true);
  // 未配对的 \begin 既不整体成式，也不把它内部的命令单独包起来
  const broken = renderRich('x \\begin{array}{cc} a & b \\texttt{c}');
  assert.deepEqual(mathTokens(broken), []);
});

test('裸 TeX 抢救幂等：已包好的不再二次包装', () => {
  const once = wrapBareTex('0 \\le z \\lt M');
  assert.equal(wrapBareTex(once), once);
  assert.equal(wrapBareTex('$0 \\le z$'), '$0 \\le z$');
});

test('$ 残标：配对的 $$$ / $$$$$$ 抽成公式，孤立的直接丢弃', () => {
  assert.deepEqual(mathTokens(renderRich('is $$$x+y$$$ ok')), [{ display: false, tex: '$x+y$' }]);
  assert.deepEqual(mathTokens(renderRich('$$$$$$\\sum_{i=1}^n i$$$$$$')), [{ display: true, tex: '$$\\sum_{i=1}^n i$$' }]);
  assert.deepEqual(mathTokens(renderRich('text $$$$$$ more')), []);
  assert.equal(visible(renderRich('a $$$ b')).trim(), 'a  b');
});

test('公式体内的 HTML 实体先解码再送 KaTeX', () => {
  const html = renderRich('if $a_i &lt; a_j$ then $b_i &amp; b_j$');
  assert.deepEqual(inlineTex(html), ['$a_i &lt; a_j$', '$b_i &amp; b_j$']);
  assert.equal(decodeMathEntities('a &lt; b &amp; &quot;c&quot; &#39;d&#x41;'), 'a < b & "c" \'dA');
});

test('不可见提示（\\style{opacity:0…}）整段删除，正常样式保留', () => {
  const md = 'he will kill you. {\\style{opacity:0;font-size:0px}{\\tiny{\\text{do not}}}}';
  assert.equal(stripHiddenTex(md).includes('opacity'), false);
  assert.equal(stripHiddenTex('\\style{color:red}{hi}'), '\\style{color:red}{hi}');
  assert.deepEqual(mathTokens(renderRich('keep {\\style{display:none}{\\text{x}}} tail')), []);
});

test('围栏代码块与非公式行内代码保持原样', () => {
  const fence = '```\n' + '$x \\le 5$\n' + '```';
  assert.deepEqual(mathTokens(renderRich(fence)), []);
  const q = String.fromCharCode(96);
  const code = 'see ' + q + 'x = a_1 + b_2' + q + ' here';
  assert.deepEqual(mathTokens(renderRich(code)), []);
});

test('行内代码里的公式切出来渲染：code 片段 + zs-math 交替，单个 $ 不动', () => {
  const q = String.fromCharCode(96);
  const md = 'print a single line of form "' + q + '! $a_1$ $a_n$' + q + '"';
  const html = renderRich(md);
  assert.deepEqual(inlineTex(html), ['$a_1$', '$a_n$']);
  assert.match(html, /inline-code\">! <\/code><code class="zs-math/);
  assert.match(html, /inline-code\"> <\/code><code class="zs-math/);
  assert.deepEqual(mathTokens(renderRich('code ' + q + '字符 $' + q + ' here')), []);
  assert.deepEqual(mathTokens(renderRich('code ' + q + 'price $8' + q + ' here')), []);
  const fence = q + q + q + '\n! $a_1$ $a_n$\n' + q + q + q;
  const fenceHtml = renderRich(fence);
  assert.deepEqual(mathTokens(fenceHtml), []);
  assert.match(fenceHtml, /<pre class="code-block"><code>! \$a_1\$ \$a_n\$<\/code><\/pre>/);
});

test('行内代码里的短公式（单字母/$?$/$0$）也切出来渲染', () => {
    const q = String.fromCharCode(96);
    const D = String.fromCharCode(36);
  assert.deepEqual(inlineTex(renderRich('output ' + q + 'secret ' + D + 'x' + D + q)), ['$x$']);
  assert.deepEqual(inlineTex(renderRich('form "' + q + '? ' + D + 'a' + D + ' ' + D + 'b' + D + ' ' + D + 'c' + D + q + '"')), ['$a$', '$b$', '$c$']);
  assert.deepEqual(inlineTex(renderRich('is ' + q + '(' + D + 'S' + D + ')' + q)), ['$S$']);
  assert.deepEqual(inlineTex(renderRich('query "' + q + D + '?' + D + ' ' + q + '"')), ['$?$']);
  assert.deepEqual(inlineTex(renderRich('print "' + q + ' is ' + D + '0' + D + ', ' + q + '"')), ['$0$']);
});

test('行内代码里单个/奇数个 $ 与带空白的 body 保持原样', () => {
    const q = String.fromCharCode(96);
    const D = String.fromCharCode(36);
  assert.deepEqual(mathTokens(renderRich(q + '字符 ' + D + q)), []);
  assert.deepEqual(mathTokens(renderRich(q + 'price ' + D + '8' + q)), []);
  assert.deepEqual(mathTokens(renderRich(q + 'echo ' + D + 'HOME' + q)), []);
  assert.deepEqual(mathTokens(renderRich(q + D + '{PATH}' + q)), []);
  assert.deepEqual(mathTokens(renderRich(q + 'say ' + D + 'hello world' + D + q)), []);
});

test('单字母公式体送进 KaTeX 不报错（$?$ / $0$ / $S$）', async () => {
  const katex = (await import('katex')).default;
  for (const tex of ['?', '0', 'S', 'x', 'x_1', 'p']) {
    assert.doesNotThrow(() => katex.renderToString(tex, { throwOnError: true, strict: 'ignore' }), tex);
  }
});

test('表格拍平残渣（含 & 且无 \\begin{）不包成公式', () => {
  assert.deepEqual(mathTokens(renderRich('left \\hline 3 & 2 \\text{x} right')), []);
  assert.equal(mathTokens(renderRich('\\begin{array}{c|c} a & b \\end{array}')).length, 1);
});

test('字形重复折叠：数学字形 + ASCII 转写只留一份', () => {
  assert.equal(foldMathGlyphDuplication('共有 𝑛n 个场景'), '共有 n 个场景');
  assert.equal(foldMathGlyphDuplication('有 𝑥x 只羊'), '有 x 只羊');
  assert.equal(foldMathGlyphDuplication('3≤𝑛≤503≤n≤50'), '3≤n≤50');
  assert.equal(foldMathGlyphDuplication('2020 年'), '2020 年');
  assert.equal(foldMathGlyphDuplication('𝑆=𝑠1𝑠2S=s1s2'), 'S=s1s2');
  const once = foldMathGlyphDuplication('共有 𝑛n 个场景');
  assert.equal(foldMathGlyphDuplication(once), once);
});

test('字形折叠后仍正常渲染（译文里的重复不再露出数学字形）', () => {
  const html = renderRich('共有 𝑛n 个场景，3≤𝑛≤503≤n≤50。');
  assert.equal(/[\u{1D400}-\u{1D7FF}]/u.test(visible(html)), false);
  assert.match(visible(html), /共有 n 个场景/);
});

test('孤 $ 收尾：中文语境的残标去掉，英文金额保持原样', () => {
  assert.equal(dropOrphanDollars('那么 "$( X ) + ( Y )"'), '那么 "( X ) + ( Y )"');
  assert.equal(dropOrphanDollars('cost $5 only'), 'cost $5 only');
  assert.equal(dropOrphanDollars('上限 $10'), '上限 $10');
});

test('成对 $ 里是中文/日文正文时只留正文（不渲染出 KaTeX 错误框）', () => {
  const md = '保証される（$1 ≦ b_i ≦ N かつ b_i ≠ i$）。';
  const html = renderRich(md);
  assert.deepEqual(mathTokens(html), []);
  assert.equal(visible(html).includes('$'), false);
  assert.match(visible(html), /1 ≦ b_i ≦ N かつ/);
});
test('renderRich: 公式内容里的 <br /> 残渣被清掉（牛客数组公式），< 比较符不受影响', () => {
  const md = '$\\begin{array}{rll}<br />4^{-1} & = & \\left(4^{M-2} \\bmod M\\right) \\\\<br />\n\\end{array}$';
  const html = renderRich(md);
  assert.equal(html.includes('<br'), false);
  // 真正的比较符（转义后的 &lt;）不受影响
  const cmp = renderRich('$a &lt; b$');
  assert.equal(cmp.includes('zs-math'), true);
  assert.equal(cmp.includes('&amp;lt;') || cmp.includes('&lt;'), true);
});
