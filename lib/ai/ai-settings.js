/**
 * AI 补全设置（localStorage 持久化）。移植自 ACM-IDE-online 的 settings.js（AI 部分），
 * 与站点翻译设置（stmt-*）、编译器偏好（ysc-cp-settings-v1）互不干扰。
 *
 * AI 支持多平台配置方案（profiles）：profiles 存所有平台，activeId 指向
 * 当前使用的方案；根部扁平字段（apiType/baseUrl/…）始终是「当前方案」的
 * 镜像 —— providers/inlineCompletion 直接读扁平字段，切换方案 = 用该方案字段
 * 覆盖扁平字段。enabled/trigger/debounceMs 是行为选项，全局共享。
 *
 * m:2（2026-11-11）起连接字段收敛：baseUrl/apiKey 由全局服务商注入（v1.5），
 * providerId/model/thinking/useProxy 由主设置 aiAssign.completion 注入（一次性
 * 迁移搬存量），方案只保留行为偏好（名称/API 类型/FIM 模板/温度等）。
 */

export const AI_SETTINGS_KEY = "ysc-ai-settings-v1";

/**
 * 每个平台方案独立保存的字段（会随方案切换整体覆盖到根部）。
 * m:2 起连接字段（providerId/model）收敛到主设置 aiAssign.completion，
 * 方案只保留行为偏好。
 */
export const PROFILE_FIELDS = [
  "name",
  "apiType",
  "fimTemplate",
  "customTemplate",
  "temperature",
  "maxTokens",
  "downloadSource", // webllm 专用：权重下载源 auto | direct | modelscope | hfmirror
];

/** 一次性迁移标记（m:2）：providerId/model 从方案搬进主设置 aiAssign.completion。 */
const PROFILE_MIGRATION = 2;

