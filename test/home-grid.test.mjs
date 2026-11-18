import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WIDGETS, createWidget, insertWidget, normalizeHomeConfig, normalizeWidgets, packWidgets } from '../lib/home-grid.mjs';
import { DEFAULT_HOME_LAYOUT } from '../lib/home-presets.mjs';

test('旧 HTML（包括空白页）继续启用，新用户默认经典四组件', () => {
  for (const html of ['', '<h1>Hi</h1>']) {
    const config = normalizeHomeConfig({ homeLayout: html });
    assert.equal(config.homeLayoutMode, 'html');
    assert.equal(config.homeLayout, html);
    assert.equal(normalizeHomeConfig({ ...config, homeLayoutMode: 'visual' }).homeLayout, html);
  }
  for (const raw of [{}, { homeLayout: DEFAULT_HOME_LAYOUT }, { homeLayoutMode: 'invalid', homeLayout: [] }]) {
    assert.equal(normalizeHomeConfig(raw).homeLayoutMode, 'visual');
    assert.deepEqual(normalizeHomeConfig(raw).homeWidgets, DEFAULT_WIDGETS);
  }
});

test('重复组件保留各自参数，修复重复 ID，归一化后 ID 稳定', () => {
  const normalized = normalizeWidgets([{ id: 'first', type: 'contests', params: { kind: 'upcoming' } }, { id: 'first', type: 'contests' }]);
  assert.notEqual(normalized[0].id, normalized[1].id);
  assert.deepEqual(normalized.map((item) => item.params.kind), ['upcoming', 'recent']);
  assert.deepEqual(normalizeWidgets(normalized), normalized);
});

test('无效类型回退、允许空数组，尺寸与参数逐字段限制', () => {
  for (const bad of [null, {}, [null, { type: '__proto__' }]]) assert.deepEqual(normalizeWidgets(bad), DEFAULT_WIDGETS);
  assert.deepEqual(normalizeWidgets([]), []);
  const [item] = normalizeWidgets([{ type: 'problems', w: -3, h: 999, params: { kind: {}, platform: 'unknown', limit: 55, html: 'ignored' } }]);
  assert.deepEqual([item.w, item.h, item.params], [1, 8, { kind: 'recent', platform: '', limit: 24 }]);
});

test('顺序决定优先级，删除、缩小或移动后从首个空格补位', () => {
  const widgets = [3, 2, 1].map((w, index) => createWidget('clock', String(index), { w, h: 1 }));
  const positions = (items, columns = 4) => packWidgets(items, columns).map(({ row, col }) => [row, col]);
  assert.deepEqual(positions(widgets), [[0, 0], [1, 0], [0, 3]]);
  assert.deepEqual(positions(widgets.slice(1)), [[0, 0], [0, 2]]);
  assert.deepEqual(positions([{ ...widgets[0], w: 2 }, ...widgets.slice(1)]), [[0, 0], [0, 2], [1, 0]]);
  const moved = insertWidget(widgets, widgets[1], 0);
  assert.deepEqual(moved.map((item) => item.id), ['1', '0', '2']);
  assert.deepEqual(positions(moved), [[0, 0], [1, 0], [0, 2]]);
  assert.deepEqual(positions(moved, 1), [[0, 0], [1, 0], [2, 0]]);
  assert.equal(moved[0].w, 2);
});
