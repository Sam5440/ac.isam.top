import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseDelta, stripThink } from '../lib/chat.js';

/** lib/chat.js 思考过程：stripThink 与 SSE 增量解析（reasoning / <think> 混合流）。 */

test('stripThink: 成对标签整体剥离', () => {
  assert.equal(stripThink('abc<think>内部思考</think>def'), 'abcdef');
  assert.equal(stripThink('<think>a</think>正文'), '正文');
  assert.equal(stripThink('正文<think>a</think>'), '正文');
});

test('stripThink: 未闭合标签丢弃残尾', () => {
  assert.equal(stripThink('正文<think>没写完'), '正文');
  assert.equal(stripThink('<think>全部是思考'), '');
});

test('stripThink: 无 think 标签原样返回', () => {
  assert.equal(stripThink('普通正文 $x^2$'), '普通正文 $x^2$');
  assert.equal(stripThink(''), '');
  assert.equal(stripThink(null), '');
});

test('stripThink: 多段 think 与大小写', () => {
  assert.equal(stripThink('<THINK>a</THINK>x<think>b</think>y'), 'xy');
});

/** 模拟 SSE 分段：payload 数组逐行喂 parseSseDelta，汇最终 content/reasoning。 */
function runSse(payloads) {
  let state = { content: '', reasoning: '', inThink: false, pending: '' };
  for (const p of payloads) state = parseSseDelta(p, state);
  // 流结束：思考态外的 pending 归正文、思考态内归思考（与 streamContent.finish 一致）
  const content = stripThink(state.content + (state.inThink ? '' : state.pending));
  const reasoning = state.reasoning + (state.inThink ? state.pending : '');
  return { content, reasoning };
}

const delta = (obj) => `data: ${JSON.stringify({ choices: [{ delta: obj }] })}`;

test('parseSseDelta: reasoning_content 字段与正文分离', () => {
  const r = runSse([
    delta({ reasoning_content: '先分析' }),
    delta({ reasoning_content: '题意。' }),
    delta({ content: '答案' }),
    delta({ content: '是 A。' }),
  ]);
  assert.equal(r.content, '答案是 A。');
  assert.equal(r.reasoning, '先分析题意。');
});

test('parseSseDelta: delta.reasoning 别名同样累加', () => {
  const r = runSse([delta({ reasoning: '思考' }), delta({ content: '答' })]);
  assert.equal(r.reasoning, '思考');
  assert.equal(r.content, '答');
});

test('parseSseDelta: 成对 <think> 标签路由进 reasoning', () => {
  const r = runSse([
    delta({ content: '<think>内部' }),
    delta({ '推理': undefined, content: '思考</think>正文' }),
  ]);
  assert.equal(r.content, '正文');
  assert.equal(r.reasoning, '内部思考');
});

test('parseSseDelta: 未闭合 <think>（流被截断）整体进 reasoning', () => {
  const r = runSse([delta({ content: '开头<think>后面全是思考' })]);
  assert.equal(r.content, '开头');
  assert.equal(r.reasoning, '后面全是思考');
});

test('parseSseDelta: <think> 标签被 chunk 边界切断（<thi|nk>）', () => {
  const r = runSse([
    delta({ content: '<thi' }),
    delta({ content: 'nk>思' }),
    delta({ content: '考</thi' }),
    delta({ content: 'nk>正文' }),
  ]);
  assert.equal(r.content, '正文');
  assert.equal(r.reasoning, '思考');
});

test('parseSseDelta: [DONE] 与非 data 行不影响状态', () => {
  let state = { content: '', reasoning: '', inThink: false, pending: '' };
  state = parseSseDelta('data: [DONE]', state);
  state = parseSseDelta(': keep-alive', state);
  state = parseSseDelta('not-json', state);
  assert.equal(state.content, '');
  assert.equal(state.reasoning, '');
});

test('parseSseDelta: 非法 JSON 行安全跳过（状态不变）', () => {
  const st = parseSseDelta('data: {broken', { content: 'a', reasoning: 'b', inThink: false });
  assert.equal(st.content, 'a');
  assert.equal(st.reasoning, 'b');
});

test('parseSseDelta: 混合流（reasoning 字段 + <think> 正文 + 残尾）综合', () => {
  const r = runSse([
    delta({ reasoning_content: '字段思考；' }),
    delta({ content: '<think>标签思考' }),
    delta({ content: '</think>结论：' }),
    delta({ content: '选 B' }),
  ]);
  assert.equal(r.content, '结论：选 B');
  assert.equal(r.reasoning, '字段思考；标签思考');
});
