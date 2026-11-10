/**
 * 全局 AI 服务商（Global AI Provider）。
 *
 * 服务商 = 一套连接信息（名称 + 备注 + API 格式 + Base URL + API Key + 模型列表），
 * 是全站唯一配置 AI 接口地址的地方，持久化在站点主设置（stmt-settings-v1）的
 * aiProviders / aiAssign 字段：
 *  - aiProviders: { list: [{id, name, note, apiFormat, baseUrl, apiKey, models}], activeId }
 *  - aiAssign:    { <module>: {providerId, model, thinking, proxy, proxyOverride} }
 *    module ∈ translation | chat | completion（AI 代码补全经一次性迁移引用）
 * providerId 为 'auto'/空 时跟随 activeId（默认服务商）。功能模块只能挑选
 * 服务商并挑选该服务商 models 列表中的模型，接口地址与 Key 一律不在模块内配置；
 * 每模块另配思考深度（thinking）与是否经本站转发（proxy/proxyOverride）。
 */

export const AI_MODELS = [
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-5.6-sol',
  'deepseek-v4-flash',
  'glm-5.3-flash',
  'kimi-k3',
];

/** API 格式：OpenAI 兼容 /chat/completions 或 Anthropic /v1/messages。 */
export const API_FORMATS = [
  { id: 'openai', label: 'OpenAI 兼容（/chat/completions）' },
  { id: 'anthropic', label: 'Anthropic（/v1/messages）' },
];

export const DEFAULT_AI_PROVIDERS = { list: [], activeId: null };

/** 单个功能模块挑选结果的默认值/形状（thinking ∈ off|low|medium|high）。 */
export const DEFAULT_MODULE_ASSIGN = Object.freeze({
  providerId: 'auto',
  model: '',
  thinking: 'off',
  proxy: false, // 是否经过本站 /api/ai/proxy 转发（默认关；强制转发见 resolveProxy）
  proxyOverride: null, // 用户显式覆盖：'proxy' | 'direct' | null（跟随自动判定）
});

export const DEFAULT_AI_ASSIGN = {
  translation: { ...DEFAULT_MODULE_ASSIGN },
  chat: { ...DEFAULT_MODULE_ASSIGN },
  completion: { ...DEFAULT_MODULE_ASSIGN },
};

const THINKING_LEVELS = ['off', 'low', 'medium', 'high'];
const PROXY_OVERRIDES = [null, 'proxy', 'direct'];

/** 归一化模块挑选结果：补默认值（thinking=off / proxy=false / proxyOverride=null）。 */
export function normalizeAssign(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    providerId: typeof r.providerId === 'string' && r.providerId ? r.providerId : 'auto',
    model: String(r.model || '').trim(),
    thinking: THINKING_LEVELS.includes(r.thinking) ? r.thinking : 'off',
    proxy: !!r.proxy,
    proxyOverride: PROXY_OVERRIDES.includes(r.proxyOverride) ? r.proxyOverride : null,
  };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** baseUrl 是否指向本机服务（localhost / 127.0.0.1 / [::1]）——服务端代理不可达。 */
export function isLocalHost(baseUrl) {
  try {
    return LOCAL_HOSTS.has(new URL(String(baseUrl || '')).hostname);
  } catch {
    return false;
  }
}

/**
 * 混合内容判定（纯函数）：站点为 https 且 baseUrl 为 http 且目标不是本机服务
 * → 必须走服务端转发（浏览器会直接拦截 https→http 请求）。
 * 本机 http 服务例外：Vercel 服务端够不到用户本机，走代理反而必坏 → false。
 * origin 可注入（默认浏览器 location.origin，node 单测传 'https://x'）。
 */
export function needsProxy(baseUrl, origin) {
  const site = String(origin || (typeof location !== 'undefined' ? location.origin : ''));
  let siteProto = '';
  try {
    siteProto = new URL(site).protocol;
  } catch {}
  if (siteProto !== 'https:') return false;
  let target;
  try {
    target = new URL(String(baseUrl || ''));
  } catch {
    return false;
  }
  if (target.protocol !== 'http:') return false;
  return !LOCAL_HOSTS.has(target.hostname);
}

