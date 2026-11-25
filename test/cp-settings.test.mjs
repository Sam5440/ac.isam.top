import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CP_SETTINGS_KEY, loadCpSettings, saveCpSettings } from '../lib/compiler/cp-settings.js';

function memStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('cp-settings: 题目页 IDE 开合/宽度默认与归一化', () => {
  const store = memStore();
  const base = loadCpSettings(store);
  assert.equal(base.problemIdeOpen, null);
  assert.equal(base.problemIdeWidth, null);

  store.setItem(CP_SETTINGS_KEY, JSON.stringify({ problemIdeOpen: true, problemIdeWidth: 512 }));
  const saved = loadCpSettings(store);
  assert.equal(saved.problemIdeOpen, true);
  assert.equal(saved.problemIdeWidth, 512);

  // 脏数据：非布尔 / 超范围 / 非数字
  store.setItem(CP_SETTINGS_KEY, JSON.stringify({ problemIdeOpen: 'yes', problemIdeWidth: 99999 }));
  const dirty = loadCpSettings(store);
  assert.equal(dirty.problemIdeOpen, null);
  assert.equal(dirty.problemIdeWidth, 4000);
  store.setItem(CP_SETTINGS_KEY, JSON.stringify({ problemIdeWidth: 'abc' }));
  assert.equal(loadCpSettings(store).problemIdeWidth, null);
  store.setItem(CP_SETTINGS_KEY, JSON.stringify({ problemIdeWidth: 100 }));
  assert.equal(loadCpSettings(store).problemIdeWidth, 320);
});

test('cp-settings: 保存题目页 IDE 偏好不会动其他字段', () => {
  const store = memStore();
  saveCpSettings({ defaultLang: 'python' }, store);
  saveCpSettings({ problemIdeOpen: false, problemIdeWidth: 600 }, store);
  const s = loadCpSettings(store);
  assert.equal(s.defaultLang, 'python');
  assert.equal(s.problemIdeOpen, false);
  assert.equal(s.problemIdeWidth, 600);
});