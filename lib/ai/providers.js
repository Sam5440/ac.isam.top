/**
 * AI 补全请求构造与响应解析。
 *
 * 支持四类 API：
 *  - openai-completion：OpenAI 兼容 /completions（base/FIM 模型直发 FIM prompt，
 *    Ollama/OpenAI 兼容层、vLLM、llama.cpp server、Tabby 均适用）
 *  - deepseek-fim：DeepSeek FIM Beta /beta/completions（服务端处理 FIM 拼接，
 *    直接传 prompt + suffix 字段）
 *  - openai-chat：OpenAI 兼容 /chat/completions（instruct 模型；FIM 文本作为
 *    user 消息 + 系统提示「只输出光标处代码」）
 *  - ollama：Ollama 原生 /api/generate（raw 模式直发 FIM prompt）
 *
 * 默认经 /api/ai/proxy 转发（vite dev 中间件 / server.mjs 提供），绕开本地
 * 模型服务的 CORS 限制；也可切换浏览器直连（需服务端允许跨域，如
 * Ollama 设 OLLAMA_ORIGINS）。
 */

import { buildFim } from './fimTemplates.js';
import { estimateTokens } from './tokenStats.js';
import { requestWebllmCompletion } from './webllm.js';
import { createLogger } from './logger.js';

const log = createLogger('ai/provider');

const PROXY_URL = '/api/ai/proxy';

const CHAT_SYSTEM_PROMPT =
  'You are a code completion engine inside an IDE. Output ONLY the raw code that should be inserted at the cursor position (Fill-in-the-Middle). No explanations, no markdown code fences, no repetition of surrounding code.';

