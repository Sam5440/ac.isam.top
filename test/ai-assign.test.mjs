import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyThinking,
  normalizeAssign,
  needsProxy,
  resolveProxy,
  resolveModuleCfg,
} from '../lib/ai-providers.js';

/** lib/ai-providers.js 纯函数：混合内容判定 / 挑选归一化 / 思考深度注入。 */

test('needsProxy: https 站点 + http 接口 → 强制转发', () => {
  assert.equal(needsProxy('http://api.example.com/v1', 'https://ac.isam.top'), true);
});

test('needsProxy: localhost http 接口豁免（代理不可达本机）', () => {
  assert.equal(needsProxy('http://localhost:11434', 'https://ac.isam.top'), false);
  assert.equal(needsProxy('http://127.0.0.1:8080/v1', 'https://ac.isam.top'), false);
  assert.equal(needsProxy('http://[::1]:11434', 'https://ac.isam.top'), false);
});

test('needsProxy: http 站点不强制（无混合内容）', () => {
  assert.equal(needsProxy('http://localhost:11434', 'http://localhost:3000'), false);
  assert.equal(needsProxy('http://api.example.com/v1', 'http://ac.isam.top'), false);
});

test('needsProxy: https 接口不强制', () => {
  assert.equal(needsProxy('https://api.siliconflow.cn/v1', 'https://ac.isam.top'), false);
});

test('needsProxy: 非法/空 baseUrl 返回 false', () => {
  assert.equal(needsProxy('', 'https://ac.isam.top'), false);
  assert.equal(needsProxy('not-a-url', 'https://ac.isam.top'), false);
});

test('normalizeAssign: 补默认值（off/false/null/auto）', () => {
  assert.deepEqual(normalizeAssign(undefined), {
    providerId: 'auto',
    model: '',
    thinking: 'off',
    proxy: false,
    proxyOverride: null,
  });
  assert.deepEqual(normalizeAssign({}), normalizeAssign(undefined));
  assert.equal(normalizeAssign({ providerId: 'prov_x', model: 'm1', thinking: 'high' }).thinking, 'high');
  assert.equal(normalizeAssign({ providerId: 'prov_x', model: 'm1', thinking: 'high' }).providerId, 'prov_x');
});

test('normalizeAssign: 非法 thinking/proxyOverride 回落默认', () => {
  assert.equal(normalizeAssign({ thinking: 'ultra' }).thinking, 'off');
  assert.equal(normalizeAssign({ proxyOverride: 'bypass' }).proxyOverride, null);
  assert.equal(normalizeAssign({ proxyOverride: 'direct' }).proxyOverride, 'direct');
  assert.equal(normalizeAssign({ proxyOverride: 'proxy' }).proxyOverride, 'proxy');
});

test('resolveProxy: 默认关；用户开 proxy 则开', () => {
  const settings = {
    aiProviders: { list: [{ id: 'p1', baseUrl: 'https://api.x.cn/v1', apiKey: 'k' }], activeId: 'p1' },
    aiAssign: { chat: {} },
  };
  let r = resolveProxy(settings, 'chat');
  assert.equal(r.proxy, false);
  assert.equal(r.forced, false);
  assert.equal(r.local, false);
  settings.aiAssign.chat = { proxy: true };
  r = resolveProxy(settings, 'chat');
  assert.equal(r.proxy, true);
});

test('resolveProxy: 混合内容强制；本地服务不强制且标记 local', () => {
  const settings = {
    aiProviders: { list: [{ id: 'p1', baseUrl: 'http://api.x.cn/v1' }, { id: 'p2', baseUrl: 'http://localhost:11434' }], activeId: 'p1' },
    aiAssign: { chat: {} },
  };
  let r = resolveProxy(settings, 'chat', 'https://ac.isam.top');
  assert.equal(r.forced, true);
  assert.equal(r.proxy, true);
  settings.aiAssign.chat = { providerId: 'p2' };
  r = resolveProxy(settings, 'chat', 'https://ac.isam.top');
  assert.equal(r.forced, false);
  assert.equal(r.local, true);
  assert.equal(r.proxy, false);
});

test('resolveProxy: proxyOverride 显式覆盖优先', () => {
  const settings = {
    aiProviders: { list: [{ id: 'p1', baseUrl: 'http://api.x.cn/v1' }], activeId: 'p1' },
    aiAssign: { chat: {} },
  };
  assert.equal(resolveProxy(settings, 'chat', 'https://ac.isam.top').proxy, true); // forced
  settings.aiAssign.chat = { proxyOverride: 'direct' };
  assert.equal(resolveProxy(settings, 'chat', 'https://ac.isam.top').proxy, false);
  settings.aiAssign.chat = { proxyOverride: 'proxy' };
  assert.equal(resolveProxy(settings, 'chat', 'https://ac.isam.top').proxy, true);
});

test('resolveModuleCfg: 返回扩展字段（thinking/proxy/proxyForced）', () => {
  const settings = {
    aiProviders: { list: [{ id: 'p1', baseUrl: 'https://api.x.cn/v1', apiKey: 'k', apiFormat: 'anthropic' }], activeId: 'p1' },
    aiAssign: { chat: { model: 'm1', thinking: 'medium', proxy: true } },
  };
  const cfg = resolveModuleCfg(settings, 'chat');
  assert.equal(cfg.baseUrl, 'https://api.x.cn/v1');
  assert.equal(cfg.apiKey, 'k');
  assert.equal(cfg.model, 'm1');
  assert.equal(cfg.apiFormat, 'anthropic');
  assert.equal(cfg.thinking, 'medium');
  assert.equal(cfg.proxy, true);
  assert.equal(cfg.proxyForced, false);
});

test('applyThinking: openai 设置/移除 reasoning_effort', () => {
  const body1 = { model: 'm', messages: [] };
  applyThinking(body1, 'medium', 'openai');
  assert.equal(body1.reasoning_effort, 'medium');
  const body2 = { model: 'm', messages: [], reasoning_effort: 'high' };
  applyThinking(body2, 'off', 'openai');
  assert.equal('reasoning_effort' in body2, false);
  applyThinking(body2, undefined, 'openai');
  assert.equal('reasoning_effort' in body2, false);
});

test('applyThinking: anthropic 设置 thinking budget 且抬高 max_tokens', () => {
  const body1 = { model: 'm', max_tokens: 1024, messages: [] };
  applyThinking(body1, 'medium', 'anthropic');
  assert.deepEqual(body1.thinking, { type: 'enabled', budget_tokens: 8192 });
  assert.equal(body1.max_tokens > 8192, true);
  const body2 = { model: 'm', max_tokens: 20000, messages: [] };
  applyThinking(body2, 'high', 'anthropic');
  assert.equal(body2.thinking.budget_tokens, 16384);
  assert.equal(body2.max_tokens, 20000); // 已大于 budget 不动
});

test('applyThinking: off/未知格式不写入字段', () => {
  const body = { model: 'm', messages: [] };
  applyThinking(body, 'off', 'anthropic');
  assert.equal('thinking' in body, false);
  applyThinking(body, 'high', 'ollama');
  assert.equal('thinking' in body, false);
  assert.equal('reasoning_effort' in body, false);
});
