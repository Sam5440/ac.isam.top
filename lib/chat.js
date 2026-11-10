'use client';

/**
 * AI 对话：OpenAI 兼容 /chat/completions，默认流式（SSE 增量解析），
 * 失败自动降级非流式。默认经站内 /api/ai/proxy 转发（绕 CORS，Key 只在
 * 请求体透传不落盘）；cfg.direct 为 true 时浏览器直连。
 */

import { applyThinking, normalizeBaseUrl, resolveModuleCfg } from './ai-providers.js';

/**
 * 从全局 AI 服务商解析 Chat 实际使用的接口配置（服务商在设置 →「AI 服务商」
 * 统一配置，对话只能挑选服务商与其模型列表中的模型）。模型未挑选时回退
 * 服务商模型列表第一个。direct = !cfg.proxy（混合内容强制转发/用户开关均在此生效）。
 */
export function resolveChatCfg(settings) {
  const cfg = resolveModuleCfg(settings, 'chat');
  if (!cfg.model) {
    const providers = settings?.aiProviders || { list: [], activeId: null };
    const assign = settings?.aiAssign?.chat || {};
    const id = !assign.providerId || assign.providerId === 'auto' ? providers.activeId : assign.providerId;
    const p = (providers.list || []).find((q) => q.id === id);
    cfg.model = p?.models?.[0] || '';
  }
  return { ...cfg, direct: !cfg.proxy };
}

export function chatReady(cfg) {
  return !!(cfg?.baseUrl && cfg?.apiKey && cfg?.model);
}

function extractContent(data) {
  const msg = data?.choices?.[0]?.message;
  return typeof msg?.content === 'string' ? msg.content : data?.choices?.[0]?.text || '';
}

/** 非流式响应的思考文本（DeepSeek 等：message.reasoning_content / message.reasoning）。 */
function extractReasoning(data) {
  const msg = data?.choices?.[0]?.message;
  return typeof msg?.reasoning_content === 'string'
    ? msg.reasoning_content
    : typeof msg?.reasoning === 'string'
      ? msg.reasoning
      : '';
}

/**
 * 剥离正文中的 <think>…</think>（成对删除；未闭合时丢弃 <think> 起的
 * 全部残余）。与 lib/ai/providers.js cleanCompletion 的 think 规则一致。
 */
export function stripThink(text) {
  const s = String(text || '');
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
}

/**
 * SSE delta 行解析（纯函数，供 streamContent 与单测复用）。
 * state 跨行维护：{ content, reasoning, inThink, pending }。
 * - delta.reasoning_content / delta.reasoning → 累加 reasoning；
 * - 正文 <think>…</think>（含未闭合流式中间态）内的增量进 reasoning
 *   而非 content；标签可能被 chunk 边界切断，尾部的疑似标签前缀暂存
 *   pending，留到下一 delta 或流结束时判定。
 * 返回新 state；调用方据 state.content / state.reasoning 回调。
 */
