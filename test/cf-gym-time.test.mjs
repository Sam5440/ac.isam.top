import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCfDate, resolveGymApiStartTime } from '../lib/cf-gym-time.mjs';

test('parseCfDate: 按 CF 自带的 UTC 偏移换算开始时间', () => {
  assert.equal(parseCfDate('Sep/19/2026 09:00UTC+8'), '2026-09-19T01:00:00.000Z');
  assert.equal(parseCfDate('Nov/12/2026 08:30 UTC+3'), '2026-11-12T05:30:00.000Z');
  assert.equal(parseCfDate('Jan/01/2026 00:15UTC-05:30'), '2026-01-01T05:45:00.000Z');
});

test('parseCfDate: 兼容秒数、无时区后缀与无日期输入', () => {
  assert.equal(parseCfDate('Server time: Nov/19/2026 14:21:57UTC+8 (k2).'), '2026-11-19T06:21:00.000Z');
  assert.equal(parseCfDate('Nov/12/2026 08:30'), '2026-11-12T08:30:00.000Z');
  assert.equal(parseCfDate('-'), null);
  assert.equal(parseCfDate(null), null);
});

test('resolveGymApiStartTime: 官方 API 覆盖已污染的旧时间', () => {
  assert.equal(
    resolveGymApiStartTime('2026-11-13T08:14:00.000Z', 1359028800),
    '2013-01-24T12:00:00.000Z',
  );
});

test('resolveGymApiStartTime: API 无开始时间时保留已有值', () => {
  assert.equal(resolveGymApiStartTime('2026-09-19T01:00:00.000Z', undefined), '2026-09-19T01:00:00.000Z');
  assert.equal(resolveGymApiStartTime(null, null), null);
});
