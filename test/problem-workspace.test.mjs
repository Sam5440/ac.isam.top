import test from 'node:test';
import assert from 'node:assert/strict';

import {
  contestFolderName,
  fenced,
  problemBaseName,
  problemMarkdown,
  problemWorkspacePlan,
  safeSegment,
} from '../lib/problem-workspace.mjs';

test('safeSegment: 清洗 Windows 非法字符并压空白', () => {
  assert.equal(safeSegment('AtCoder Regular Contest++ 234'), 'AtCoder-Regular-Contest++-234');
  assert.equal(safeSegment('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  assert.equal(safeSegment('  第 234 场  '), '第-234-场');
  assert.equal(safeSegment('...'), 'untitled');
  assert.equal(safeSegment(''), 'untitled');
  assert.equal(safeSegment('CON'), '_CON');
  assert.equal(safeSegment('x'.repeat(80), 'f', 10), 'x'.repeat(10));
});

test('contestFolderName: 一场比赛只有一个目录（比赛编号 + 名字）', () => {
  const folder = contestFolderName(
    { id: 'arc234', titleZh: '第 234 场 AtCoder Regular Contest++' },
    { id: 'arc234_b' },
  );
  assert.match(folder, /^arc234-/);
  // 同场比赛的两道题必须落在同一个目录里
  assert.equal(
    contestFolderName({ id: 'arc234', titleZh: '第 234 场 AtCoder Regular Contest++' }, { id: 'arc234_c' }),
    folder,
  );
  assert.ok(!folder.includes('arc234_b'));
  assert.ok(!/[\\/:*?"<>|]/.test(folder));
});

test('problemWorkspacePlan: 题号作文件名，语言决定扩展名', () => {
  const base = { contest: { id: 'arc234', titleZh: '第 234 场' }, problem: { id: 'arc234_b', index: 'B' } };
  const cpp = problemWorkspacePlan({ ...base, language: 'cpp' });
  assert.equal(cpp.codePath, `${cpp.folder}/B.cpp`);
  assert.equal(cpp.mdPath, `${cpp.folder}/B.md`);
  const py = problemWorkspacePlan({ ...base, language: 'python' });
  assert.equal(py.codePath, `${py.folder}/B.py`);
  // 没有题号时回落到题目 id
  assert.equal(problemBaseName({ id: 'arc234_b' }), 'arc234_b');
});

test('fenced: 内容里含反引号时自动加长围栏', () => {
  assert.equal(fenced('1 2 3', 'text'), '```text\n1 2 3\n```');
  const out = fenced('code ``` inside');
  assert.ok(out.startsWith('````'));
  assert.ok(out.endsWith('````'));
});

test('problemMarkdown: 含标题、中英文题面、样例与原题链接', () => {
  const md = problemMarkdown(
    {
      id: 'arc234_b',
      platform: 'atcoder',
      index: 'B',
      title: 'Three Vertices',
      titleZh: '三个顶点',
      timeLimitMs: 2000,
      memoryLimitMb: 1024,
      url: 'https://atcoder.jp/contests/arc234/tasks/arc234_b',
      statementMd: '## Problem Statement\n\nGiven a graph $G$.',
      statementZhMd: '## 题目描述\n\n给定一张图 $G$。',
      samples: [
        { input: '3 2\n1 2\n', output: 'Yes\n' },
        { input: '2 1\n', output: 'No\n', noteZh: '注意 $N=2$。' },
      ],
    },
    { contest: { id: 'arc234', titleZh: '第 234 场' } },
  );
  assert.match(md, /^# B\. 三个顶点/m);
  assert.match(md, /## 中文题面/);
  assert.match(md, /## 英文原文/);
  assert.match(md, /```text\n3 2\n1 2/);
  assert.match(md, /### 样例 2/);
  assert.match(md, /注意 \$N=2\$。/);
  assert.match(md, /https:\/\/atcoder\.jp\/contests\/arc234\/tasks\/arc234_b/);
});