export function parseSseDelta(payload, state) {
  const st = {
    content: state?.content || '',
    reasoning: state?.reasoning || '',
    inThink: Boolean(state?.inThink),
    pending: state?.pending || '',
  };
  let delta;
  try {
    // 兼容整行（'data: {...}'）与已剥前缀的 payload 两种入参
    const raw = payload.startsWith('data:') ? payload.slice(5).trim() : payload;
    if (raw === '[DONE]') return { ...st, done: true };
    delta = JSON.parse(raw)?.choices?.[0]?.delta;
  } catch {
    return st;
  }
  if (!delta) return st;

  const rDelta =
    typeof delta.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta.reasoning === 'string'
        ? delta.reasoning
        : '';
  if (rDelta) st.reasoning += rDelta;

  const cDelta = typeof delta.content === 'string' ? delta.content : '';
  if (!cDelta) return st;

  const OPEN = '<think>';
  const CLOSE = '</think>';
  /** 尾部是否为 tag 的前缀（可能被下一 chunk 补全），返回需暂存的长度。 */
  const tagPrefixLen = (low, tag) => {
    for (let k = Math.min(tag.length - 1, low.length); k >= 1; k--) {
      if (low.endsWith(tag.slice(0, k))) return k;
    }
    return 0;
  };

  let buf = st.pending + cDelta;
  for (;;) {
    const low = buf.toLowerCase();
    if (!st.inThink) {
      const open = low.indexOf(OPEN);
      if (open >= 0) {
        st.content += buf.slice(0, open);
        st.inThink = true;
        buf = buf.slice(open + OPEN.length);
        continue;
      }
      const hold = tagPrefixLen(low, OPEN);
      st.content += hold ? buf.slice(0, buf.length - hold) : buf;
      buf = hold ? buf.slice(buf.length - hold) : '';
      break;
    }
    const close = low.indexOf(CLOSE);
    if (close >= 0) {
      st.reasoning += buf.slice(0, close);
      st.inThink = false;
      buf = buf.slice(close + CLOSE.length);
      continue;
    }
    const hold = tagPrefixLen(low, CLOSE);
    st.reasoning += hold ? buf.slice(0, buf.length - hold) : buf;
    buf = hold ? buf.slice(buf.length - hold) : '';
    break;
  }
  st.pending = buf;
  return st;
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

/**
 * 流式 SSE 解析：data: {...} 行 → choices[0].delta。正文与思考增量分别
 * 累加（reasoning_content 字段或 <think>…</think> 标签两种来源），
 * 结束后剥掉残余 think 标签。onDelta(contentDelta, contentFull, reasoningFull)。
 */
async function streamContent(res, onDelta) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let done = false;
  let state = { content: '', reasoning: '', inThink: false };
  const handleLine = (line) => {
    if (!line.startsWith('data:')) return false;
    if (line.slice(5).trim() === '[DONE]') return true;
    const prevContent = state.content;
    const prevReasoning = state.reasoning;
    state = parseSseDelta(line, state);
    if (state.content !== prevContent || state.reasoning !== prevReasoning) {
      onDelta?.(state.content.slice(prevContent.length), state.content, state.reasoning);
    }
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
        return finish(state, onDelta);
      }
    }
  }
  if (done && buf.trim()) {
    // 末尾无换行的最后一条 data 事件不丢（AI-16:旧实现丢弃残留 buf）
    handleLine(buf.trim());
  }
  return finish(state, onDelta);
}

/** 流结束：冲刷 pending 残尾，剥 think 标签后回调最终全文。 */
function finish(state, onDelta) {
  // 未闭合 <think> 的 pending 残尾归属思考；思考态外的 pending 是普通正文
  const tail = state.pending || '';
  const content = stripThink(state.content + (state.inThink ? '' : tail));
  const reasoning = state.reasoning + (state.inThink ? tail : '');
  if (content !== state.content || reasoning !== state.reasoning) {
    onDelta?.(content, content, reasoning);
  }
  return content;
}

/**
 * 发起一轮对话。messages: [{role, content}]；
 * onDelta(contentDelta, contentFull, reasoningFull) 流式回调（reasoningFull
 * 为思考过程累计文本，无思考模型恒为空串，旧两参调用方天然兼容）。
 * 返回完整回复文本（已剥 <think> 标签）。
 */
export async function sendChat({ messages, cfg, onDelta, signal }) {
  const url = `${normalizeBaseUrl(cfg.baseUrl)}/chat/completions`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
  const makeBody = (stream) => {
    const body = { model: cfg.model, messages, temperature: 0.7, stream };
    applyThinking(body, cfg.thinking, cfg.apiFormat);
    return JSON.stringify(body);
  };

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
    onDelta?.(out, out, extractReasoning(data));
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
  onDelta?.(out, out, extractReasoning(data));
  return out;
}
