import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UNLOCK_STORAGE_KEY,
  UNLOCK_TTL_MS,
  buildShareHref,
  createUnlockRecord,
  decodeShareToken,
  encodeShareToken,
  isUnlockValid,
  normalizeUnlockStore,
  readShareTokenFromUrl,
  stripShareToken,
  unlockDaysLeft,
} from '../lib/private-unlock.mjs';

const NOW = Date.UTC(2026, 10, 28, 0, 0, 0);

test('分享 token 往返（含中文与特殊字符）', () => {
  for (const password of ['qwe123', '中文密码-2026', 'a+b/c=d?e#f', '  空格  ']) {
    const token = encodeShareToken(password);
    assert.match(token, /^v1\.[A-Za-z0-9_-]+$/);
    assert.equal(decodeShareToken(token), password);
  }
});

test('分享 token：空密码与损坏输入返回空', () => {
  assert.equal(encodeShareToken(''), '');
  assert.equal(decodeShareToken(''), null);
  assert.equal(decodeShareToken('v1.'), null);
  assert.equal(decodeShareToken('v1.%%%'), null);
  assert.equal(decodeShareToken('v1.abc'), null, '长度不是 4 的倍数的非法 base64url 应拒绝');
});

test('分享 token：无前缀时按明文兼容', () => {
  assert.equal(decodeShareToken('plain-password'), 'plain-password');
});

test('buildShareHref 生成 hash 链接且 id 被编码', () => {
  const href = buildShareHref('ccpc 2026/x', 'qwe123', 'https://ac.yslsy.top');
  assert.equal(href, `https://ac.yslsy.top/contests/private/ccpc%202026%2Fx#p=${encodeShareToken('qwe123')}`);
  assert.equal(readShareTokenFromUrl(href)?.password, 'qwe123');
});

test('readShareTokenFromUrl：hash 优先于 query，并兼容 pw', () => {
  const token = encodeShareToken('hash-pass');
  const fromHash = readShareTokenFromUrl(`https://x.test/contests/private/a#p=${token}`);
  assert.deepEqual(fromHash, { password: 'hash-pass', source: 'hash', key: 'p' });

  const fromQuery = readShareTokenFromUrl(`https://x.test/contests/private/a?v=1&p=${token}`);
  assert.deepEqual(fromQuery, { password: 'hash-pass', source: 'query', key: 'p' });

  const legacy = readShareTokenFromUrl('https://x.test/contests/private/a?pw=plain');
  assert.deepEqual(legacy, { password: 'plain', source: 'query', key: 'pw' });

  assert.equal(readShareTokenFromUrl('https://x.test/contests/private/a'), null);
});

test('stripShareToken 只摘密码参数，保留 v= 与其它片段', () => {
  const token = encodeShareToken('qwe123');
  assert.equal(
    stripShareToken(`https://x.test/contests/private/a?v=123#p=${token}`),
    'https://x.test/contests/private/a?v=123',
  );
  assert.equal(
    stripShareToken(`https://x.test/contests/private/a?p=${token}&v=123`),
    'https://x.test/contests/private/a?v=123',
  );
  assert.equal(
    stripShareToken(`https://x.test/contests/private/a#p=${token}&tab=1`),
    'https://x.test/contests/private/a#tab=1',
  );
  assert.equal(stripShareToken('not a url'), 'not a url');
});

test('30 天有效期：记录、剩余天数与过期判定', () => {
  const record = createUnlockRecord('qwe123', NOW);
  assert.equal(record.expiresAt, NOW + UNLOCK_TTL_MS);
  assert.equal(unlockDaysLeft(record, NOW), 30);
  assert.equal(unlockDaysLeft(record, NOW + UNLOCK_TTL_MS - 1), 1);
  assert.equal(isUnlockValid(record, NOW + UNLOCK_TTL_MS - 1), true);
  assert.equal(isUnlockValid(record, NOW + UNLOCK_TTL_MS), false);
  assert.equal(unlockDaysLeft(record, NOW + UNLOCK_TTL_MS), 0);
  assert.equal(createUnlockRecord('', NOW), null);
});

test('normalizeUnlockStore：丢弃过期/非法项并容忍坏 JSON', () => {
  assert.deepEqual(normalizeUnlockStore('not json', NOW), {});
  assert.deepEqual(normalizeUnlockStore('[]', NOW), {});
  assert.deepEqual(normalizeUnlockStore(null, NOW), {});

  const alive = createUnlockRecord('alive', NOW);
  const expired = createUnlockRecord('expired', NOW - UNLOCK_TTL_MS - 1);
  const out = normalizeUnlockStore(
    JSON.stringify({ a: alive, b: expired, c: { password: 'no-expiry' }, d: 'junk' }),
    NOW,
  );
  assert.deepEqual(Object.keys(out), ['a']);
  assert.equal(out.a.password, 'alive');
  assert.equal(out.a.expiresAt, alive.expiresAt);
});

test('normalizeUnlockStore：最多保留 50 场', () => {
  const raw = {};
  for (let i = 0; i < 60; i += 1) raw[`c${i}`] = createUnlockRecord(`pw${i}`, NOW);
  assert.equal(Object.keys(normalizeUnlockStore(raw, NOW)).length, 50);
});

test('存储键名固定（settings-io 用它排除导出）', () => {
  assert.equal(UNLOCK_STORAGE_KEY, 'ac-private-unlock-v1');
});
