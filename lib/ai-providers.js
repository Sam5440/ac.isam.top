/**
 * 全局 AI 服务商（Global AI Provider）。
 *
 * 服务商 = 一套连接信息（名称 + 备注 + API 格式 + Base URL + API Key + 模型列表），
 * 是全站唯一配置 AI 接口地址的地方，持久化在站点主设置（stmt-settings-v1）的
 * aiProviders / aiAssign 字段：
 *  - aiProviders: { list: [{id, name, note, apiFormat, baseUrl, apiKey, models}], activeId }
 *  - aiAssign:    { <module>: { providerId, model } }   各模块挑选结果
 *    module ∈ translation | chat（AI 代码补全经 profile.providerId 引用）
 * providerId 为 'auto'/空 时跟随 activeId（默认服务商）。功能模块只能挑选
 * 服务商并挑选该服务商 models 列表中的模型，接口地址与 Key 一律不在模块内配置。
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
export const DEFAULT_AI_ASSIGN = {
  translation: { providerId: 'auto', model: '' },
  chat: { providerId: 'auto', model: '' },
};

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

/**
 * 解析某模块实际使用的接口配置：{ baseUrl, apiKey, model, apiFormat }。
 * 未挑选/挑选的服务商不存在时返回空串字段（调用方据此提示未配置）。
 */
export function resolveModuleCfg(settings, moduleId) {
  const providers = normalizeProviders(settings?.aiProviders);
  const assign = settings?.aiAssign?.[moduleId] || {};
  const id =
    !assign.providerId || assign.providerId === 'auto' ? providers.activeId : assign.providerId;
  const p = providers.list.find((q) => q.id === id) || null;
  if (!p) return { baseUrl: '', apiKey: '', model: String(assign.model || '').trim(), apiFormat: 'openai' };
  return {
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    model: String(assign.model || '').trim(),
    apiFormat: p.apiFormat || 'openai',
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