/** AI 补全默认设置（默认关：需在设置面板接入自己的补全服务后开启）。 */
export const DEFAULT_AI = Object.freeze({
  enabled: false,
  // —— 当前生效方案（扁平镜像，供 providers 直接消费）——
  name: "",
  apiType: "openai-chat", // webllm | openai-chat | openai-completion | ollama | deepseek-fim
  baseUrl: "", // 运行时由全局服务商解析注入（不持久化用户输入）
  apiKey: "", // 同上
  model: "", // 运行时由主设置 aiAssign.completion 注入（m:2 起方案内不再持久化）
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
  useProxy: true, // true: 经 /api/ai/proxy（解决 CORS）；false: 浏览器直连（m:2 起由 aiAssign.completion 注入）
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

function pickProfile(p) {
  const out = {};
  // webllm 方案额外保留 model（本地模型 id，不是服务商连接字段）
  const fields = p?.apiType === "webllm" ? [...PROFILE_FIELDS, "model"] : PROFILE_FIELDS;
  for (const k of fields) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

function fillProfile(p) {
  return { id: p.id || makeProfileId(), ...AI_FIELD_DEFAULTS, ...pickProfile(p) };
}

/**
 * 归一化 ai：保证 profiles/activeId 结构合法，并把旧版单配置迁移为第一个方案。
 * 旧版扁平字段里若已有可用配置（baseUrl 非空），整体迁入第一个方案（即默认方案）。
 * v1.5 起 baseUrl/apiKey 不再持久化（由全局 AI 服务商运行时注入），这里对
 * 存量方案做一次剥离清洗。
 */
export function normalizeAi(ai) {
  const next = { ...ai };
  let profiles = Array.isArray(next.profiles) ? next.profiles.map(fillProfile) : [];
  let activeId = next.activeId ?? null;

  if (!profiles.length && next.baseUrl) {
    // 旧版单配置迁移：现有配置成为第一个（默认）方案。
    // 注意 v1.5 抛弃旧数据后，运行时注入的 baseUrl 不会再被持久化，
    // 此分支只对历史存量生效一次。
    const name = next.name || deriveProfileName(next.baseUrl) || "默认配置";
    profiles = [
      fillProfile({
        id: makeProfileId(),
        ...pickProfile(next),
        baseUrl: undefined,
        apiKey: undefined,
        name,
      }),
    ];
    activeId = profiles[0].id;
    next.name = name;
    next.baseUrl = "";
    next.apiKey = "";
  }
  if (activeId && !profiles.some((p) => p.id === activeId)) activeId = null;
  if (!activeId && profiles.length) activeId = profiles[0].id;

  next.profiles = profiles;
  next.activeId = activeId;

  // 存量方案清洗：剥离持久化的 baseUrl/apiKey（v1.5 起由全局服务商注入），
  // 以及 providerId/model（m:2 起由主设置 aiAssign.completion 统一承担；
  // 仅对真实存量标记重写，fillProfile 补的 model:"" 不触发每次加载都落盘）
  let stripped = false;
  next.profiles = next.profiles.map((p) => {
    const patch = {};
    if (p.baseUrl || p.apiKey) Object.assign(patch, { baseUrl: "", apiKey: "" });
    // providerId 一律剥离；model 仅对在线类型剥离（webllm 的本地模型 id 保留）
    if (p.providerId !== undefined || (p.model && p.apiType !== "webllm"))
      Object.assign(patch, { providerId: undefined, model: undefined });
    if (Object.keys(patch).length) {
      stripped = true;
      return { ...p, ...patch };
    }
    return p;
  });
  if (next.baseUrl || next.apiKey || next.providerId) {
    next.baseUrl = "";
    next.apiKey = "";
    next.providerId = undefined;
    stripped = true;
  }
  if (stripped) {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(next));
      }
    } catch {}
  }

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
  nextProfiles[idx] = { ...nextProfiles[idx], ...pickProfile(ai) };
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

/**
 * 一次性迁移（m:2）：把存量方案里的连接字段（providerId/model）搬进主设置
 * （stmt-settings-v1）的 aiAssign.completion —— 活动方案的值优先生效，写回
 * 两个 store 并打标记；此后 normalizeAi 只对漏网存量做剥离清洗，不再迁移。
 */
function migrateConnToAssign(ai, store) {
  if (store !== undefined && typeof store.getItem !== "function") store = undefined;
  const globalKey = "stmt-settings-v1";
  let global = null;
  try {
    global = JSON.parse(
      (typeof window !== "undefined" ? window.localStorage : store)?.getItem(globalKey) || "null",
    );
  } catch {}
  global = global && typeof global === "object" ? global : {};

  // 活动方案（或扁平镜像）的连接字段 → aiAssign.completion。
  // WebLLM 方案的 model 是本地模型 id（不是服务商模型），不迁移、不剥离。
  const active =
    (Array.isArray(ai.profiles) ? ai.profiles.find((p) => p.id === ai.activeId) : null) || ai;
  const isWebllm = (active?.apiType || ai.apiType) === "webllm";
  const providerId = typeof active.providerId === "string" ? active.providerId : "";
  const model = String(active.model || "").trim();
  global.aiAssign = {
    ...(global.aiAssign || {}),
    completion: {
      providerId: providerId || "auto",
      model: isWebllm ? "" : model,
      thinking: "off",
      proxy: false,
      proxyOverride: null,
    },
  };

  // 剥离方案内连接字段后写回主设置与本 store（webllm 方案的本地 model 保留）
  const stripConn = (p) => {
    const { providerId: _pid, ...rest } = p;
    if (p.apiType === "webllm") return rest;
    const { model: _m, ...rest2 } = rest;
    return rest2;
  };
  try {
    (typeof window !== "undefined" ? window.localStorage : store)?.setItem(
      globalKey,
      JSON.stringify(global),
    );
  } catch {}
  const strippedProfiles = Array.isArray(ai.profiles) ? ai.profiles.map(stripConn) : ai.profiles;
  const strippedFlat = stripConn({ ...ai });
  // 扁平镜像：webllm 保留本地模型 id，在线类型置空（运行时由 assign 注入）
  strippedFlat.model = isWebllm ? ai.model || "" : "";
  try {
    store?.setItem(
      AI_SETTINGS_KEY,
      JSON.stringify({ ...strippedFlat, profiles: strippedProfiles, m: PROFILE_MIGRATION }),
    );
  } catch {}
  return { ...strippedFlat, profiles: strippedProfiles, m: PROFILE_MIGRATION };
}

/** 读取站点主设置（仅取全局服务商相关字段，node 下安全降级）。 */
function readGlobalProviders() {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem("stmt-settings-v1") || "null");
    const list = Array.isArray(raw?.aiProviders?.list) ? raw.aiProviders.list : [];
    return { list, activeId: raw?.aiProviders?.activeId ?? null };
  } catch {
    return null;
  }
}

/**
 * 按全局服务商解析补全方案的连接信息：providerId 空 = 跟随默认服务商。
 * 返回 { baseUrl, apiKey }（找不到/未配置时为空串，调用方据此提示）。
 */
export function resolveProviderConn(profile, providers) {
  const id = profile?.providerId || providers?.activeId;
  const p = (providers?.list || []).find((q) => q.id === id) || null;
  return { baseUrl: p?.baseUrl || "", apiKey: p?.apiKey || "" };
}

/**
 * 把全局服务商连接信息注入扁平镜像与各方案（运行时解析，不改用户存储的挑选结果）。
 * m:2 起 connection 的 providerId/model 来自主设置 aiAssign.completion：
 *  - 模型：assign.model 覆盖方案；assign.model 为空时回退服务商 models[0]；
 *  - thinking / useProxy 同样来自 aiAssign.completion（useProxy = resolveProxy
 *    的 proxy 结果，混合内容强制转发/显式覆盖均已计入）。
 */
