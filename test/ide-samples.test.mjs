import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadAllSamples,
  saveAllSamples,
  sampleSetOf,
  withSampleSet,
  renameKey,
  renamePrefix,
  removeKeys,
  setFromProblem,
} from '../lib/ide-samples.js';

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('ide-samples: 存取往返 + 非法数据过滤', () => {
  const store = memStore();
  let map = withSampleSet({}, 'a.cpp', { problem: null, cases: [{ input: '1', output: '2' }] });
  saveAllSamples(map, store);
  assert.deepEqual(loadAllSamples(store), { 'a.cpp': { problem: null, cases: [{ input: '1', output: '2' }] } });
  store.setItem('ysc-ide-samples-v1', '[1,2]');
  assert.deepEqual(loadAllSamples(store), {});
  store.setItem('ysc-ide-samples-v1', 'not json');
  assert.deepEqual(loadAllSamples(store), {});
});

test('ide-samples: 空集删除键，未绑定返回空集', () => {
  const map = withSampleSet({ 'a.cpp': { problem: null, cases: [{ input: '', output: '' }] } }, 'a.cpp', { cases: [] });
  assert.deepEqual(map, {});
  assert.deepEqual(sampleSetOf(map, 'x.cpp'), { problem: null, cases: [] });
});

test('ide-samples: 文件 / 文件夹重命名与删除时绑定跟随', () => {
  const set = { problem: null, cases: [{ input: '1', output: '1' }] };
  let map = { 'a.cpp': set, 'src/b.cpp': set, 'src/sub/c.cpp': set, 'srcx/d.cpp': set };
  map = renameKey(map, 'a.cpp', 'main.cpp');
  assert.ok(map['main.cpp'] && !map['a.cpp']);
  map = renamePrefix(map, 'src', 'lib');
  assert.deepEqual(Object.keys(map).sort(), ['lib/b.cpp', 'lib/sub/c.cpp', 'main.cpp', 'srcx/d.cpp']);
  map = removeKeys(map, ['lib/b.cpp']);
  assert.deepEqual(Object.keys(map).sort(), ['lib/sub/c.cpp', 'main.cpp', 'srcx/d.cpp']);
});

test('ide-samples: 题目 → 样例集', () => {
  const s = setFromProblem({ platform: 'atcoder', id: 'abc1_a', title: 'T', samples: [{ input: '3\n', output: '2\n', note: 'x' }] });
  assert.deepEqual(s, { problem: { platform: 'atcoder', id: 'abc1_a', title: 'T', titleZh: '' }, cases: [{ input: '3\n', output: '2\n' }] });
});
