/**
 * 全局 AI 服务商（Global AI Provider）。
 *
 * 服务商 = 一套连接信息（名称 + Base URL + API Key），是全站唯一配置 AI
 * 接口地址的地方，持久化在站点主设置（stmt-settings-v1）的 aiProviders /
 * aiAssign 字段：
 *  - aiProviders: { list: [{id, name, baseUrl, apiKey}], activeId } 服务商注册表
 *  - aiAssign:    { <module>: { providerId, model } }               各模块挑选结果
 *    module ∈ translation | chat（AI 代码补全在独立 store，经 profile.providerId 引用）
 * providerId 为 'auto'/空 时跟随 activeId（默认服务商）。功能模块只能挑选
 * 服务商并覆盖模型，接口地址与 Key 一律不在模块内配置。
 */

export const AI_MODELS = [
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-5.6-sol',
  'deepseek-v4-flash',
  'glm-5.3-flash',
  'kimi-k3',
];

/** 兼容历史调用（原 components/ai-translate）：补 /v1 后缀。 */
export function normalizeBaseUrl(u) {
  const s = String(u || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  return /\/v\d+$/.test(s) ? s : `${s}/v1`;
}

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

/** 归一化服务商注册表：去重、补 id/名称、校正 activeId。 */
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
      baseUrl: String(p.baseUrl || '').trim(),
      apiKey: String(p.apiKey || ''),
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
 * 解析某模块实际使用的接口配置：{ baseUrl, apiKey, model }。
 * 未挑选/挑选的服务商不存在时返回空串字段（调用方据此提示未配置）。
 */
export function resolveModuleCfg(settings, moduleId, { modelFallback } = {}) {
  const providers = normalizeProviders(settings?.aiProviders);
  const assign = settings?.aiAssign?.[moduleId] || {};
  const id =
    !assign.providerId || assign.providerId === 'auto' ? providers.activeId : assign.providerId;
  const p = providers.list.find((q) => q.id === id) || null;
  const model = String(assign.model || '').trim() || modelFallback || '';
  if (!p) return { baseUrl: '', apiKey: '', model };
  return { baseUrl: p.baseUrl, apiKey: p.apiKey, model };
}

/** 翻译模块配置（模型留空回退首个常用模型，与旧 settings.ai.model 默认一致）。 */
export function resolveTranslationCfg(settings) {
  return resolveModuleCfg(settings, 'translation', { modelFallback: AI_MODELS[0] });
}

/**
 * 一次性迁移（2026-11-09）：旧「翻译 AI」「AI 对话独立配置」「补全平台方案」
 * 的 baseUrl/apiKey 收敛为全局服务商。纯函数：入参为主设置与补全原始存储，
 * 返回 { aiProviders, aiAssign, completionPatch }（无变化处为 null），由
 * SettingsProvider 挂载时写入并以 localStorage 哨兵键保证只跑一次。
 */
export function migrateLegacyProviders(settings, completionRaw) {
  const providers = [];
  const findOrAdd = (baseUrl, apiKey, name) => {
    const hit = providers.find((p) => p.baseUrl === baseUrl && p.apiKey === apiKey);
    if (hit) return hit.id;
    const id = makeProviderId();
    providers.push({ id, name: name || deriveProviderName(baseUrl) || '未命名服务商', baseUrl, apiKey });
    return id;
  };

  const ai = settings?.ai || {};
  const chat = settings?.chat || {};
  let activeId = null;
  let chatProviderId = 'auto';
  if (ai.baseUrl) activeId = findOrAdd(ai.baseUrl, ai.apiKey || '', '翻译 AI（迁移）');
  if (
    chat &&
    chat.useTranslationAi === false &&
    chat.baseUrl &&
    (chat.baseUrl !== ai.baseUrl || (chat.apiKey || '') !== (ai.apiKey || ''))
  ) {
    chatProviderId = findOrAdd(chat.baseUrl, chat.apiKey || '', 'AI 对话（迁移）');
  }

  // 补全平台方案：链接到服务商（webllm 等本地方案无 baseUrl，跳过）
  let completionPatch = null;
  const profiles = Array.isArray(completionRaw?.profiles) ? completionRaw.profiles : [];
  let profilesChanged = false;
  const nextProfiles = profiles.map((p) => {
    if (!p || !p.baseUrl || p.providerId) return p;
    profilesChanged = true;
    return { ...p, providerId: findOrAdd(p.baseUrl, p.apiKey || '', p.name || '') };
  });
  if (profilesChanged) completionPatch = { profiles: nextProfiles };

  return {
    aiProviders: providers.length
      ? { list: providers, activeId: activeId || providers[0].id }
      : null,
    aiAssign: {
      translation: { providerId: 'auto', model: String(ai.model || '') },
      chat: {
        providerId: chatProviderId,
        model: chat.useTranslationAi === false ? String(chat.model || '') : '',
      },
    },
    completionPatch,
  };
}
