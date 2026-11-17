import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCfProblemsPage } from '../scripts/lib/cf.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');

/**
 * Codeforces 题面里的数学用 $$$…$$$ 定界，浏览器端由 MathJax 在页面里就地渲染。
 * 抓取时同一份代码会遇到两种页面状态：
 *   1. 还没渲染（原文 $$$…$$$ 直接出现在 HTML 文本里，normalizeCfMath 处理）；
 *   2. 已渲染（MathJax v2 生成 <span class="MathJax_Preview"> / <span class="MathJax">
 *      → <nobr aria-hidden> 字形树 + <span class="MJX_Assistive_MathML">，原始 TeX 保存在
 *      紧随其后的 <script type="math/tex"> 里）。
 * 旧实现用 node.type === 'tag' 过滤节点，而 htmlparser2 给 <script> 的 type 是 'script'
 * → 权威 TeX 整段丢弃，只剩生成物里的 unicode 字形 + MathML 文本两份重复（"𝑛n"）。
 *
 * fixture：
 * - cf-gym-106797l-mathjax.html：已渲染的 106797L（11 个行内公式）；
 * - cf-gym-104869b-raw.html：未渲染的 104869B（$$$ 原文），配 .expected.json 黄金快照，
 *   用来守住「未渲染页解析结果一字不变」。
 */
const MATHJAX_FIXTURE = 'cf-gym-106797l-mathjax.html';
const RAW_FIXTURE = 'cf-gym-104869b-raw.html';

/** MathJax 字形区（U+1D400–U+1D7FF：数学字母数字）——题面 md 里出现即说明吃到了渲染产物。 */
const MATH_GLYPH_RE = /[\u{1D400}-\u{1D7FF}]/u;

/** 去掉 $…$ / $$…$$ 之后仍残留的 TeX 命令（说明公式没被包进定界符）。 */
function bareTexCommands(md) {
  const stripped = String(md)
    .replace(/\$\$[\s\S]+?\$\$/g, '')
    .replace(/\$[^$]+?\$/g, '');
  return stripped.match(/\\[a-zA-Z]{2,}/g) || [];
}

/** 最小可解析的 problem-statement 外壳（只保留 parseCfProblemsPage 读取的头部字段）。 */
function wrapStatement(body) {
  return [
    '<div class="problem-statement">',
    '<div class="header"><div class="title">A. Test</div>',
    '<div class="time-limit"><div class="property-title">time limit per test</div>1 second</div>',
    '<div class="memory-limit"><div class="property-title">memory limit per test</div>256 megabytes</div></div>',
    body,
    '</div>',
  ].join('');
}

const parseOne = (html) => {
  const out = parseCfProblemsPage(html, 1);
  assert.equal(out.length, 1, '应解析出一个 problem-statement');
  return out[0];
};

test('parseCfProblemsPage: MathJax 渲染页还原 $…$，不残留字形与重复文本（106797L）', () => {
  const p = parseOne(fixture(MATHJAX_FIXTURE));
  const md = p.statementMd;

  assert.equal(p.index, 'L');
  assert.equal(p.title, 'Lyrical Leisure');
  assert.equal(p.timeLimitMs, 1000);
  assert.equal(p.memoryLimitMb, 1024);
  assert.equal(p.samples.length, 4);
  assert.equal(p.samples[0].input, '6 5\n');
  assert.equal(p.samples[0].output, 'banana\n');

  // 公式必须由 <script type="math/tex"> 还原成行内公式
  assert.ok(
    md.includes('Given two lengths $n$ and $k$, she would like to find a method'),
    'Given two lengths 处的公式应还原为 $n$ / $k$',
  );
  assert.ok(md.includes('whose longest palindromic substring is of length $k$'));
  assert.ok(md.includes('A substring of a string $s$ is a sequence of consecutive characters of $s$.'));
  // mode/display 无关的行内公式，TeX 命令原样保留在定界符内
  assert.ok(md.includes('($1\\leq k\\leq n\\leq 5000$)'), '约束里的 TeX 命令应整体落在 $…$ 内');
  assert.ok(md.includes('Output a string of length $n$'));

  // 不得出现 MathJax 字形（"𝑛"）、也不得出现「字形+MathML」两份重复的 "𝑛n"
  assert.doesNotMatch(md, MATH_GLYPH_RE, '题面不得含 U+1D400–U+1D7FF 字形');
  assert.ok(!md.includes('𝑛n'), '不得出现 unicode 字形 + assistive MathML 的重复');
  // 生成物不该漏进正文
  assert.doesNotMatch(md, /MathJax|MJX_Assistive_MathML|aria-hidden/);
  // 去定界符后不得残留裸 TeX（否则站上 KaTeX 不会渲染）
  assert.deepEqual(bareTexCommands(md), []);
  assert.deepEqual(bareTexCommands(p.samples.map((s) => s.output + s.input).join('\n')), []);
});

