'use client';

/**
 * AI 对话：OpenAI 兼容 /chat/completions，默认流式（SSE 增量解析），
 * 失败自动降级非流式。默认经站内 /api/ai/proxy 转发（绕 CORS，Key 只在
 * 请求体透传不落盘）；cfg.direct 为 true 时浏览器直连。
 */

import { normalizeBaseUrl } from '@/components/ai-translate';
import { resolveModuleCfg } from '@/lib/ai-providers';

/**
 * 从全局 AI 服务商解析 Chat 实际使用的接口配置（服务商在设置 →「AI 服务商」
 * 统一配置，对话只能挑选服务商并覆盖模型）。模型留空回退常用列表首个，
 * 与翻译模块口径一致。
 */
export function resolveChatCfg(settings) {
  const { baseUrl, apiKey, model } = resolveModuleCfg(settings, 'chat', {
    modelFallback: 'glm-5.3-flash',
  });
  return { baseUrl, apiKey, model, direct: false };
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
    // 代理自产错误形如 {error: "string"}（route.js）,上游错误形如
    // {error: {message}} —— 两种形态都取到（AI-15:旧实现只认后者,
    // 用户看到裸 "HTTP 502" 而不是 "upstream timeout"）
    const body = await res.json();
    msg = (typeof body?.error === 'string' ? body.error : body?.error?.message) || msg;
  } catch {}
  return new Error(msg);
}

/** 流式 SSE 解析：data: {...} 行 → choices[0].delta.content。 */
async function streamContent(res, onDelta) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let done = false;
  const handleLine = (line) => {
    if (!line.startsWith('data:')) return false;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') return true;
    try {
      const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onDelta?.(delta, full);
      }
    } catch {}
    return false;
  };
  for (;;) {
    const r = await reader.read();
    if (r.done) {
      done = true;
      break;
    }
    buf += decoder.decode(r.value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (handleLine(line)) {
        // [DONE]：显式断开,不拖到上游自然关闭（AI-16）
        reader.cancel().catch(() => {});
        return full;
      }
    }
  }
  if (done && buf.trim()) {
    // 末尾无换行的最后一条 data 事件不丢（AI-16:旧实现丢弃残留 buf）
    handleLine(buf.trim());
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
      // 降级失败抛第一次的错;两者都留(AI-15:第二次真实原因不再被丢弃)
      throw firstErr?.message && e?.message && e.message !== firstErr.message
        ? new Error(`${firstErr.message}（流式降级亦失败：${e.message}）`)
        : firstErr;
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
