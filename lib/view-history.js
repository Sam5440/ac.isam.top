/**
 * 浏览历史存储（IndexedDB）：与 lib/ide-workspace.js 共用库 `ac-ide`，
 * store `view-history`（keyPath 复合键 ['platform','problemId']）。
 * 记录形态 {platform, problemId, title, titleZh, url, firstSeen, lastSeen,
 * totalDwellMs, lastJudge:{verdict:'ac'|'fail'|null, at}}。纯浏览器模块——
 * 严禁被服务端 import（Node 下自动降级内存 Map；浏览器隐私模式 IndexedDB
 * 打开失败时同样静默降级内存，仅本会话有效）。
 *
 * 核心记录逻辑（upsert / 停留累计 / 判题 / 过滤）抽为纯函数，
 * createViewHistory(backend, clock) 可注入存储后端与固定时钟供 node --test
 * 单测（仿 lib/compiler/cp-settings.js 的注入模式）。
 *
 * API：touchView/heartbeat/recordJudge/listHistory/clearHistory。
 */

const DB_NAME = 'ac-ide';
// v2：在 v1（store files）基础上新增 view-history。onupgradeneeded 对两个
// store 都判空补建 —— 旧 v1 库升版时补齐缺失 store；ide-workspace 的升级
// 函数同样处理双 store，无论谁先打开都能把库迁到 v2。
const DB_VERSION = 2;
const STORE = 'view-history';

/** 历史列表默认最低停留时长：不足此值的浏览不展示。 */
export const MIN_DWELL_MS = 60_000;

// SSR / Node 环境降级：内存 Map 模拟同一 API（键 = `${platform}:${problemId}`）
const memory = new Map();

function hasIdb() {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // files（ide-workspace 工作区）与 view-history 双 store 判空补建，
      // 兼容只有 files 的旧 v1 库
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: ['platform', 'problemId'] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打开浏览历史库失败'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error ?? new Error('浏览历史读写失败'));
    t.onabort = () => reject(t.error ?? new Error('浏览历史事务中止'));
  });
}

/** 把 IDBRequest 包装成 Promise（op: 'getAll'|'get'|'put'|'clear'）。 */
function requestPromise(store, op, ...args) {
  return new Promise((resolve, reject) => {
    const req = store[op](...args);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('浏览历史读取失败'));
  });
}

/** 记录的业务键（与 ide-bus problemKey 同形）。 */
export function viewKey(platform, problemId) {
  return `${platform}:${problemId}`;
}

function normalizeVerdict(v) {
  if (v === 'ac' || v === 'AC') return 'ac';
  if (v == null || v === '') return null;
  // 其余任意非 AC 结果（WA/RE/TE/'fail'…）统一视为未通过
  return 'fail';
}

/** upsert 纯逻辑：不存在则新建（firstSeen = now，停留 0，未判题）；
 *  存在则刷新 title/titleZh/url/lastSeen，保留 firstSeen/totalDwellMs/lastJudge。 */
export function upsertView(prev, meta, now = Date.now()) {
  return {
    platform: String(meta.platform ?? ''),
    problemId: String(meta.problemId ?? ''),
    title: meta.title != null ? String(meta.title) : prev?.title ?? '',
    titleZh: meta.titleZh != null ? String(meta.titleZh) : prev?.titleZh ?? null,
    url: meta.url != null ? String(meta.url) : prev?.url ?? '',
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
    totalDwellMs: prev?.totalDwellMs ?? 0,
    lastJudge: prev?.lastJudge ?? { verdict: null, at: null },
  };
}

/** 停留累计（ms）：非法/非正数原样返回，不落盘。 */
export function withDwell(record, ms) {
  const add = Number(ms);
  if (!Number.isFinite(add) || add <= 0) return record;
  return { ...record, totalDwellMs: (record.totalDwellMs ?? 0) + add };
}

/** 记录最近一次判题结果（verdict 归一化为 'ac'|'fail'|null）。 */
export function withJudge(record, verdict, now = Date.now()) {
  return { ...record, lastJudge: { verdict: normalizeVerdict(verdict), at: now } };
}

