import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toast, subscribe, snapshot, dismiss } from '../lib/toast.js';

/** lib/toast.js：去重 / 上限 / 订阅 / dismiss（模块级状态，用 clear 复位）。 */

test('toast: 三种类型入队并通知订阅者', () => {
  toast.clear();
  const seen = [];
  const un = subscribe((list) => seen.push(list.length));
  toast.info('hello');
  toast.success('ok');
  toast.error('bad');
  assert.equal(snapshot().length, 3);
  assert.ok(seen.length >= 3);
  un();
  toast.clear();
});

test('toast: 同文案 800ms 内去重', () => {
  toast.clear();
  toast.info('same message');
  const id2 = toast.info('same message');
  assert.equal(snapshot().length, 1);
  assert.equal(id2, null);
  toast.clear();
});

test('toast: 上限 5 条挤掉最旧', () => {
  toast.clear();
  for (let i = 0; i < 8; i += 1) toast.info(`msg-${i}`, { duration: 0 });
  const snap = snapshot();
  assert.equal(snap.length, 5);
  assert.equal(snap[0].msg, 'msg-3');
  assert.equal(snap[4].msg, 'msg-7');
  toast.clear();
});

test('toast: dismiss 与空文案忽略', () => {
  toast.clear();
  const id = toast.info('bye', { duration: 0 });
  assert.equal(snapshot().length, 1);
  dismiss(id);
  assert.equal(snapshot().length, 0);
  assert.equal(toast.info('   '), null);
  toast.clear();
});