test('parseCfProblemsPage: 未渲染原始页（$$$ 定界）解析结果与改动前逐字一致（104869B）', () => {
  const expected = JSON.parse(fixture('cf-gym-104869b-raw.expected.json'));
  const actual = parseCfProblemsPage(fixture(RAW_FIXTURE), 106797);
  // 黄金快照是引入 MathJax 修复前抓取的解析结果：原始页不含 <script>，不该有任何变化
  assert.deepEqual(actual, expected);
  const md = actual[0].statementMd;
  assert.doesNotMatch(md, MATH_GLYPH_RE);
  assert.deepEqual(bareTexCommands(md), []);
  assert.ok(md.includes('is called a *turning permutation*.'));
});

test('parseCfProblemsPage: <script type="math/tex; mode=display"> 输出 $$…$$ 块级公式', () => {
  const p = parseOne(
    wrapStatement(
      '<div><p>Equation:</p><script type="math/tex; mode=display">\\sum_{i=1}^{n} i</script><p>done</p></div>',
    ),
  );
  assert.ok(p.statementMd.includes('$$\\sum_{i=1}^{n} i$$'), JSON.stringify(p.statementMd));
  // 块级公式独占一段，不并进相邻段落
  assert.match(p.statementMd, /Equation:\n\n\$\$[\s\S]+\$\$\n\ndone/);
  assert.deepEqual(bareTexCommands(p.statementMd), []);
});

test('parseCfProblemsPage: 只有 MathJax 生成物（无 script 兜底）时宁可为空也不输出重复字形', () => {
  // MathJax v2 字形树（PreviewHTML / HTML-CSS）+ assistive MathML
  const v2 = parseOne(
    wrapStatement(
      '<div><p>x <span class="MathJax_Preview"><span class="MJXp-mi">𝑛</span></span>' +
        '<span class="MathJax" id="MathJax-Element-1-Frame" role="presentation">' +
        '<nobr aria-hidden="true"><span class="mi">𝑛</span></nobr>' +
        '<span class="MJX_Assistive_MathML"><math><mi>n</mi></math></span></span> y</p></div>',
    ),
  );
  assert.doesNotMatch(v2.statementMd, MATH_GLYPH_RE);
  assert.ok(!v2.statementMd.includes('n'), JSON.stringify(v2.statementMd));

  // MathJax v3（<mjx-container>）
  const v3 = parseOne(
    wrapStatement(
      '<div><p>x <mjx-container class="MathJax" jax="CHTML"><mjx-math><mjx-mi>𝑛</mjx-mi></mjx-math>' +
        '<mjx-assistive-mml><math><mi>n</mi></math></mjx-assistive-mml></mjx-container> y</p></div>',
    ),
  );
  assert.doesNotMatch(v3.statementMd, MATH_GLYPH_RE);
  assert.ok(!v3.statementMd.includes('n'), JSON.stringify(v3.statementMd));
});

test('parseCfProblemsPage: 普通 <script>/<style> 内容不进题面', () => {
  const p = parseOne(
    wrapStatement(
      '<div><style>.a{color:red}</style><p>Hi<script>var x = 1 < 2;</script>there</p></div>',
    ),
  );
  assert.equal(p.statementMd, 'Hithere');
});

test('parseCfProblemsPage: <table> 嵌在 <p> 内仍还原成 GFM 表格', () => {
  // htmlparser2 不做 HTML5 隐式闭合，CF 题面里的表格可能被嵌套进 <p>；
  // 旧实现落到行内分支会把所有单元格拍平成一行（106787E 等 16 个题面的现状）。
  const p = parseOne(
    wrapStatement(
      '<div><p>Before<table><tr><th>Phase</th><th>Eb</th></tr><tr><td>Stock</td><td>18</td></tr></table>After</p></div>',
    ),
  );
  assert.ok(
    p.statementMd.includes('| Phase | Eb |\n| --- | --- |\n| Stock | 18 |'),
    JSON.stringify(p.statementMd),
  );
  assert.ok(p.statementMd.startsWith('Before\n\n| Phase'));
});
