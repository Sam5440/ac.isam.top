import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdeSelection, planIdeDeletion, planIdeFileTransfer, transferIdeMap } from '../lib/ide-file-ops.mjs';

const file = (path, content = path) => ({ path, name: path.split('/').pop(), content, type: 'file' });
const dir = (path) => ({ path, name: path.split('/').pop(), type: 'dir' });

test('多选规范化时目录会包含其后代，避免对子项重复处理', () => {
  assert.deepEqual(normalizeIdeSelection([dir('src'), file('src/a.cpp'), file('main.cpp')]), [
    { path: 'src', type: 'dir' },
    { path: 'main.cpp', type: 'file' },
  ]);
});

test('复制多选文件及目录，保留层级并生成稳定的非冲突副本', () => {
  const records = [dir('src'), dir('src/sub'), file('src/main.cpp', 'int main() {}'), file('src/sub/util.hpp', '#pragma once'), file('main.cpp')];
  const plan = planIdeFileTransfer({ records, selected: [dir('src'), file('main.cpp')], mode: 'copy', copyRecords: records, now: 7 });
  assert.deepEqual([...plan.fileMap], [['src/main.cpp', 'src copy/main.cpp'], ['src/sub/util.hpp', 'src copy/sub/util.hpp'], ['main.cpp', 'main copy.cpp']]);
  assert.deepEqual(plan.dels, []);
  assert.equal(plan.puts.find((entry) => entry.path === 'src copy/main.cpp').content, 'int main() {}');
  assert.ok(plan.puts.some((entry) => entry.path === 'src copy/sub' && entry.type === 'dir'));
});

test('复制支持空文件夹；移动会原子改名、重名加后缀并防止粘入自身', () => {
  const records = [dir('src'), file('src/a.txt', 'A'), dir('dest'), dir('empty'), dir('dest/src'), file('dest/src/other.txt')];
  const copyEmpty = planIdeFileTransfer({ records, selected: [dir('empty')], copyRecords: records, mode: 'copy', destination: 'dest' });
  assert.ok(copyEmpty.puts.some((entry) => entry.path === 'dest/empty' && entry.type === 'dir'));

  const move = planIdeFileTransfer({ records, selected: [dir('src')], mode: 'cut', destination: 'dest' });
  assert.deepEqual([...move.fileMap], [['src/a.txt', 'dest/src copy/a.txt']]);
  assert.ok(move.dels.includes('src/a.txt'));
  assert.ok(move.dels.includes('src'));
  assert.throws(() => planIdeFileTransfer({ records, selected: [dir('src')], mode: 'cut', destination: 'src/nested' }), /自身/);
});

test('剪切到原目录不覆盖内容，剪贴板样例映射复制或移动', () => {
  const records = [dir('src'), file('src/a.cpp', 'saved')];
  const same = planIdeFileTransfer({ records, selected: [file('src/a.cpp')], mode: 'cut', destination: 'src' });
  assert.deepEqual(same.puts, []);
  const copied = transferIdeMap({ 'src/a.cpp': { cases: ['x'] } }, new Map([['src/a.cpp', 'src copy.cpp']]), 'copy');
  assert.deepEqual(copied, { 'src/a.cpp': { cases: ['x'] }, 'src copy.cpp': { cases: ['x'] } });
  const moved = transferIdeMap(copied, new Map([['src copy.cpp', 'src/a.cpp']]), 'cut');
  assert.deepEqual(moved, { 'src/a.cpp': { cases: ['x'] } });
});

test('多选删除按选中目录递归展开，并去掉嵌套项重复路径', () => {
  const records = [dir('src'), file('src/a'), dir('src/sub'), file('src/sub/b'), file('main.cpp')];
  assert.deepEqual(planIdeDeletion(records, [dir('src'), file('src/sub/b'), file('main.cpp')]), {
    paths: ['src', 'src/a', 'src/sub', 'src/sub/b', 'main.cpp'],
    files: ['src/a', 'src/sub/b', 'main.cpp'],
    folders: ['src', 'src/sub'],
  });
});
