import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IDE_UI_DEFAULTS,
  IDE_UI_KEY,
  loadIdeUi,
  normalizeIdeUi,
  patchIdeUi,
} from '../lib/ide-ui.js';

function memStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('ide-ui: 首次读取返回默认值', () => {
  assert.deepEqual(loadIdeUi(memStore()), { ...IDE_UI_DEFAULTS });
});

test('ide-ui: 非法 JSON / 非法结构回默认', () => {
  assert.deepEqual(loadIdeUi(memStore({ [IDE_UI_KEY]: 'not json' })), { ...IDE_UI_DEFAULTS });
  assert.deepEqual(loadIdeUi(memStore({ [IDE_UI_KEY]: '[1,2]' })), { ...IDE_UI_DEFAULTS });
});

test('ide-ui: 归一化模式、比例与路径数组', () => {
  const out = normalizeIdeUi({
    markdownMode: 'wysiwyg',
    markdownSplitPct: 92,
    filesExpanded: ['a', 3, '', 'a', 'b/c'],
    recent: ['x.cpp', null, 'x.cpp', 'y.md'],
  });
  assert.deepEqual(out, {
    markdownMode: 'wysiwyg',
    markdownSplitPct: 80,
    filesExpanded: ['a', 'b/c'],
    recent: ['x.cpp', 'y.md'],
  });
  assert.equal(normalizeIdeUi({ markdownMode: 'weird', markdownSplitPct: 'abc' }).markdownMode, 'split');
  assert.equal(normalizeIdeUi({ markdownSplitPct: 'abc' }).markdownSplitPct, 50);
  assert.equal(normalizeIdeUi({ markdownSplitPct: 5 }).markdownSplitPct, 20);
  assert.equal(normalizeIdeUi({ markdownSplitPct: 5.4 }).markdownSplitPct, 20);
});

test('ide-ui: patch 合并写回，不清掉其他字段', () => {
  const store = memStore();
  patchIdeUi({ markdownMode: 'preview', markdownSplitPct: 35, filesExpanded: ['dir'], recent: ['a.cpp'] }, store);
  patchIdeUi({ filesExpanded: ['dir', 'dir/sub'] }, store);
  assert.deepEqual(loadIdeUi(store), {
    markdownMode: 'preview',
    markdownSplitPct: 35,
    filesExpanded: ['dir', 'dir/sub'],
    recent: ['a.cpp'],
  });
});

test('ide-ui: recent 最多保留 20 条（新的在前）', () => {
  const recent = Array.from({ length: 25 }, (_, i) => `f${i}.cpp`);
  const out = patchIdeUi({ recent }, memStore());
  assert.equal(out.recent.length, 20);
  assert.equal(out.recent[0], 'f0.cpp');
  assert.equal(out.recent.at(-1), 'f19.cpp');
});