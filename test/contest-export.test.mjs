import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ICPC_SHEET_CSS,
  buildContestExportHtml,
  buildProblemBodyHtml,
  buildSamplesHtml,
  stripProblemStatementHeading,
} from '../lib/contest-export.mjs';
import {
  contestExportFileBase,
  normalizeExportMode,
  siteProblemUrl,
} from '../lib/contest-export-modes.mjs';

const contest = {
  id: 'arc234',
  platform: 'atcoder',
  title: 'AtCoder Regular Contest 234',
  titleZh: '第 234 场 AtCoder Regular Contest',
  url: 'https://atcoder.jp/contests/arc234',
  startTime: '2026-11-25T12:00:00.000Z',
  durationSeconds: 7200,
};

const problems = [
  {
    platform: 'atcoder',
    id: 'arc234_a',
    index: 'A',
    label: 'A',
    title: 'Three Vertices',
    titleZh: '三个顶点',
    url: 'https://atcoder.jp/contests/arc234/tasks/arc234_a',
    timeLimitMs: 2000,
    memoryLimitMb: 1024,
    difficulty: 800,
    points: 100,
    statementMd: '## Problem Statement\n\nYou are given $N$ vertices.',
    statementZhMd: '## 题目描述\n\n给定一个有 $N$ 个顶点的图。',
    samples: [{ input: '3 2\n', output: 'Yes\n', note: 'The answer is Yes.', noteZh: '答案是 Yes。' }],
  },
  {
    platform: 'atcoder',
    id: 'arc234_b',
    index: 'B',
    label: 'B',
    title: 'Graph Coloring',
    titleZh: '图染色',
    url: 'https://atcoder.jp/contests/arc234/tasks/arc234_b',
    statementMd: '## Problem Statement\n\nColor the graph.\n\n## Input\n\nA graph.',
    statementZhMd: null,
    samples: [{ input: '1 2\n', output: '3\n', note: 'InputCopy\n\nOutputCopy' }],
  },
  {
    platform: 'codeforces',
    id: '1234X',
    label: '03C',
    title: 'Missing Problem',
    titleZh: null,
    found: false,
    url: 'https://codeforces.com/problemset/problem/1234/X',
  },
];

const origin = 'https://ac.yslsy.top';
const siteUrl = `${origin}/contests/atcoder/arc234`;

const build = (mode, list = problems) =>
  buildContestExportHtml({ contest, problems: list, mode, origin, siteUrl, exportedAt: '2026-11-25' });

test('buildContestExportHtml: 纯中文只排中文，缺译文回退英文并标注', () => {
  const html = build('zh');
  assert.match(html, /给定一个有 .* 个顶点的图/);
  assert.match(html, /本题暂无中文翻译，以下为英文原文/);
  assert.match(html, /Color the graph\./);
  assert.match(html, /答案是 Yes。/);
  assert.doesNotMatch(html, /The answer is Yes\./);
  assert.doesNotMatch(html, /class="lang-block"/);
  assert.match(html, /样例输入 1/);
});

test('buildContestExportHtml: 纯英文用英文题面与英文样例说明', () => {
  const html = build('en');
  assert.match(html, /You are given/);
  assert.doesNotMatch(html, /给定一个有/);
  assert.match(html, /The answer is Yes\./);
  assert.doesNotMatch(html, /答案是 Yes。/);
  assert.match(html, /Sample Input 1/);
  assert.match(html, /Sample Output 1/);
});

test('buildContestExportHtml: 中英对照按单栏依次排版，每题仍强制新页', () => {
  const html = build('both');
  assert.match(html, /class="lang-block"/);
  assert.match(html, /<span class="lang-tag">中文<\/span>/);
  assert.match(html, /<span class="lang-tag">English<\/span>/);
  assert.match(html, /给定一个有/);
  assert.match(html, /You are given/);
  assert.match(html, /break-before: page/);
  assert.doesNotMatch(html, /class="side-by-side"/);
});

