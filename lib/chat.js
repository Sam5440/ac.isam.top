'use client';

/**
 * AI 对话：OpenAI 兼容 /chat/completions，默认流式（SSE 增量解析），
 * 失败自动降级非流式。默认经站内 /api/ai/proxy 转发（绕 CORS，Key 只在
 * 请求体透传不落盘）；cfg.direct 为 true 时浏览器直连。
 */

import { normalizeBaseUrl } from '@/components/ai-translate';

/** 从设置解析 Chat 实际使用的接口配置：默认复用翻译 AI，可切换为独立配置。 */
export function resolveChatCfg(settings) {
  const c = settings?.chat || {};
  if (c.useTranslationAi !== false) {
    return {
      baseUrl: settings?.ai?.baseUrl || '',
      apiKey: settings?.ai?.apiKey || '',
      model: c.model || settings?.ai?.model || '',
      direct: false,
    };
  }
  return { baseUrl: c.baseUrl || '', apiKey: c.apiKey || '', model: c.model || '', direct: false };
}

export function chatReady(cfg) {
  return !!(cfg?.baseUrl && cfg?.apiKey && cfg?.model);
}

function extractContent(data) {
  const msg = data?.choices?.[0]?.message;
  return typeof msg?.content === 'string' ? msg.content : data?.choices?.[0]?.text || '';
}

async function readError(res) {
  let msg = `HTTP ${res.status}`;
  try {
    msg = (await res.json())?.error?.message || msg;
  } catch {}
  return new Error(msg);
}

/** 流式 SSE 解析：data: {...} 行 → choices[0].delta.content。 */
async function streamContent(res, onDelta) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta?.(delta, full);
        }
      } catch {}
    }
  }
  return full;
}

/**
 * 发起一轮对话。messages: [{role, content}]；onDelta(delta, fullText) 流式回调。
 * 返回完整回复文本。
 */
export async function sendChat({ messages, cfg, onDelta, signal }) {
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/chat/completions`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
  const makeBody = (stream) => JSON.stringify({ model: cfg.model, messages, temperature: 0.7, stream });

  const viaProxy = (stream) =>
    fetch('/api/ai/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, headers, body: JSON.parse(makeBody(stream)) }),
      signal,
    });

  // 第一尝试：流式；HTTP 报错时降级为非流式重试一次（部分网关不支持 stream）
  let res = cfg.direct ? await fetch(url, { method: 'POST', headers, body: makeBody(true), signal }) : await viaProxy(true);
  if (!res.ok) {
    const firstErr = await readError(res).catch((e) => e);
    try {
      res = cfg.direct
        ? await fetch(url, { method: 'POST', headers, body: makeBody(false), signal })
        : await viaProxy(false);
    } catch (e) {
      throw firstErr;
    }
    if (!res.ok) throw firstErr;
    const data = await res.json();
    const out = extractContent(data);
    if (!out.trim()) throw new Error('空响应');
    onDelta?.(out, out);
    return out;
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream') && res.body) {
    const out = await streamContent(res, onDelta);
    if (!out.trim()) throw new Error('空响应');
    return out;
  }
  const data = await res.json();
  const out = extractContent(data);
  if (!out.trim()) throw new Error('空响应');
  onDelta?.(out, out);
  return out;
}
