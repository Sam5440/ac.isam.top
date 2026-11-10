import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MESSAGES,
  MAX_SESSIONS,
  clearAllChats,
  createSession,
  deleteSession,
  loadActiveMessages,
  loadSessions,
  renameSession,
  saveSessions,
} from '../lib/chat-store.js';

/** lib/chat-store.js 多会话存储：迁移 / 上限 / 增删改（注入 store，无 window）。 */

/** 极简 localStorage 桩（Map 语义，与 node 测试中的注入约定一致）。 */
function fakeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const msg = (role, content) => ({ role, content });

test('loadSessions: 无数据返回 null', () => {
  const st = fakeStore();
  assert.equal(loadSessions('p1', st), null);
});

test('loadSessions: 旧版数组键迁移为 legacy 会话（旧键保留）', () => {
  const st = fakeStore();
  st.setItem('stmt-chat-v1-P1', JSON.stringify([msg('user', '你好'), msg('assistant', '解答')]));
  const state = loadSessions('P1', st);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].id, 'legacy');
  assert.equal(state.sessions[0].title, '默认会话');
  assert.equal(state.sessions[0].messages.length, 2);
  assert.equal(state.activeId, 'legacy');
  // 旧键保留不删（供回滚）
  assert.ok(st.getItem('stmt-chat-v1-P1'));
  // 已写入新键，二次读取直接命中
  assert.equal(loadSessions('P1', st).sessions[0].id, 'legacy');
});

test('createSession/saveSessions: 建会话置 active，重载仍在', () => {
  const st = fakeStore();
  const s1 = createSession('p1', '第一个', st);
  const s2 = createSession('p1', '第二个', st);
  assert.equal(s2.activeId, s2.sessions[0].id);
  assert.equal(s2.sessions.length, 2);
  const reloaded = loadSessions('p1', st);
  assert.equal(reloaded.sessions.length, 2);
  assert.equal(reloaded.activeId, s2.activeId);
});

test('saveSessions: 消息上限 60（保留最新）', () => {
  const st = fakeStore();
  const msgs = Array.from({ length: 80 }, (_, i) => msg('user', `m${i}`));
  saveSessions('p1', { activeId: 'a', sessions: [{ id: 'a', title: 't', createdAt: 1, updatedAt: 1, messages: msgs }] }, st);
  const state = loadSessions('p1', st);
  assert.equal(state.sessions[0].messages.length, MAX_MESSAGES);
  assert.equal(state.sessions[0].messages[0].content, 'm20');
});

test('saveSessions: 会话上限 20（updatedAt 新者保留）', () => {
  const st = fakeStore();
  const sessions = Array.from({ length: 25 }, (_, i) => ({
    id: `s${i}`,
    title: `t${i}`,
    createdAt: i,
    updatedAt: i,
    messages: [],
  }));
  saveSessions('p1', { activeId: 's0', sessions }, st);
  const state = loadSessions('p1', st);
  assert.equal(state.sessions.length, MAX_SESSIONS);
  // 排序后旧的最先被挤掉（s24 最新在前，s5+ 被裁掉）
  assert.ok(!state.sessions.some((s) => s.id === 's0'));
  assert.ok(state.sessions.some((s) => s.id === 's24'));
});

test('renameSession: 改名并标记 renamed；空名不动', () => {
  const st = fakeStore();
  createSession('p1', '原', st);
  const state = loadSessions('p1', st);
  const id = state.activeId;
  const next = renameSession('p1', id, '新名字', st);
  assert.equal(next.sessions[0].title, '新名字');
  assert.equal(next.sessions[0].renamed, true);
  assert.equal(renameSession('p1', id, '   ', st).sessions[0].title, '新名字');
});

test('deleteSession: 删 active 回落第一个；删光 activeId=null', () => {
  const st = fakeStore();
  const a = createSession('p1', 'a', st);
  const b = createSession('p1', 'b', st);
  const next = deleteSession('p1', b.activeId, st);
  assert.equal(next.activeId, a.activeId);
  const last = deleteSession('p1', a.activeId, st);
  assert.equal(last.sessions.length, 0);
  assert.equal(last.activeId, null);
});

test('loadActiveMessages: 返回 active 会话消息，无数据为空数组', () => {
  const st = fakeStore();
  assert.deepEqual(loadActiveMessages('none', st), []);
  createSession('p1', 't', st);
  assert.deepEqual(loadActiveMessages('p1', st), []);
});

test('clearAllChats: 双前缀全清并计数', () => {
  const st = fakeStore();
  st.setItem('stmt-chat-v1-a', '[]');
  st.setItem('stmt-chat-sessions-v1-b', '{}');
  st.setItem('stmt-other', 'keep');
  const n = clearAllChats(st);
  assert.equal(n, 2);
  assert.equal(st.getItem('stmt-other'), 'keep');
  assert.equal(st.getItem('stmt-chat-v1-a'), null);
});
