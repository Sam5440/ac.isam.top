/**
 * AI 对话会话持久化（localStorage，仅浏览器）：
 * - 每题独立会话：stmt-chat-v1-<problemId>，切题回来还能继续聊；
 * - 非题目页（暂无入口，预留）：stmt-chat-v1-global。
 * 消息 { role: 'user'|'assistant', content, ts?, error? }，上限 60 条（保留最新）。
 */

const PREFIX = 'stmt-chat-v1-';
export const GLOBAL_CHAT_ID = 'global';
const MAX_MESSAGES = 60;

function keyOf(id) {
  return `${PREFIX}${id || GLOBAL_CHAT_ID}`;
}

export function loadChat(id) {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(window.localStorage.getItem(keyOf(id)) || '[]');
    return Array.isArray(v) ? v.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : [];
  } catch {
    return [];
  }
}

export function saveChat(id, messages) {
  try {
    const trimmed = (messages || []).slice(-MAX_MESSAGES);
    window.localStorage.setItem(keyOf(id), JSON.stringify(trimmed));
  } catch {}
}

export function clearChat(id) {
  try {
    window.localStorage.removeItem(keyOf(id));
  } catch {}
}

/** 清空全部对话记录（设置页用）。返回清除的会话数。 */
export function clearAllChats() {
  if (typeof window === 'undefined') return 0;
  let n = 0;
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
    n = keys.length;
  } catch {}
  return n;
}
