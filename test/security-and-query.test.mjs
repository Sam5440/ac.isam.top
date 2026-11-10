import test from 'node:test';
import assert from 'node:assert/strict';

import { isPublicIp } from '../lib/secure-proxy.mjs';
import { sanitizeRichHtml } from '../lib/render.js';
import { queryProblems } from '../lib/problem-query.mjs';
import { translationChannels } from '../lib/translation-plan.mjs';

test('rejects private, mapped, special and non-global IPs', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1']) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('2001:4860:4860::8888'), true);
});

test('sanitizes decoded dangerous URLs and event attributes', () => {
  const html = sanitizeRichHtml('<a href="java&#x73;cript:alert(1)" onclick="alert(2)">x</a><img src=x onerror=alert(3)>');
  assert.doesNotMatch(html, /javascript|onclick|onerror/i);
  assert.match(sanitizeRichHtml('<p>Hello <strong>world</strong></p>'), /<strong>world<\/strong>/);
});

test('paginates and filters problem summaries consistently', () => {
  const problems = Array.from({ length: 120 }, (_, i) => ({
    id: `abc${i}_a`, platform: 'atcoder', contestId: 100 + i, index: 'A',
    title: `Problem ${i}`, titleZh: i === 7 ? '目标题' : null, difficulty: i - 20,
    translated: i === 7,
  }));
  const result = queryProblems(problems, { q: '目标题', page: '1' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].translated, true);
  assert.equal(queryProblems(problems, { band: '0-1199' }).total, 120);
});

test('CI archive does not suppress explicitly selected MT channels', () => {
  assert.deepEqual(translationChannels({ mode: 'zh', channel: 'deepl', archived: true }), ['deepl']);
  assert.deepEqual(translationChannels({ mode: 'both', channel: 'ai', priority: ['ai', 'deepl'], archived: true }), []);
});
