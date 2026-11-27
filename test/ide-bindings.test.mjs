import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BINDINGS_FILE,
  bindingsPathOf,
  buildBindings,
  chatsFromBindings,
  fileStats,
  folderOfPath,
  isBindingsPath,
  normalizeBindings,
  pathHue,
  samplesFromBindings,
  sortEntries,
} from '../lib/ide-bindings.mjs';
import {
  UNASSIGNED_FOLDER,
  contestFolderName,
  problemWorkspacePlan,
  safeSegment,
} from '../lib/problem-workspace.mjs';

const problem = {
  platform: 'codeforces',
  id: '1582F1',
  index: 'F1',
  title: 'Korney Korneevich and XOR (easy version)',
  titleZh: 'Korney Korneevich 与 XOR（简单版）',
};

test('bindings: 一场比赛只有一个文件夹，不同题号落在同一目录', () => {
  const contest = { id: '1582', title: '第 750 场 Codeforces Round（第 2 组）' };
  const a = problemWorkspacePlan({ contest, problem, language: 'cpp' });
  const b = problemWorkspacePlan({ contest, problem: { ...problem, id: '1582F2', index: 'F2' }, language: 'cpp' });
  assert.equal(a.folder, b.folder);
  assert.equal(a.codePath, `${contestFolderName(contest, problem)}/F1.cpp`);
  assert.equal(b.codePath, `${a.folder}/F2.cpp`);
  assert.equal(a.bindingsPath, `${a.folder}/${BINDINGS_FILE}`);
});

test('bindings: 没有比赛归属时落到「未归属比赛」并带平台前缀', () => {
  const plan = problemWorkspacePlan({ contest: null, problem: { platform: 'atcoder', id: 'abc123_a', index: 'A' } });
  assert.equal(plan.folder, UNASSIGNED_FOLDER);
  assert.equal(plan.codePath, `${UNASSIGNED_FOLDER}/atcoder-abc123_a.cpp`);
  assert.equal(safeSegment('a/b:c'), 'a-b-c');
});

test('bindings: 生成清单按文件夹分组，只收录有绑定的文件', () => {
  const files = [
    { path: '1582-x/F1.cpp' },
    { path: '1582-x/F2.cpp' },
    { path: '1582-x/workspace.json' },
    { path: 'other/A.cpp' },
  ];
  const samplesMap = {
    '1582-x/F1.cpp': { problem, cases: [{ input: '1', output: '2' }] },
    '1582-x/F2.cpp': { problem: { ...problem, id: '1582F2' }, cases: [] },
  };
  const map = buildBindings({ contest: { id: '1582' }, files, samplesMap });
  assert.deepEqual(Object.keys(map).sort(), ['1582-x', 'other']);
  assert.deepEqual(Object.keys(map['1582-x'].files), ['F1.cpp', 'F2.cpp']);
  assert.deepEqual(map['1582-x'].files['F1.cpp'].samples, [{ input: '1', output: '2' }]);
  assert.deepEqual(map.other.files, {});
  assert.equal(map['1582-x'].files['F1.cpp'].problem.index, 'F1');
});

test('bindings: 清单往返（归一化 → 样例 / 对话）', () => {
  const raw = {
    format: 'ac-ide-bindings',
    version: 1,
    contest: { id: '1582' },
    files: {
      'F1.cpp': {
        problem,
        samples: [{ input: '1', output: '2' }],
        chat: { activeId: 's1', sessions: [{ id: 's1', title: '会话', messages: [{ role: 'user', content: 'hi' }] }] },
      },
    },
  };
  const b = normalizeBindings(raw);
  assert.equal(b.files['F1.cpp'].problem.id, '1582F1');
  assert.deepEqual(samplesFromBindings(b, '1582-x'), {
    '1582-x/F1.cpp': { problem, cases: [{ input: '1', output: '2' }] },
  });
  assert.equal(chatsFromBindings(b)['1582F1'].sessions[0].messages[0].content, 'hi');
});

test('bindings: 损坏/脏数据一律丢弃', () => {
  assert.equal(normalizeBindings('not json'), null);
  assert.equal(normalizeBindings('[]'), null);
  const b = normalizeBindings({
    files: {
      'bad/name.cpp': { problem },
      'a.cpp': { problem: { platform: 'x' } },
      'b.cpp': { samples: 'nope' },
      'c.cpp': { problem, samples: [{ input: 1, output: 2 }] },
    },
  });
  assert.deepEqual(Object.keys(b.files), ['c.cpp']);
  assert.deepEqual(b.files['c.cpp'].samples, [{ input: '1', output: '2' }]);
});

test('bindings: 路径工具与统计', () => {
  assert.equal(folderOfPath('a/b/c.cpp'), 'a/b');
  assert.equal(folderOfPath('c.cpp'), '');
  assert.equal(isBindingsPath('a/b/workspace.json'), true);
  assert.equal(isBindingsPath('a/b/workspace2.json'), false);
  assert.equal(bindingsPathOf('a/b/'), 'a/b/workspace.json');
  assert.equal(bindingsPathOf(''), 'workspace.json');
  assert.deepEqual(fileStats('a\nb\n'), { bytes: 4, lines: 3 });
  assert.deepEqual(fileStats(''), { bytes: 0, lines: 0 });
});

test('bindings: 路径色相稳定且相邻不同', () => {
  assert.equal(pathHue('a.cpp'), pathHue('a.cpp'));
  assert.notEqual(pathHue('a.cpp'), pathHue('b.cpp'));
  assert.ok(pathHue('') >= 0 && pathHue('') < 360);
});

test('bindings: 排序（名称 / 创建 / 编辑，正反）', () => {
  const list = [
    { name: 'b.cpp', createdAt: 2, updatedAt: 30 },
    { name: 'a.cpp', createdAt: 3, updatedAt: 10 },
    { name: 'c.cpp', createdAt: 1, updatedAt: 20 },
  ];
  assert.deepEqual(sortEntries(list, { by: 'name' }).map((x) => x.name), ['a.cpp', 'b.cpp', 'c.cpp']);
  assert.deepEqual(sortEntries(list, { by: 'name', dir: 'desc' }).map((x) => x.name), ['c.cpp', 'b.cpp', 'a.cpp']);
  assert.deepEqual(sortEntries(list, { by: 'created' }).map((x) => x.name), ['c.cpp', 'b.cpp', 'a.cpp']);
  assert.deepEqual(sortEntries(list, { by: 'updated', dir: 'desc' }).map((x) => x.name), ['b.cpp', 'c.cpp', 'a.cpp']);
  assert.deepEqual(sortEntries(null), []);
});