/**
 * 解析某模块的实际转发决策：{ proxy, forced, local }。
 *  - proxyOverride='proxy'/'direct'：用户显式覆盖（UI 提示风险），优先级最高；
 *  - 否则 forced = needsProxy(baseUrl)（混合内容强制转发）；
 *  - proxy = forced || assign.proxy，默认 OFF。
 * origin 可注入（node 单测传 'https://x'；默认浏览器 location.origin）。
 */
export function resolveProxy(settings, moduleId, origin) {
  const assign = normalizeAssign(settings?.aiAssign?.[moduleId]);
  const providers = normalizeProviders(settings?.aiProviders);
  const id =
    !assign.providerId || assign.providerId === 'auto' ? providers.activeId : assign.providerId;
  const p = providers.list.find((q) => q.id === id) || null;
  const base = p?.baseUrl || '';
  const local = isLocalHost(base);
  const forced = !local && needsProxy(base, origin);
  let proxy;
  if (assign.proxyOverride === 'proxy') proxy = true;
  else if (assign.proxyOverride === 'direct') proxy = false;
  else proxy = forced || !!assign.proxy;
  return { proxy, forced, local };
}

export function makeProviderId() {
  return `prov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 从 baseUrl 推导服务商名（如 https://api.siliconflow.cn/v1 → api.siliconflow.cn）。 */
export function deriveProviderName(baseUrl) {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return '';
  }
}

/** 归一化服务商注册表：去重、补 id/名称/模型列表、校正 activeId。 */
export function normalizeProviders(raw) {
  const list = Array.isArray(raw?.list) ? raw.list : [];
  const clean = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const id = typeof p.id === 'string' && p.id ? p.id : makeProviderId();
    if (clean.some((q) => q.id === id)) continue;
    clean.push({
      id,
      name: String(p.name || '').trim() || deriveProviderName(p.baseUrl) || '未命名服务商',
      note: String(p.note || '').trim(),
      apiFormat: p.apiFormat === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: String(p.baseUrl || '').trim(),
      apiKey: String(p.apiKey || ''),
      models: Array.isArray(p.models)
        ? [...new Set(p.models.map((m) => String(m).trim()).filter(Boolean))]
        : [],
    });
  }
  let activeId = typeof raw?.activeId === 'string' && raw.activeId ? raw.activeId : null;
  if (activeId && !clean.some((p) => p.id === activeId)) activeId = null;
  if (!activeId && clean.length) activeId = clean[0].id;
  return { list: clean, activeId };
}

export function providerReady(p) {
  return !!(p?.baseUrl && p?.apiKey);
}

/** Anthropic 思考档位对应 budget_tokens（applyThinking 用，需 max_tokens > budget）。 */
export const THINKING_BUDGETS = Object.freeze({ low: 2048, medium: 8192, high: 16384 });

/**
 * 把模块的思考深度（thinking）写入请求 body：
 *  - openai：body.reasoning_effort = thinking（off 时删除字段）；
 *  - anthropic：body.thinking = {type:'enabled', budget_tokens}，并保证 max_tokens
 *    大于 budget（不足时自增）；
 *  - 其他 apiFormat / off：仅存储不生效 —— openai 格式删字段，anthropic 不动。
 */
export function applyThinking(body, thinking, apiFormat) {
  if (!body || typeof body !== 'object') return body;
  if (apiFormat === 'openai') {
    if (thinking && thinking !== 'off') body.reasoning_effort = thinking;
    else delete body.reasoning_effort;
    return body;
  }
  if (apiFormat === 'anthropic' && thinking && thinking !== 'off') {
    const budget = THINKING_BUDGETS[thinking] || THINKING_BUDGETS.low;
    body.thinking = { type: 'enabled', budget_tokens: budget };
    // Anthropic 要求 max_tokens > budget_tokens，不足时抬高
    const max = Number(body.max_tokens) || 0;
    if (max <= budget) body.max_tokens = budget + 1024;
    return body;
  }
  return body;
}

/**
 * 解析某模块实际使用的接口配置：{ baseUrl, apiKey, model, apiFormat, thinking, proxy, proxyForced }。
 * 未挑选/挑选的服务商不存在时返回空串字段（调用方据此提示未配置）。
 * thinking/proxy/proxyForced 来自 normalizeAssign / resolveProxy（模块级思考深度与本站转发）。
 */
export function resolveModuleCfg(settings, moduleId) {
  const providers = normalizeProviders(settings?.aiProviders);
  const assign = normalizeAssign(settings?.aiAssign?.[moduleId]);
  const id =
    !assign.providerId || assign.providerId === 'auto' ? providers.activeId : assign.providerId;
  const p = providers.list.find((q) => q.id === id) || null;
  const { proxy, forced } = resolveProxy(settings, moduleId);
  if (!p) {
    return {
      baseUrl: '',
      apiKey: '',
      model: assign.model,
      apiFormat: 'openai',
      thinking: assign.thinking,
      proxy,
      proxyForced: forced,
    };
  }
  return {
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    model: assign.model,
    apiFormat: p.apiFormat || 'openai',
    thinking: assign.thinking,
    proxy,
    proxyForced: forced,
  };
}

/** 翻译模块配置（模型未挑选时回退服务商模型列表第一个）。 */
export function resolveTranslationCfg(settings) {
  const cfg = resolveModuleCfg(settings, 'translation');
  if (!cfg.model) {
    const providers = normalizeProviders(settings?.aiProviders);
    const assign = settings?.aiAssign?.translation || {};
    const id = !assign.providerId || assign.providerId === 'auto' ? providers.activeId : assign.providerId;
    const p = providers.list.find((q) => q.id === id);
    cfg.model = p?.models?.[0] || AI_MODELS[0];
  }
  return cfg;
}

/** 归一化 baseUrl：OpenAI 格式补 /v1；Anthropic 格式保留根地址（端点自带 /v1/messages）。 */
export function providerEndpointBase(p) {
  const s = String(p?.baseUrl || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if ((p?.apiFormat || 'openai') === 'anthropic') return s;
  return /\/v\d+$/.test(s) ? s : `${s}/v1`;
}

/**
 * 拉取服务商模型列表（GET /models，经站内 /api/ai/proxy 转发绕 CORS）。
 *  - OpenAI 兼容：GET {base}/models，Authorization: Bearer，data:[{id}]
 *  - Anthropic：GET {base}/v1/models，x-api-key + anthropic-version，data:[{id}]
 * 返回 { ok, models?, error? }。
 */
export async function fetchProviderModels(p, { signal } = {}) {
  const base = providerEndpointBase(p);
  if (!base) return { ok: false, error: '未配置 Base URL' };
  const isAnthropic = (p.apiFormat || 'openai') === 'anthropic';
  const url = isAnthropic ? `${base.replace(/\/v1\/?$/, '') || base}/v1/models` : `${base}/models`;
  const headers = isAnthropic
    ? { 'x-api-key': p.apiKey || '', 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${p.apiKey || ''}` };
  try {
    const res = await fetch('/api/ai/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method: 'GET', headers }),
      signal: signal ? AbortSignal.any?.([signal, AbortSignal.timeout(20000)]) ?? signal : AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        msg = (typeof body?.error === 'string' ? body.error : body?.error?.message) || msg;
      } catch {}
      return { ok: false, error: msg };
    }
    const data = await res.json();
    // OpenAI: { data: [{id}] }；Anthropic: { data: [{id}] }（同形），兼容裸数组
    const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    const models = arr
      .map((m) => (typeof m === 'string' ? m : m?.id))
      .filter((id) => typeof id === 'string' && id)
      .sort((a, b) => a.localeCompare(b));
    if (!models.length) return { ok: false, error: '端点未返回任何模型' };
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * 发起一轮对话补全请求（供需要直接调用服务商的模块使用）。
 * 当前站内对话/翻译仍走 OpenAI 格式 body（多数网关同时兼容），此处提供
 * Anthropic 格式的 body/headers 构造，便于后续按格式分派。
 */
export function buildProviderRequest(p, { model, messages, maxTokens = 1024, temperature = 0.7, stream = false }) {
  const base = providerEndpointBase(p);
  if ((p.apiFormat || 'openai') === 'anthropic') {
    return {
      url: `${base.replace(/\/v1\/?$/, '') || base}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': p.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: { model, max_tokens: maxTokens, temperature, stream, messages },
    };
  }
  return {
    url: `${base}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey || ''}` },
    body: { model, max_tokens: maxTokens, temperature, stream, messages },
  };
}
