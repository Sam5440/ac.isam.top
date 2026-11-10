import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mappedIdeTheme } from '../lib/themes.js';

/** lib/themes.js 纯函数：网页主题 id → Monaco 编辑器主题 id 映射。 */

test('mappedIdeTheme: 模板主题用自带 monaco 字段', () => {
  assert.equal(mappedIdeTheme('nord'), 'one-dark');
  assert.equal(mappedIdeTheme('dracula'), 'dracula');
  assert.equal(mappedIdeTheme('gruvbox'), 'monokai');
  assert.equal(mappedIdeTheme('sakura'), 'solarized-light');
});

test('mappedIdeTheme: 内置 3 项映射（墨水屏取最接近的浅色）', () => {
  assert.equal(mappedIdeTheme('dark'), 'ys-dark');
  assert.equal(mappedIdeTheme('light'), 'github-light');
  assert.equal(mappedIdeTheme('eink'), 'solarized-light');
});

test('mappedIdeTheme: 未知 id 回退 ys-dark', () => {
  assert.equal(mappedIdeTheme('no-such-theme'), 'ys-dark');
  assert.equal(mappedIdeTheme(''), 'ys-dark');
  assert.equal(mappedIdeTheme(undefined), 'ys-dark');
});

test('mappedIdeTheme: 自定义主题按 base 回退', () => {
  const customs = [
    { id: 'my-dark', name: '我的暗色', kind: 'custom', base: 'dark', css: '' },
    { id: 'my-light', name: '我的浅色', kind: 'custom', base: 'light', css: '' },
  ];
  assert.equal(mappedIdeTheme('my-dark', customs), 'ys-dark');
  assert.equal(mappedIdeTheme('my-light', customs), 'github-light');
});