test('buildContestExportHtml: 题头带题号/标题/时限，封面列出题单', () => {
  const html = build('zh');
  assert.match(html, /Problem A/);
  assert.match(html, /时间限制：2 秒/);
  assert.match(html, /内存限制：1024 MB/);
  assert.match(html, /class="cover-problems"/);
  assert.match(html, /\.icpc-cover \+ \.problem-sheet \{ break-before: auto/);
  assert.match(html, /ICPC-Style Problem Set/);
  assert.match(html, /第 234 场 AtCoder Regular Contest/);
});

test('buildContestExportHtml: 每题都带本站与原题绝对链接，未收录题给原题链接', () => {
  const html = build('zh');
  assert.match(html, new RegExp(`${origin.replace(/\./g, '\\.')}\\/problems\\/atcoder\\/arc234_a`));
  assert.match(html, /https:\/\/atcoder\.jp\/contests\/arc234\/tasks\/arc234_a/);
  assert.match(html, /https:\/\/codeforces\.com\/problemset\/problem\/1234\/X/);
  assert.match(html, /本站未收录本题/);
  assert.match(html, new RegExp(siteUrl.replace(/\./g, '\\.')));
  assert.match(html, /https:\/\/atcoder\.jp\/contests\/arc234/);
});

test('buildContestExportHtml: 标题与链接做 HTML 转义', () => {
  const evil = [{
    platform: 'codeforces',
    id: '1A',
    label: 'A',
    title: '<script>alert(1)</script>',
    titleZh: null,
    url: 'https://codeforces.com/problemset/problem/1/A',
    statementMd: 'ok',
  }];
  const html = build('en', evil);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('stripProblemStatementHeading: 去掉各平台自带的重复标题', () => {
  assert.equal(stripProblemStatementHeading('## Problem Statement\n\nA'), 'A');
  assert.equal(stripProblemStatementHeading('### 题目描述\n\nB'), 'B');
  assert.equal(stripProblemStatementHeading('## Description\n\nC'), 'C');
  assert.equal(stripProblemStatementHeading('## Input\n\nD'), '## Input\n\nD');
});

test('buildSamplesHtml: 过滤 CF 的 InputCopy/OutputCopy 样板说明', () => {
  const html = buildSamplesHtml([{ input: '1', output: '2', note: 'InputCopy\n\nOutputCopy' }], 'en');
  assert.match(html, /Sample Input 1/);
  assert.doesNotMatch(html, /InputCopy/);
  assert.doesNotMatch(html, /sample-note/);
});

test('buildSamplesHtml: both 同时给英文与中文说明', () => {
  const html = buildSamplesHtml(
    [{ input: '1', output: '2', note: 'English note.', noteZh: '中文说明。' }],
    'both',
  );
  assert.match(html, /English note\./);
  assert.match(html, /中文说明。/);
  assert.equal((html.match(/data-note-lang=/g) || []).length, 2);
});

test('buildProblemBodyHtml: PDF 版不输出长链接，只留平台/原题号', () => {
  const html = buildProblemBodyHtml({ problem: problems[0], mode: 'zh', origin, includeLinks: false });
  assert.doesNotMatch(html, /https:\/\/ac\.yslsy\.top/);
  assert.match(html, /来源：AtCoder · arc234_a/);
});

test('buildProblemBodyHtml: 去掉 marked 留下的空段落，避免分页坐标漂移', () => {
  const html = buildProblemBodyHtml({
    problem: { ...problems[0], statementMd: 'First paragraph.\n\n\n\nSecond paragraph.' },
    mode: 'en',
    origin,
    includeLinks: false,
  });
  assert.doesNotMatch(html, /<p(?:\s[^>]*)?>\s*<\/p>/i);
  assert.match(html, /First paragraph\./);
  assert.match(html, /Second paragraph\./);
});

test('ICPC_SHEET_CSS: 作用域限制在 .icpc-sheet 内，不污染站内样式', () => {
  assert.match(ICPC_SHEET_CSS, /\.icpc-sheet/);
  assert.doesNotMatch(ICPC_SHEET_CSS, /^\s*body\s*\{/m);
});

test('mode 与文件名工具', () => {
  assert.equal(normalizeExportMode('both'), 'both');
  assert.equal(normalizeExportMode('xx'), 'zh');
  assert.equal(contestExportFileBase({ id: 'arc234' }, 'both'), 'contest-arc234-both');
  assert.equal(contestExportFileBase({ id: 'gym 106/728' }, 'en'), 'contest-gym-106-728-en');
  assert.equal(siteProblemUrl('https://ac.yslsy.top/', 'atcoder', 'arc234_a'), 'https://ac.yslsy.top/problems/atcoder/arc234_a');
  assert.equal(siteProblemUrl('http://localhost:3000', 'codeforces', '1234B2'), 'http://localhost:3000/problems/codeforces/1234B2');
});
