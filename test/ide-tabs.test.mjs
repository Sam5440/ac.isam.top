import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IDE_TABS_KEY,
  loadIdeTabs,
  normalizeIdeTabs,
  restoreIdeTabs,
  saveIdeTabs,
} from '../lib/ide-tabs.js';

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('ide-tabs: 存取往返 + 首次无记录返回 null', () => {
  const store = memStore();
  assert.equal(loadIdeTabs(store), null);
  saveIdeTabs({ openPaths: ['a.cpp', 'b.md'], activePath: 'b.md', seeded: ['atcoder:abc1'] }, store);
  assert.deepEqual(loadIdeTabs(store), {
    openPaths: ['a.cpp', 'b.md'],
    activePath: 'b.md',
    seeded: ['atcoder:abc1'],
  });
  assert.ok(store.getItem(IDE_TABS_KEY));
});

test('ide-tabs: 非法数据与脏字段归一化', () => {
  const store = memStore();
  store.setItem(IDE_TABS_KEY, 'not json');
  assert.equal(loadIdeTabs(store), null);
  store.setItem(IDE_TABS_KEY, '[1,2]');
  assert.equal(loadIdeTabs(store), null);
  store.setItem(IDE_TABS_KEY, JSON.stringify({ openPaths: ['a.cpp', 3, '', 'a.cpp'], activePath: 'zzz', seeded: ['x', null, 'x'] }));
  assert.deepEqual(loadIdeTabs(store), { openPaths: ['a.cpp'], activePath: 'a.cpp', seeded: ['x'] });
  assert.deepEqual(normalizeIdeTabs(null), { openPaths: [], activePath: null, seeded: [] });
});

test('ide-tabs: 空标签栏是有效记录（用户关掉了所有标签）', () => {
  const store = memStore();
  saveIdeTabs({ openPaths: [], activePath: null, seeded: [] }, store);
  assert.deepEqual(loadIdeTabs(store), { openPaths: [], activePath: null, seeded: [] });
});

test('ide-tabs: 恢复时丢弃已删除文件，active 失效回落第一个', () => {
  const saved = { openPaths: ['gone.cpp', 'a.cpp', 'b.cpp'], activePath: 'gone.cpp', seeded: ['k'] };
  assert.deepEqual(restoreIdeTabs(saved, ['a.cpp', 'b.cpp', 'c.cpp']), {
    openPaths: ['a.cpp', 'b.cpp'],
    activePath: 'a.cpp',
  });
  assert.deepEqual(restoreIdeTabs(saved, [{ path: 'b.cpp' }]), { openPaths: ['b.cpp'], activePath: 'b.cpp' });
  assert.deepEqual(restoreIdeTabs(saved, []), { openPaths: [], activePath: null });
  assert.deepEqual(restoreIdeTabs(null, ['a.cpp']), { openPaths: [], activePath: null });
});

test('ide-tabs: seeded 去重并保留最近 500 个', () => {
  const seeded = Array.from({ length: 520 }, (_, i) => `p:${i}`);
  const out = normalizeIdeTabs({ openPaths: ['a.cpp'], activePath: 'a.cpp', seeded });
  assert.equal(out.seeded.length, 500);
  assert.equal(out.seeded[0], 'p:20');
  assert.equal(out.seeded.at(-1), 'p:519');
});