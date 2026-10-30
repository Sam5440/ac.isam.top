'use client';

/**
 * 客户端翻译存储（参考 ys_problem_web/lib/zh-store.js 移植）：
 * 访客浏览器为「存档与本机缓存都没覆盖的（段落, 渠道）对」实时请求译文，
 * 结果写入 IndexedDB 并广播订阅者，UI 原地升级。
 *
 * 分发为逐题轮转：第 1 段 → 渠道 1，第 2 段 → 渠道 2 …… 跑完一轮再来一轮，
 * 直到每个渠道覆盖每段。每渠道单并发、全局 3s 间隔。连续失败的渠道本轮
 * 视为下线，其余渠道按优先级兜底。
 */

import { useEffect, useReducer } from 'react';

import { mtTranslate } from '@/lib/client-mt';

export const CHANNELS = ['deepl', 'youdao', 'caiyun', 'iflyrec'];
const GAP_MS = 3000;
const MAX_CONSECUTIVE_FAILS = 6;

/* ---------------- per-key records + subscriptions ---------------- */

const records = new Map(); // key -> { zh: {channel: text}, status: {channel: 'queued'|'loading'|'failed'} }
const listeners = new Map(); // key -> Set<fn>

const recOf = (key) => {
  let r = records.get(key);
  if (!r) {
    r = { zh: {}, status: {} };
    records.set(key, r);
  }
  return r;
};

const notify = (key) => listeners.get(key)?.forEach((fn) => fn());

export function subscribeZh(key, fn) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

/** Live translation record for one paragraph; re-renders on every change. */
export function useZhSegment(key) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribeZh(key, force), [key]);
  return recOf(key);
}

/* ---------------- IndexedDB persistence (memory-only fallback) ---------------- */

const DB_NAME = 'ac-problem-zh';
const STORE = 'segments';
let dbPromise;

function idb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ||= new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function idbLoadStatement(code) {
  return idb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve({});
        const out = {};
        const range = IDBKeyRange.bound(`${code}|`, `${code}|\uffff`);
        const cur = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor(range);
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return resolve(out);
          out[c.key] = c.value || {};
          c.continue();
        };
        cur.onerror = () => resolve(out);
      }),
  );
}

function idbSave(key, channel, text) {
  idb().then((db) => {
    if (!db) return;
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    const get = store.get(key);
    get.onsuccess = () => {
      const v = get.result || {};
      v[channel] = text;
      store.put(v, key);
    };
  });
}

/** Wipe every locally cached translation (settings dialog button). */
export async function clearZhCache() {
  records.clear();
  const db = await idb();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = resolve;
    tx.onabort = resolve;
  });
}

/* ---------------- per-channel schedulers ---------------- */

const chan = Object.fromEntries(
  CHANNELS.map((c) => [
    c,
    { q: [], inFlightKeys: new Set(), active: false, lastStart: 0, fails: 0, dead: false },
  ]),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ensure every channel ends up with every segment: pairs covered by the CI
 * archive or the local cache are skipped, the rest are queued round-robin
 * and drained with per-channel 3s pacing. Safe to call again at any time.
 *
 * segments: [{ key, text, archived }] — archived=true means the CI pipeline
 * already provides this segment's translation (channel 'ai').
 */
export function hydrateSegments(code, segments) {
  if (!code || !segments?.length) return;
  const segs = segments.map((s, pos) => ({ ...s, pos }));
  idbLoadStatement(code).then((saved) => {
    for (const [key, v] of Object.entries(saved)) {
      const rec = recOf(key);
      for (const [ch, text] of Object.entries(v)) {
        if (CHANNELS.includes(ch) && typeof text === 'string' && text && !rec.zh[ch]) {
          rec.zh[ch] = text;
        }
      }
    }
    enqueue(segs);
  });
}

function enqueue(segs) {
  const touched = new Set();
  for (const channel of CHANNELS) {
    const st = chan[channel];
    if (st.dead) continue;
    const pending = segs.filter(({ key, archived }) => {
      if (archived) return false;
      if (recOf(key).zh[channel]) return false;
      if (st.inFlightKeys.has(key)) return false;
      return true;
    });
    if (!pending.length) continue;
    const chIdx = CHANNELS.indexOf(channel);
    const n = CHANNELS.length;
    const pass = (pos) => (((pos - chIdx) % n) + n) % n;
    pending.sort((a, b) => pass(a.pos) - pass(b.pos) || a.pos - b.pos);
    for (const t of pending) {
      st.q.push(t);
      st.inFlightKeys.add(t.key);
      recOf(t.key).status[channel] = 'queued';
      touched.add(t.key);
    }
    pump(channel);
  }
  for (const key of touched) notify(key);
}

async function pump(channel) {
  const st = chan[channel];
  if (st.active) return;
  st.active = true;
  try {
    while (st.q.length) {
      const task = st.q.shift();
      const rec = recOf(task.key);
      if (rec.zh[channel]) {
        st.inFlightKeys.delete(task.key);
        continue;
      }
      const wait = st.lastStart + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      st.lastStart = Date.now();
      rec.status[channel] = 'loading';
      notify(task.key);
      try {
        const text = await mtTranslate(channel, task.text);
        rec.zh[channel] = text;
        rec.status[channel] = 'done';
        st.fails = 0;
        idbSave(task.key, channel, text);
      } catch {
        if (!task.retried) {
          task.retried = true;
          rec.status[channel] = 'queued';
          st.q.unshift(task);
          notify(task.key);
          continue;
        }
        rec.status[channel] = 'failed';
        st.fails += 1;
        if (st.fails >= MAX_CONSECUTIVE_FAILS) {
          st.dead = true;
          for (const t of st.q) {
            recOf(t.key).status[channel] = 'failed';
            st.inFlightKeys.delete(t.key);
            notify(t.key);
          }
          st.q.length = 0;
        }
      }
      st.inFlightKeys.delete(task.key);
      notify(task.key);
    }
  } finally {
    st.active = false;
  }
}
