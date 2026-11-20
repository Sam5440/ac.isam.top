import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, cacheRate } from '../lib/ci-usage.mjs';
import { parseJobLog } from '../lib/ci-job-log.mjs';

test('缓存率只按输入计算，区分已知 0、缺失和非法用量', () => {
  const usage = normalizeUsage({ prompt_tokens: 80, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } });
  assert.equal(usage.total, 100);
  assert.equal(cacheRate(usage), '50.0%');
  assert.equal(cacheRate(normalizeUsage({ prompt_tokens: 80, prompt_cache_hit_tokens: 0 })), '0.0%');
  for (const raw of [undefined, { prompt_tokens: 80 }, { prompt_tokens: 0, prompt_cache_hit_tokens: 0 }, { prompt_tokens: 4, prompt_cache_hit_tokens: 5 }]) assert.equal(cacheRate(normalizeUsage(raw)), '未知');
});

test('作业输出保留多行及未解析内容，同时提取用量事件与执行阶段', () => {
  const lines = ['##[group]Install', 'plain', '##[endgroup]', '[01:02:03] [clist] updated', 'continued', '##[warning]slow',
    '[01:02:04] [ai-usage] {"task":"题面","at":"2026-11-20","target":"cf/1","input":10}', '[01:02:05] [ai-usage] incomplete'];
  const log = parseJobLog(lines.map((s) => `2026-11-20T01:02:03.1234567Z ${s}`).join('\n'));
  assert.equal(log.rows.length, lines.length);
  assert.deepEqual(log.groups, ['Install']);
  assert.deepEqual(log.scopes, ['clist', 'ai-usage']);
  assert.equal(log.rows[4].scope, 'clist');
  assert.equal(log.rows[5].level, '警告');
  assert.equal(log.calls[0].target, 'cf/1');
  assert.equal(log.calls.length, 1);
});
