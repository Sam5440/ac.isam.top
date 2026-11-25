import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContestExportHtml } from '../lib/contest-export.mjs';
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
    statementMd: '## Problem Statement\n\nColor the graph.',
    statementZhMd: null,
    samples: [],
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
  assert.match(html, /Color the graph\./); // 回退后确实带上英文原文
  assert.match(html, /答案是 Yes。/);
  assert.doesNotMatch(html, /The answer is Yes\./);
  assert.doesNotMatch(html, /class="side-by-side"/);
});

test('buildContestExportHtml: 纯英文用英文题面与英文样例说明', () => {
  const html = build('en');
  assert.match(html, /You are given/);
  assert.doesNotMatch(html, /给定一个有/);
  assert.match(html, /The answer is Yes\./);
  assert.doesNotMatch(html, /答案是 Yes。/);
  assert.match(html, /Samples/);
});

test('buildContestExportHtml: 中英对照左右两栏且每页带两侧内容', () => {
  const html = build('both');
  assert.match(html, /class="side-by-side"/);
  assert.match(html, /<div class="side"><div class="side-tag">中文<\/div>/);
  assert.match(html, /<div class="side"><div class="side-tag">ENGLISH<\/div>/);
  assert.match(html, /给定一个有/);
  assert.match(html, /You are given/);
  assert.match(html, /break-before: page/);
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

test('mode 与文件名工具', () => {
  assert.equal(normalizeExportMode('both'), 'both');
  assert.equal(normalizeExportMode('xx'), 'zh');
  assert.equal(contestExportFileBase({ id: 'arc234' }, 'both'), 'contest-arc234-both');
  assert.equal(contestExportFileBase({ id: 'gym 106/728' }, 'en'), 'contest-gym-106-728-en');
  assert.equal(siteProblemUrl('https://ac.yslsy.top/', 'atcoder', 'arc234_a'), 'https://ac.yslsy.top/problems/atcoder/arc234_a');
  assert.equal(siteProblemUrl('http://localhost:3000', 'codeforces', '1234B2'), 'http://localhost:3000/problems/codeforces/1234B2');
});