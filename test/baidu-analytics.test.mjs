import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BAIDU_HM_SRC, trackPath } from '../lib/baidu-analytics.mjs';

/**
 * 百度统计上报路径：pathname + search，不含 hash。
 * （hash 里可能是整份模拟赛分享载荷，见 lib/baidu-analytics.mjs 注释）
 */

test('trackPath: 只有 pathname 时原样返回', () => {
  assert.equal(trackPath('/problems'), '/problems');
  assert.equal(trackPath('/contests/atcoder/abc350'), '/contests/atcoder/abc350');
});

test('trackPath: 空 pathname 兜底为站点根', () => {
  assert.equal(trackPath(''), '/');
  assert.equal(trackPath(undefined, undefined), '/');
  assert.equal(trackPath(null, null), '/');
});

test('trackPath: search 带不带问号都拼成同一形式', () => {
  assert.equal(trackPath('/problems', 'page=2'), '/problems?page=2');
  assert.equal(trackPath('/problems', '?page=2'), '/problems?page=2');
  assert.equal(trackPath('/problems', ''), '/problems');
  assert.equal(trackPath('/problems', '?'), '/problems');
});

test('trackPath: 多参数与已编码查询串保持原样', () => {
  assert.equal(trackPath('/contests', 'platform=cf&page=3'), '/contests?platform=cf&page=3');
  assert.equal(trackPath('/problems', 'q=%E5%9B%BE%E8%AE%BA'), '/problems?q=%E5%9B%BE%E8%AE%BA');
});

test('BAIDU_HM_SRC: 指向百度统计脚本且带站点标识', () => {
  assert.equal(BAIDU_HM_SRC, 'https://hm.baidu.com/hm.js?e95fdee4b21eea052338f8394ce084ee');
});