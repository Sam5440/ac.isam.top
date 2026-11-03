/**
 * AI 补全 Token 用量统计。
 *
 * - 数据源：API 响应的 usage 字段（OpenAI 兼容 usage.prompt_tokens/completion_tokens、
 *   Ollama prompt_eval_count/eval_count）；响应无 usage 时按字符数估算（标 ≰）
 * - 聚合：按平台方案（profileId）累计 提示/补全 tokens、请求/失败次数，localStorage 持久化
 * - UI：状态栏 chip 显示当前方案累计；设置页表格 + 清零（估算值以 ≈ 标注）
 */

const KEY = 'ysc-ai-token-stats-v1';
const RECENT_MAX = 30;

const listeners = new Set();

function emptyProfile() {
  return {
    name: '', model: '',
    prompt: 0, completion: 0, // 真实（API usage 上报）
    promptEst: 0, completionEst: 0, // 本地估算
    requests: 0, errors: 0,
    lastLatencyMs: 0, updatedAt: 0,
  };
}

function load() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY));
    if (raw && typeof raw === 'object' && raw.profiles && typeof raw.profiles === 'object') {
      return { profiles: raw.profiles, recent: Array.isArray(raw.recent) ? raw.recent : [], since: raw.since ?? Date.now() };
    }
  } catch {}
  return { profiles: {}, recent: [], since: Date.now() };
}

function save(stats) {
  try { window.localStorage.setItem(KEY, JSON.stringify(stats)); } catch {}
  for (const cb of listeners) {
    try { cb(); } catch {}
  }
}

/** 无 usage 时按字符数粗估：CJK ≈ 1.5 字/token，其余 ≈ 4 字/token。 */
export function estimateTokens(text) {
  const s = String(text ?? '');
  let cjk = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef)) cjk++;
  }
  return Math.ceil(cjk / 1.5 + (s.length - cjk) / 4);
}

/**
 * 记录一次补全的 token 用量。
 * @param {object} u { profileId, profileName, model, prompt, completion, estimated, latencyMs, error }
 *   error=true 时只计失败次数，不计 tokens。
 */
export function recordUsage(u) {
  const stats = load();
  const id = u.profileId || 'default';
  const p = stats.profiles[id] ?? emptyProfile();
  p.name = u.profileName || p.name || '';
  p.model = u.model || p.model || '';
  if (u.error) {
    p.errors += 1;
  } else {
    p.requests += 1;
    if (u.estimated) {
      p.promptEst += u.prompt || 0;
      p.completionEst += u.completion || 0;
    } else {
      p.prompt += u.prompt || 0;
      p.completion += u.completion || 0;
    }
    p.lastLatencyMs = u.latencyMs || 0;
  }
  p.updatedAt = Date.now();
  stats.profiles[id] = p;

  stats.recent.unshift({
    at: Date.now(), profileId: id, name: p.name, model: p.model,
    prompt: u.error ? null : u.prompt, completion: u.error ? null : u.completion,
    estimated: !!u.estimated, error: !!u.error, latencyMs: u.latencyMs || 0,
  });
  if (stats.recent.length > RECENT_MAX) stats.recent.length = RECENT_MAX;

  save(stats);
}

/** 当前快照（profiles + recent）。 */
export function getTokenStats() {
  return load();
}

/** 清零：传 profileId 只清该方案，不传清全部。 */
export function resetTokenStats(profileId) {
  const stats = load();
  if (profileId) {
    delete stats.profiles[profileId];
    stats.recent = stats.recent.filter((r) => r.profileId !== profileId);
  } else {
    stats.profiles = {};
    stats.recent = [];
    stats.since = Date.now();
  }
  save(stats);
}

/** 订阅变化（返回退订函数）。 */
export function subscribeTokenStats(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 紧凑数字：0 / 942 / 1.2k / 34.5k / 1.2M。 */
export function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1000000) return `${(v / 1000).toFixed(v < 10000 ? 1 : 0)}k`;
  return `${(v / 1000000).toFixed(1)}M`;
}
