import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, DEFAULT_WIDGETS, createWidget, insertWidget, normalizeHomeConfig, normalizeWidgets, packMasonry, packWidgets, resizeWidget } from '../lib/home-grid.mjs';
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

test('四列中所有新组件默认占两列，旧布局保留宽高并按高度重算条数', () => {
  for (const type of Object.keys(CATALOG)) assert.equal(createWidget(type, 'new').w, 2);
  assert.deepEqual(packWidgets(DEFAULT_WIDGETS, 4).map(({ row, col }) => [row, col]), [[0, 0], [0, 2], [2, 0], [2, 2]]);
  const old = createWidget('problems', 'old', { w: 4, h: 6, params: { limit: 10 } });
  assert.equal(old.params.limit, 11);
  assert.deepEqual(normalizeWidgets([old]), [old]);
});

test('列表显示数量由高度自动匹配，横向调整不影响内容', () => {
  for (const type of Object.keys(CATALOG)) {
    const start = createWidget(type, 'sample', { h: 3, params: { limit: 10 } });
    assert.deepEqual(resizeWidget(start, 4, 3).params, start.params);
    const taller = resizeWidget(start, 2, 5);
    if (CATALOG[type].fields?.limit) {
      assert.equal(start.params.limit, 5);
      assert.equal(taller.params.limit, 9);
      assert.equal(createWidget(type, 'four-rows', { h: 4, params: { limit: 3 } }).params.limit, 7);
      assert.equal(createWidget(type, 'eight-rows', { h: 8, params: { limit: 99 } }).params.limit, 15);
    } else assert.deepEqual(taller.params, start.params);
    assert.deepEqual(resizeWidget(taller, 2, 3), start);
  }
});

test('无效类型回退、允许空数组，尺寸与参数逐字段限制', () => {
  for (const bad of [null, {}, [null, { type: '__proto__' }]]) assert.deepEqual(normalizeWidgets(bad), DEFAULT_WIDGETS);
  assert.deepEqual(normalizeWidgets([]), []);
  const [item] = normalizeWidgets([{ type: 'problems', w: -3, h: 999, params: { kind: {}, platform: 'unknown', limit: 55, html: 'ignored' } }]);
  assert.deepEqual([item.w, item.h, item.params], [1, 8, { kind: 'recent', platform: '', limit: 15 }]);
});

test('首页按实际高度补位，短列先放下一个模块且全宽模块等待所有列', () => {
  const widgets = [
    { id: 'long', w: 2, h: 8 },
    { id: 'short', w: 2, h: 5 },
    { id: 'next', w: 2, h: 3 },
    { id: 'full', w: 4, h: 2 },
  ];
  const layout = packMasonry(widgets, 4, { long: 800, short: 500, next: 180, full: 100 });
  assert.deepEqual(layout.cells.map(({ col, top }) => [col, top]), [[0, 0], [2, 0], [2, 512], [0, 812]]);
  assert.equal(layout.height, 912);
  assert.deepEqual(packMasonry([], 4), { cells: [], height: 0 });
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

test('跨列模块下的空洞：恰好容纳（含上下间距）才可回填', () => {
  const widgets = [2, 2, 4, 2].map((w, id) => ({ id, w, h: 1 }));
  for (const [height, top] of [[188, 112], [188.25, 356]]) {
    const { cells } = packMasonry(widgets, 4, [300, 100, 32, height]);
    assert.equal(cells[3].top, top);
  }
});

test('固定种子 1,000 个混合布局：不越界、不重叠、无可提前放置的矩形空位', () => {
  let seed = 20261120;
  const rand = (n) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32 * n | 0;
  for (let run = 0; run < 1000; run++) {
    const cols = [1, 2, 4][run % 3];
    const widgets = Array.from({ length: 1 + rand(48) }, (_, id) => ({ id, w: 1 + rand(4), h: 1 + rand(8) }));
    const heights = widgets.map(() => rand(4800) / 4);
    const { cells, height } = packMasonry(widgets, cols, heights);
    const previous = [];
    for (const [i, cell] of cells.entries()) {
      const { top, col, w } = cell;
      const fits = (x, y) => previous.every((b) => x + w <= b.col || b.col + b.w <= x ||
        y + cell.height + 12 <= b.top || b.top + b.height + 12 <= y);
      assert.equal(cell.height, heights[i]);
      assert.equal(w, Math.min(cols, widgets[i].w));
      assert.ok(col >= 0 && col + w <= cols && top >= 0 && fits(col, top), `run=${run} widget=${i}`);
      for (const y of [0, ...previous.map((b) => b.top + b.height + 12)].filter((y) => y < top)) {
        for (let x = 0; x + w <= cols; x++) assert.ok(!fits(x, y), `可回填：run=${run} widget=${i} x=${x} y=${y}`);
      }
      previous.push(cell);
    }
    assert.equal(height, Math.max(...cells.map((b) => b.top + b.height)));
  }
});
