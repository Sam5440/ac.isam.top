/**
 * AI 对话多会话持久化（localStorage，仅浏览器）。
 *
 * 键位：
 *   stmt-chat-sessions-v1-<scope>   多会话结构（新）：
 *     { activeId, sessions: [{ id, title, createdAt, updatedAt, messages[] }] }
 *     scope = problemId（题目页）或 'global'（预留）。
 *   stmt-chat-v1-<scope>            旧版单会话（纯数组）——首次加载时迁移
 *     包装为 id='legacy' 的单个会话写入新键，旧键保留不删（供回滚）。
 *
 * 消息 { role: 'user'|'assistant', content, reasoning?, ts?, error? }，
 * 每会话上限 60 条（保留最新），每 scope 会话上限 20（超出挤最旧）。
 * 所有 API 均 window 守卫 + try/catch 静默降级，可在 node --test 注入 store。
 */

const PREFIX = 'stmt-chat-v1-';
const SESSIONS_PREFIX = 'stmt-chat-sessions-v1-';
export const GLOBAL_CHAT_ID = 'global';
export const MAX_MESSAGES = 60;
export const MAX_SESSIONS = 20;

function legacyKeyOf(scope) {
  return `${PREFIX}${scope || GLOBAL_CHAT_ID}`;
}

function keyOf(scope) {
  return `${SESSIONS_PREFIX}${scope || GLOBAL_CHAT_ID}`;
}

const isMsg = (m) =>
  m &&
  (m.role === 'user' || m.role === 'assistant') &&
  typeof m.content === 'string';

const trimMessages = (messages) => (messages || []).filter(isMsg).slice(-MAX_MESSAGES);

/** createdAt 归一：合法数值用原值，否则取当前时间。 */
function fixCreatedAt(s) {
  const c = Number(s.createdAt);
  return Number.isFinite(c) && s.createdAt != null ? c : Date.now();
}

/** updatedAt 归一：合法数值用原值，否则回退 createdAt，再否则取当前时间。 */
function fixUpdatedAt(s) {
  const u = Number(s.updatedAt);
  if (Number.isFinite(u) && s.updatedAt != null) return u;
  const c = Number(s.createdAt);
  return Number.isFinite(c) && s.createdAt != null ? c : Date.now();
}

/** 会话列表归一化：过滤非法项、截断消息、updatedAt 降序、超出上限挤最旧。 */
function normalizeState(raw) {
  const sessions = (Array.isArray(raw?.sessions) ? raw.sessions : [])
    .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.messages))
    .map((s) => ({
      id: s.id,
      title: typeof s.title === 'string' && s.title ? s.title : '新会话',
      createdAt: fixCreatedAt(s),
      updatedAt: fixUpdatedAt(s),
      renamed: Boolean(s.renamed), // 手动改过名 → 不再被首条消息自动标题
      messages: trimMessages(s.messages),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.createdAt < b.createdAt ? -1 : 1))
    .slice(0, MAX_SESSIONS);
  const activeId = sessions.some((s) => s.id === raw?.activeId)
    ? raw.activeId
    : sessions[0]?.id || null;
  return { activeId, sessions };
}

/**
 * 载入某 scope 的多会话状态。首次发现旧键为非空数组且新键不存在时，
 * 迁移包装为 {id:'legacy', title:'默认会话'} 单会话并写入新键（旧键保留）。
 * 无任何数据时返回 null（调用方据此新建首个会话）。
 */
export function loadSessions(scope, store) {
  const st = store ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!st) return null;
  try {
    const raw = st.getItem(keyOf(scope));
    if (raw) return normalizeState(JSON.parse(raw));
  } catch {}
  // 旧数据迁移：一次性包装，旧键保留不删
  try {
    const legacy = JSON.parse(st.getItem(legacyKeyOf(scope)) || 'null');
    if (Array.isArray(legacy) && legacy.some(isMsg)) {
      const state = {
        activeId: 'legacy',
        sessions: [
          {
            id: 'legacy',
            title: '默认会话',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: trimMessages(legacy),
            renamed: true, // 迁移来的旧会话不再自动改名
          },
        ],
      };
      try {
        st.setItem(keyOf(scope), JSON.stringify(state));
      } catch {}
      return state;
    }
  } catch {}
  return null;
}

/** 保存某 scope 的多会话状态（截断/过滤/会话数上限）。 */
export function saveSessions(scope, state, store) {
  const st = store ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!st) return;
  try {
    st.setItem(keyOf(scope), JSON.stringify(normalizeState(state)));
  } catch {}
}

/** 新建一个会话并置为 active，返回新状态。 */
export function createSession(scope, title, store) {
  const state = loadSessions(scope, store) || { activeId: null, sessions: [] };
  const now = Date.now();
  const session = {
    id: `s${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: (typeof title === 'string' && title.trim()) || '新会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  const next = { activeId: session.id, sessions: [session, ...state.sessions] };
  saveSessions(scope, next, store);
  return next;
}

/** 重命名会话（手动改名后不再被自动标题覆盖）。返回新状态或 null。 */
export function renameSession(scope, id, title, store) {
  const state = loadSessions(scope, store);
  const text = String(title || '').trim();
  if (!state || !id || !text) return state || null;
  const next = {
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === id ? { ...s, title: text, renamed: true, updatedAt: Date.now() } : s,
    ),
  };
  saveSessions(scope, next, store);
  return next;
}

/** 删除会话；删 active 时回落第一个（无会话则 activeId=null）。 */
export function deleteSession(scope, id, store) {
  const state = loadSessions(scope, store);
  if (!state || !id) return state || null;
  const sessions = state.sessions.filter((s) => s.id !== id);
  const next = {
    activeId:
      state.activeId === id ? (sessions[0]?.id ?? null) : state.activeId,
    sessions,
  };
  saveSessions(scope, next, store);
  return next;
}

/** 载入当前 active 会话的消息（无会话/空数据 → 空数组）。 */
export function loadActiveMessages(scope, store) {
  const state = loadSessions(scope, store);
  if (!state) return [];
  const s = state.sessions.find((q) => q.id === state.activeId) || state.sessions[0];
  return s ? s.messages : [];
}

/** 旧版单会话键清理（保持兼容：设置页「清空全部对话记录」用）。 */
export function clearChat(scope, store) {
  const st = store ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!st) return;
  try {
    st.removeItem(legacyKeyOf(scope));
  } catch {}
}

/** 清空全部对话记录（双前缀扫描，含 legacy）。返回清除的键数。 */
export function clearAllChats(store) {
  const st = store ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!st) return 0;
  let n = 0;
  try {
    const keys = [];
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (k && (k.startsWith(PREFIX) || k.startsWith(SESSIONS_PREFIX))) keys.push(k);
    }
    keys.forEach((k) => st.removeItem(k));
    n = keys.length;
  } catch {}
  return n;
}