function injectProviderConn(ai) {
  const providers = readGlobalProviders();
  if (!providers) return ai;

  // 全局 completion 挑选结果（主设置 stmt-settings-v1 的 aiAssign.completion）
  let completion = null;
  try {
    const raw = JSON.parse(
      (typeof window !== "undefined" ? window.localStorage : null)?.getItem(
        "stmt-settings-v1",
      ) || "null",
    );
    completion = raw?.aiAssign?.completion || null;
  } catch {}
  const assignModel = String(completion?.model || "").trim();
  // 服务商按 aiAssign.completion.providerId 解析（'auto' → 默认服务商）
  const provider = (providers.list || []).find(
    (q) =>
      q.id ===
      (completion?.providerId && completion.providerId !== "auto"
        ? completion.providerId
        : providers.activeId),
  );
  const conn = { baseUrl: provider?.baseUrl || "", apiKey: provider?.apiKey || "" };

  // 方案内的 model 字段已剥离，全局 assign.model 即唯一来源；空时回退 models[0]。
  // WebLLM 例外：ai.model 是本地模型 id（WEBLLM_MODELS），不来自服务商，保持原值。
  const model =
    ai.apiType === "webllm"
      ? ai.model
      : assignModel || provider?.models?.[0] || "";

  // 转发决策：assign.completion.proxy / 强制转发 / 显式覆盖 → ai.useProxy
  const assignProxy = !!completion?.proxy;
  const override = completion?.proxyOverride;
  const base = conn.baseUrl;
  let host = "";
  try {
    host = new URL(base).hostname;
  } catch {}
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
  let siteProto = "";
  try {
    siteProto = new URL(typeof location !== "undefined" ? location.origin : "").protocol;
  } catch {}
  const forced = !local && siteProto === "https:" && base.startsWith("http://");
  const useProxy =
    override === "proxy" ? true : override === "direct" ? false : forced || assignProxy;

  const withConn = {
    ...ai,
    baseUrl: conn.baseUrl,
    apiKey: conn.apiKey,
    model,
    thinking: completion?.thinking || "off",
    proxyForced: forced,
    proxyLocal: local,
    useProxy,
  };
  if (!Array.isArray(ai.profiles) || !ai.profiles.length) return withConn;
  return {
    ...withConn,
    profiles: ai.profiles.map((p) => ({ ...p, baseUrl: conn.baseUrl, apiKey: conn.apiKey })),
  };
}

/** 读取 AI 设置（window 缺失时安全降级，node 下可直接单测；store 可注入）。 */
export function loadAiSettings(store = storage()) {
  let saved = {};
  try {
    saved = JSON.parse(store?.getItem(AI_SETTINGS_KEY)) || {};
  } catch {}
  let ai = migrateDeepSeekFim({ ...DEFAULT_AI, ...saved });
  // 一次性迁移（m:2）：providerId/model → 主设置 aiAssign.completion
  //（在 migrateDeepSeekFim 之后执行，避免先剥离 model 使旧 DeepSeek 方案检测失效）
  if (ai.m !== PROFILE_MIGRATION) {
    ai = migrateConnToAssign(ai, store);
  }
  return injectProviderConn(normalizeAi(ai));
}

export function saveAiSettings(patch, store = storage()) {
  try {
    const cur = loadAiSettings(store);
    // 剥离运行时注入的连接字段（baseUrl/apiKey 来自全局服务商，thinking/
    // proxyForced/proxyLocal/useProxy 来自主设置 aiAssign.completion —— 均不属于
    // 本 store 的持久化范围；model 保留：webllm 本地模型 id 仍存于扁平镜像，
    // 在线类型的 model 会被注入覆盖）。profiles 若整体 patch 回来，同样按
    // 白名单过滤每个方案
    const { baseUrl, apiKey, thinking, proxyForced, proxyLocal, useProxy, ...cleanCur } = cur;
    const cleanPatch = { ...patch };
    if (Array.isArray(cleanPatch.profiles)) {
      cleanPatch.profiles = cleanPatch.profiles.map((p) => {
        const clean = {};
        // webllm 方案保留 model（本地模型 id）；在线类型按白名单过滤
        const fields = p.apiType === "webllm" ? [...PROFILE_FIELDS, "model"] : PROFILE_FIELDS;
        for (const k of fields) if (p[k] !== undefined) clean[k] = p[k];
        return { ...p, ...clean, baseUrl: undefined, apiKey: undefined };
      });
    }
    store?.setItem(
      AI_SETTINGS_KEY,
      JSON.stringify(upsertActiveProfile({ ...cleanCur, ...cleanPatch })),
    );
  } catch {}
}
