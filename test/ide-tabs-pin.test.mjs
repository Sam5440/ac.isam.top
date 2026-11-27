import test from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTab,
  normalizeIdeTabs,
  openTab,
  pinTab,
  restoreIdeTabs,
  tabsToClose,
} from '../lib/ide-tabs.js';

test('tabs: 置顶标签固定在最左侧且不重复', () => {
  let s = openTab(['a.cpp', 'b.cpp'], null, 'c.cpp');
  assert.deepEqual(s.openPaths, ['a.cpp', 'b.cpp', 'c.cpp']);
  s = pinTab(s.openPaths, 'c.cpp');
  assert.deepEqual(s.openPaths, ['c.cpp', 'a.cpp', 'b.cpp']);
  assert.equal(s.pinnedPath, 'c.cpp');
  // 打开新文件时置顶标签仍在首位
  s = openTab(s.openPaths, s.pinnedPath, 'd.cpp');
  assert.deepEqual(s.openPaths, ['c.cpp', 'a.cpp', 'b.cpp', 'd.cpp']);
});

test('tabs: 关闭置顶标签会清除置顶状态', () => {
  const s = closeTab(['c.cpp', 'a.cpp'], 'c.cpp', 'c.cpp');
  assert.deepEqual(s.openPaths, ['a.cpp']);
  assert.equal(s.pinnedPath, null);
});

test('tabs: 批量关闭模式（其他/全部/左/右）', () => {
  const open = ['A', 'B', 'C', 'D'];
  assert.deepEqual(tabsToClose(open, 'C', 'others'), ['A', 'B', 'D']);
  assert.deepEqual(tabsToClose(open, 'C', 'all'), open);
  assert.deepEqual(tabsToClose(open, 'C', 'left'), ['A', 'B']);
  assert.deepEqual(tabsToClose(open, 'C', 'right'), ['D']);
  assert.deepEqual(tabsToClose(open, 'missing', 'others'), []);
});

test('tabs: 置顶字段持久化与恢复', () => {
  const norm = normalizeIdeTabs({ openPaths: ['a', 'b'], activePath: 'a', pinnedPath: 'b' });
  assert.equal(norm.pinnedPath, 'b');
  const invalid = normalizeIdeTabs({ openPaths: ['a'], activePath: 'a', pinnedPath: 'zzz' });
  assert.equal(invalid.pinnedPath, null);
  const restored = restoreIdeTabs({ openPaths: ['a', 'b'], activePath: 'b', pinnedPath: 'b' }, ['a', 'b']);
  assert.deepEqual(restored, { openPaths: ['a', 'b'], activePath: 'b', pinnedPath: 'b' });
});