export const AI_PRESETS = [
  // WebGPU 本地：模型下载一次后浏览器内推理，无需网络/Key；baseUrl/Key 不适用
  { id: 'webllm', label: 'WebGPU 本地（WebLLM）', patch: { apiType: 'webllm', baseUrl: '', apiKey: '', model: 'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC', useProxy: false, fimTemplate: 'qwen25' } },
  { id: 'ollama-local', label: 'Ollama 本地（推荐）', patch: { apiType: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen2.5-coder:7b', useProxy: true, fimTemplate: 'qwen25' } },
  { id: 'ollama-openai', label: 'Ollama · OpenAI 兼容', patch: { apiType: 'openai-chat', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b', useProxy: true, fimTemplate: 'qwen25' } },
  { id: 'tabby', label: 'Tabby 自托管', patch: { apiType: 'openai-completion', baseUrl: 'http://localhost:8080/v1', model: 'qwen2.5-coder-7b', useProxy: true, fimTemplate: 'qwen25' } },
  { id: 'llamacpp', label: 'llama.cpp server', patch: { apiType: 'openai-completion', baseUrl: 'http://localhost:8080/v1', model: 'qwen2.5-coder-fim', useProxy: true, fimTemplate: 'qwen25' } },
  { id: 'vllm', label: 'vLLM', patch: { apiType: 'openai-completion', baseUrl: 'http://localhost:8000/v1', model: 'Qwen/Qwen2.5-Coder-7B', useProxy: true, fimTemplate: 'qwen25' } },
  { id: 'siliconflow', label: 'SiliconFlow（硅基流动）', patch: { apiType: 'openai-chat', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-Coder-30B-A3B-Instruct', useProxy: true, fimTemplate: 'qwen25' } },
  // DeepSeek 官方：FIM Beta 补全（2026-11-05 实测可用）——base_url 需带 /beta，
  // 服务端处理 FIM 拼接（直接传 prompt/suffix 字段），模型 deepseek-flash
  // （官方文档样例模型；实测 /beta/completions 返回正确补全与 usage）
  { id: 'deepseek', label: 'DeepSeek 官方 API（FIM）', patch: { apiType: 'deepseek-fim', baseUrl: 'https://api.deepseek.com/beta', model: 'deepseek-flash', useProxy: true, fimTemplate: 'none' } },
  { id: 'openai', label: 'OpenAI 官方 API', patch: { apiType: 'openai-chat', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', useProxy: true, fimTemplate: 'none' } },
];

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** 构造一次补全请求的 { url, headers, body }（不含发送）。 */
export function buildCompletionRequest(ai, prefix, suffix) {
  const { prompt, stops } = buildFim(ai, prefix, suffix);
  const headers = {};
  if (ai.apiKey) headers.Authorization = `Bearer ${ai.apiKey}`;

  if (ai.apiType === 'ollama') {
    return {
      url: joinUrl(ai.baseUrl, '/api/generate'),
      headers,
      body: {
        model: ai.model,
        prompt,
        raw: true,
        stream: false,
        stop: stops,
        options: { temperature: Number(ai.temperature) || 0.2, num_predict: Number(ai.maxTokens) || 256 },
      },
    };
  }

  if (ai.apiType === 'openai-completion') {
    return {
      url: joinUrl(ai.baseUrl, '/completions'),
      headers,
      body: {
        model: ai.model,
        prompt,
        max_tokens: Number(ai.maxTokens) || 256,
        temperature: Number(ai.temperature) || 0.2,
        stop: stops,
        stream: false,
      },
    };
  }

  // DeepSeek FIM Beta：服务端处理 FIM 拼接，直接传 prompt/suffix（不拼客户端模板、
  // 不传 stop——官方样例即如此；/beta/completions 响应 choices[0].text）
  if (ai.apiType === 'deepseek-fim') {
    return {
      url: joinUrl(ai.baseUrl, '/completions'),
      headers,
      body: {
        model: ai.model,
        prompt: prefix,
        suffix: suffix || undefined,
        max_tokens: Number(ai.maxTokens) || 256,
        temperature: Number(ai.temperature) || 0.2,
        stream: false,
      },
    };
  }

  // openai-chat（默认）
  return {
    url: joinUrl(ai.baseUrl, '/chat/completions'),
    headers,
    body: {
      model: ai.model,
      messages: [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: Number(ai.maxTokens) || 256,
      temperature: Number(ai.temperature) || 0.2,
      stop: stops,
      stream: false,
    },
  };
}

/** 从响应 JSON 提取补全文本。 */
export function parseCompletionResponse(ai, data) {
  if (ai.apiType === 'ollama') return data?.response ?? '';
  if (ai.apiType === 'openai-completion' || ai.apiType === 'deepseek-fim')
    return data?.choices?.[0]?.text ?? '';
  return data?.choices?.[0]?.message?.content ?? '';
}

/**
 * 从响应 JSON 提取 token 用量（OpenAI 兼容 usage.* / Ollama *eval_count）。
 * 返回 { prompt, completion } 或 null（响应未上报）。
 */
export function parseUsage(ai, data) {
  if (ai.apiType === 'ollama') {
    const prompt = Number(data?.prompt_eval_count) || 0;
    const completion = Number(data?.eval_count) || 0;
    return prompt || completion ? { prompt, completion } : null;
  }
  const usage = data?.usage;
  if (!usage) return null;
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  return prompt || completion ? { prompt, completion } : null;
}

/** 清洗模型输出：剥 markdown 围栏、思考块（Qwen3/DeepSeek-R1 系）、残留控制 token、首行空白、suffix 重叠。 */
export function cleanCompletion(text, suffix) {
  let out = String(text ?? '');
  // 思考块：<think>…</think> 或被截断的 <think>…（补全场景下思考内容整体丢弃）
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
  // 剥围栏：```lang\n ... ``` 或整段被围栏包裹
  const fence = /^\s*```[A-Za-z0-9+#-]*\n([\s\S]*?)\n?```\s*$/.exec(out);
  if (fence) out = fence[1];
  else out = out.replace(/^\s*```[A-Za-z0-9+#-]*\n/, '').replace(/\n```\s*$/, '');
  // 残留 FIM/结束 token（stop 未命中的兜底）
  out = out.replace(/<\|fim_(begin|end|hole|prefix|suffix|middle)\|>/g, '')
    .replace(/<\|EOT\|>/g, '')
    .replace(/<fim_(prefix|suffix|middle|end)>/g, '')
    .replace(/<\|endoftext\|>/g, '')
    .replace(/<\/?PRE>|<\/?SUF>|<\/?MID>|<\/CODE>/g, '');
  // FIM 模型常见病：输出末尾把 suffix 开头又写了一遍（如 suffix 以 ");" 开头时
  // 输出多带 ");"）——按最长安全重叠修剪（>=2 字符才剪，避免误伤单字符巧合）
  if (suffix) {
    const maxK = Math.min(out.length, String(suffix).length, 200);
    for (let k = maxK; k >= 2; k--) {
      if (String(suffix).startsWith(out.slice(out.length - k))) {
        out = out.slice(0, out.length - k);
        break;
      }
    }
  }
  // 剥一个前导换行：本函数只拿到输出与 suffix、拿不到 prefix,无法按
  // 「prefix 是否以空行收尾」判断（审查 AI-14 指出注释与实现不符）——
  // 现按实际行为如实注释：ghost text 场景下模型常以换行开头,剥掉一个
  // 让补全更紧凑;行首换行被吞是已知取舍,由 suffix 重叠修剪兜底展示
  if (out.startsWith('\n')) out = out.slice(1);
  return out;
}

async function send(spec, { useProxy, signal }) {
  const t0 = performance.now();
  log.info('HTTP 补全请求', { 经代理: useProxy, url: spec.url, method: spec.method ?? 'POST', body长度: JSON.stringify(spec.body ?? '').length });
  try {
    let data;
    if (useProxy) {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(spec),
        signal,
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) {
        log.error('代理返回错误', { status: res.status, error: data?.error });
        throw new Error(data?.error || `代理请求失败（HTTP ${res.status}）`);
      }
    } else {
      const res = await fetch(spec.url, {
        method: 'POST',
        headers: spec.headers,
        body: JSON.stringify(spec.body),
        signal,
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) {
        log.error('上游返回错误', { status: res.status, error: data?.error?.message });
        throw new Error(data?.error?.message || `请求失败（HTTP ${res.status}）`);
      }
    }
    log.info('HTTP 补全完成', { 耗时ms: Math.round(performance.now() - t0), 响应字节: JSON.stringify(data).length });
    return data;
  } catch (exn) {
    if (exn?.name === 'AbortError') log.info('请求被取消（AbortError）', { 耗时ms: Math.round(performance.now() - t0) });
    else log.error('请求异常', exn);
    throw exn;
  }
}

/** 请求一次 FIM 补全，返回清洗后的文本。onUsage({prompt, completion, estimated}) 上报 token 用量。 */
export async function requestAiCompletion(ai, { prefix, suffix, signal, onUsage }) {
  // WebGPU 本地模型（WebLLM）：不经 HTTP，浏览器内推理；usage 为真实 token 数
  if (ai.apiType === 'webllm') {
    const { text, usage } = await requestWebllmCompletion(ai, { prefix, suffix, signal });
    if (onUsage) {
      onUsage(usage
        ? { prompt: usage.prompt_tokens, completion: usage.completion_tokens, estimated: false }
        : { prompt: 0, completion: estimateTokens(text), estimated: true });
    }
    return cleanCompletion(text, suffix);
  }
  const spec = buildCompletionRequest(ai, prefix, suffix);
  const data = await send(spec, { useProxy: ai.useProxy, signal });
  const text = cleanCompletion(parseCompletionResponse(ai, data), suffix);
  if (onUsage) {
    const used = parseUsage(ai, data);
    if (used) {
      onUsage({ ...used, estimated: false });
    } else {
      // 响应未带 usage：按完整请求文本 + 输出估算（含系统提示/模板开销）
      const reqText = ai.apiType === 'openai-chat'
        ? `${CHAT_SYSTEM_PROMPT}\n${spec.body.messages.map((m) => m.content).join('\n')}`
        : String(spec.body.prompt ?? '');
      onUsage({ prompt: estimateTokens(reqText), completion: estimateTokens(text), estimated: true });
    }
  }
  return text;
}

/** 拉取模型列表（Ollama /api/tags 或 OpenAI 兼容 /models）。
 *  15s 硬超时（审查 2026-11-09 AI-6）：旧实现无超时,端点挂起时「测试连接」
 *  永远卡在 testing,按钮保持禁用只能刷新页面。 */
export async function fetchModelList(ai) {
  const headers = {};
  if (ai.apiKey) headers.Authorization = `Bearer ${ai.apiKey}`;
  const isOllama = ai.apiType === 'ollama';
  const url = isOllama ? joinUrl(ai.baseUrl, '/api/tags') : joinUrl(ai.baseUrl, '/models');
  const spec = { url, method: 'GET', headers };
  const signal = AbortSignal.timeout(15000);
  let data;
  if (ai.useProxy) {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(spec),
      signal,
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  } else {
    const res = await fetch(url, { headers, signal });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
  if (isOllama) return (data?.models ?? []).map((m) => m.name).filter(Boolean);
  return (data?.data ?? []).map((m) => m.id).filter(Boolean);
}