/** 过滤 + 排序纯逻辑：totalDwellMs ≥ minDwellMs（默认 60s），lastSeen 降序。 */
export function filterHistory(records, { minDwellMs = MIN_DWELL_MS } = {}) {
  const min = Number(minDwellMs);
  return (records ?? [])
    .filter((r) => r && (r.totalDwellMs ?? 0) >= min)
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

/**
 * 注入式工厂：backend = {get(platform, problemId), put(record), getAll(), clear()}，
 * clock 可注入固定时钟（单测确定性）。返回与下方默认导出同签名的 API。
 */
export function createViewHistory(backend, clock = Date.now) {
  // 记录缺失时的占位（heartbeat/recordJudge 先于 touchView 到达的兜底）
  const stub = (platform, problemId, now) => upsertView(null, { platform, problemId }, now);
  return {
    /** 记录/刷新一次浏览（upsert：首见保留、最近访问刷新）。 */
    async touchView(meta) {
      const now = clock();
      const prev = await backend.get(meta.platform, meta.problemId);
      const next = upsertView(prev, meta, now);
      await backend.put(next);
      return next;
    },
    /** 累计停留时长（ms）；记录不存在时先建占位记录。 */
    async heartbeat(platform, problemId, ms) {
      const now = clock();
      const prev = (await backend.get(platform, problemId)) ?? stub(platform, problemId, now);
      const next = withDwell(prev, ms);
      if (next === prev) return prev;
      await backend.put(next);
      return next;
    },
    /** 记录最近一次判题结果（'ac' | 'fail'）。 */
    async recordJudge(platform, problemId, verdict) {
      const now = clock();
      const prev = (await backend.get(platform, problemId)) ?? stub(platform, problemId, now);
      const next = withJudge(prev, verdict, now);
      await backend.put(next);
      return next;
    },
    /** 列出历史（默认过滤停留 < 60s 的记录），lastSeen 降序。 */
    async listHistory(opts) {
      return filterHistory(await backend.getAll(), opts);
    },
    /** 清空全部历史。 */
    async clearHistory() {
      await backend.clear();
    },
  };
}

// ---- 默认后端：IndexedDB（主）/ 内存 Map（降级）----

const idbBackend = {
  async get(platform, problemId) {
    const db = await openDb();
    try {
      return (await tx(db, 'readonly', (s) => requestPromise(s, 'get', [platform, problemId]))) ?? null;
    } finally {
      db.close();
    }
  },
  async put(record) {
    const db = await openDb();
    try {
      await tx(db, 'readwrite', (s) => requestPromise(s, 'put', record));
    } finally {
      db.close();
    }
  },
  async getAll() {
    const db = await openDb();
    try {
      return (await tx(db, 'readonly', (s) => requestPromise(s, 'getAll'))) ?? [];
    } finally {
      db.close();
    }
  },
  async clear() {
    const db = await openDb();
    try {
      await tx(db, 'readwrite', (s) => requestPromise(s, 'clear'));
    } finally {
      db.close();
    }
  },
};

const memoryBackend = {
  async get(platform, problemId) {
    return memory.get(viewKey(platform, problemId)) ?? null;
  },
  async put(record) {
    memory.set(viewKey(record.platform, record.problemId), record);
  },
  async getAll() {
    return [...memory.values()];
  },
  async clear() {
    memory.clear();
  },
};

const idbApi = createViewHistory(idbBackend);
const memoryApi = createViewHistory(memoryBackend);

/** 执行入口：优先 IndexedDB，打开/读写失败（隐私模式等）静默降级内存。 */
async function run(fn) {
  if (hasIdb()) {
    try {
      return await fn(idbApi);
    } catch {}
  }
  return fn(memoryApi);
}

export const touchView = (meta) => run((api) => api.touchView(meta));
export const heartbeat = (platform, problemId, ms) =>
  run((api) => api.heartbeat(platform, problemId, ms));
export const recordJudge = (platform, problemId, verdict) =>
  run((api) => api.recordJudge(platform, problemId, verdict));
export const listHistory = (opts) => run((api) => api.listHistory(opts));
export const clearHistory = () => run((api) => api.clearHistory());
