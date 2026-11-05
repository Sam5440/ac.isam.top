/**
 * AI 补全设置（localStorage 持久化）。移植自 ACM-IDE-online 的 settings.js（AI 部分），
 * 与站点翻译设置（stmt-*）、编译器偏好（ysc-cp-settings-v1）互不干扰。
 *
 * AI 支持多平台配置方案（profiles）：profiles 存所有平台，activeId 指向
 * 当前使用的方案；根部扁平字段（apiType/baseUrl/…）始终是「当前方案」的
 * 镜像 —— providers/inlineCompletion 直接读扁平字段，切换方案 = 用该方案字段
 * 覆盖扁平字段。enabled/trigger/debounceMs/useProxy 是行为选项，全局共享。
 */

export const AI_SETTINGS_KEY = "ysc-ai-settings-v1";

/** 每个平台方案独立保存的字段（会随方案切换整体覆盖到根部）。 */
export const PROFILE_FIELDS = [
  "name",
  "apiType",
  "baseUrl",
  "apiKey",
  "model",
  "fimTemplate",
  "customTemplate",
  "temperature",
  "maxTokens",
  "downloadSource", // webllm 专用：权重下载源 auto | direct | modelscope | hfmirror
];

/** AI 补全默认设置（默认关：需在设置面板接入自己的补全服务后开启）。 */
export const DEFAULT_AI = Object.freeze({
  enabled: false,
  // —— 当前生效方案（扁平镜像，供 providers 直接消费）——
  name: "",
  apiType: "openai-chat", // webllm | openai-chat | openai-completion | ollama
  baseUrl: "",
  apiKey: "",
  model: "",
  fimTemplate: "qwen25", // 见 lib/ai/fimTemplates.js
  customTemplate: "",
  temperature: 0.2,
  maxTokens: 256,
  downloadSource: "auto", // webllm 权重下载源：auto（探测）| direct（HF 直连）| modelscope（魔搭）| hfmirror（hf-mirror.com）
  // —— 多平台方案 ——
  profiles: [],
  activeId: null,
  // —— 全局行为选项 ——
  trigger: "auto", // auto | manual
  debounceMs: 800,
  useProxy: true, // true: 经 /api/ai/proxy（解决 CORS）；false: 浏览器直连
});

/** 默认 ai（不含 profiles 相关），用于给方案字段补默认值。 */
const AI_FIELD_DEFAULTS = Object.fromEntries(
  Object.entries(DEFAULT_AI).filter(
    ([k]) => !["profiles", "activeId"].includes(k),
  ),
);

export function makeProfileId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 从 baseUrl 推导方案名（如 https://api.siliconflow.cn/v1 → api.siliconflow.cn）。 */
export function deriveProfileName(baseUrl) {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function pickProfileFields(p) {
  const out = {};
  for (const k of PROFILE_FIELDS) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

function fillProfile(p) {
  return { id: p.id || makeProfileId(), ...AI_FIELD_DEFAULTS, ...pickProfileFields(p) };
}

/**
 * 归一化 ai：保证 profiles/activeId 结构合法，并把旧版单配置迁移为第一个方案。
 * 旧版扁平字段里若已有可用配置（baseUrl 非空），整体迁入第一个方案（即默认方案）。
 */
export function normalizeAi(ai) {
  const next = { ...ai };
  let profiles = Array.isArray(next.profiles) ? next.profiles.map(fillProfile) : [];
  let activeId = next.activeId ?? null;

  if (!profiles.length && next.baseUrl) {
    // 旧版单配置迁移：现有配置成为第一个（默认）方案
    const name = next.name || deriveProfileName(next.baseUrl) || "默认配置";
    profiles = [fillProfile({ id: makeProfileId(), ...pickProfileFields(next), name })];
    activeId = profiles[0].id;
    next.name = name;
  }
  if (activeId && !profiles.some((p) => p.id === activeId)) activeId = null;
  if (!activeId && profiles.length) activeId = profiles[0].id;

  next.profiles = profiles;
  next.activeId = activeId;

  // 双向治愈：扁平 name 与当前方案 name 互为镜像（历史脏数据纠正）
  if (activeId) {
    const ap = profiles.find((p) => p.id === activeId);
    if (next.name && ap && ap.name !== next.name) ap.name = next.name;
    if (!next.name && ap?.name) next.name = ap.name;
  }
  return next;
}

/** 把根部的方案字段写回当前方案（每次 patch ai 后调用，保持方案与生效配置一致）。 */
export function upsertActiveProfile(ai) {
  const { profiles, activeId } = ai;
  if (!activeId) return ai;
  const idx = profiles.findIndex((p) => p.id === activeId);
  if (idx < 0) return ai;
  const nextProfiles = profiles.slice();
  nextProfiles[idx] = { ...nextProfiles[idx], ...pickProfileFields(ai) };
  return { ...ai, profiles: nextProfiles };
}

/**
 * 存量 DeepSeek 配置迁移（2026-11-05）：旧预设走 openai-chat + deepseek-chat，
 * 现官方 FIM Beta 已可用（/beta/completions + deepseek-flash，服务端拼接），
 * 检测到旧形态的 DeepSeek 方案时整体升级，用户无需手动重配。
 */
function migrateDeepSeekFim(ai) {
  const migrate = (p) =>
    p &&
    typeof p.baseUrl === "string" &&
    /^https?:\/\/api\.deepseek\.com\/?$/.test(p.baseUrl) &&
    p.apiType === "openai-chat" &&
    p.model === "deepseek-chat"
      ? {
          ...p,
          apiType: "deepseek-fim",
          baseUrl: "https://api.deepseek.com/beta",
          model: "deepseek-flash",
          fimTemplate: "none",
        }
      : p;
  return {
    ...ai,
    profiles: Array.isArray(ai.profiles) ? ai.profiles.map(migrate) : ai.profiles,
    ...(migrate({
      apiType: ai.apiType,
      baseUrl: ai.baseUrl,
      model: ai.model,
      fimTemplate: ai.fimTemplate,
    }) ?? {}),
  };
}

/** 读取 AI 设置（window 缺失时安全降级，node 下可直接单测；store 可注入）。 */
export function loadAiSettings(store = storage()) {
  let saved = {};
  try {
    saved = JSON.parse(store?.getItem(AI_SETTINGS_KEY)) || {};
  } catch {}
  return normalizeAi(migrateDeepSeekFim({ ...DEFAULT_AI, ...saved }));
}

export function saveAiSettings(patch, store = storage()) {
  try {
    const cur = loadAiSettings(store);
    store?.setItem(AI_SETTINGS_KEY, JSON.stringify(upsertActiveProfile({ ...cur, ...patch })));
  } catch {}
}
