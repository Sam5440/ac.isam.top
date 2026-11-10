/**
 * IDE 工作区存储（IndexedDB）：库 `ac-ide`，store `files`（keyPath `path`）。
 * 记录形态 {path, name, lang, content, updatedAt}。纯浏览器模块——严禁被
 * 服务端 import（顶层就有 indexedDB 探测，Node 下自动降级内存 Map，仅作
 * 降级兜底，正式数据走 IndexedDB）。
 *
 * API：listFiles/getFile/putFile/deleteFile/renameFile/importFiles/clearWorkspace。
 */

const DB_NAME = 'ac-ide';
// v2：与 lib/view-history.js 共库，store `view-history` 由其升级路径创建；
// 本模块升级时对两个 store 都判空补建，任一侧先打开都能互容。
const DB_VERSION = 2;
const STORE = 'files';
const VIEW_HISTORY_STORE = 'view-history';

// SSR / Node 环境降级：内存 Map 模拟同一 API（测试与首帧 hydration 安全）
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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
      // 共库互容：view-history（lib/view-history.js）的 store 缺失时补建
      if (!db.objectStoreNames.contains(VIEW_HISTORY_STORE)) {
        db.createObjectStore(VIEW_HISTORY_STORE, { keyPath: ['platform', 'problemId'] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打开 IDE 工作区失败'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error ?? new Error('IDE 工作区读写失败'));
    t.onabort = () => reject(t.error ?? new Error('IDE 工作区事务中止'));
  });
}

/** 把 IDBRequest 包装成 Promise（op: 'getAll'|'get'|'put'|'delete'|'clear'）。 */
function requestPromise(store, op, ...args) {
  return new Promise((resolve, reject) => {
    const req = store[op](...args);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDE 工作区读取失败'));
  });
}

/** 由文件路径推断语言：.py → python，其余默认 cpp（含 .cpp/.cc/.h 等）。 */
export function langOf(path) {
  return /\.py$/i.test(String(path)) ? 'python' : 'cpp';
}

function normalizePath(path) {
  const p = String(path ?? '').replace(/^\/+/, '').trim();
  if (!p) throw new Error('文件名不能为空');
  return p;
}

function makeRecord(path, content) {
  const clean = normalizePath(path);
  const name = clean.split('/').pop();
  return { path: clean, name, lang: langOf(clean), content: String(content ?? ''), updatedAt: Date.now() };
}

/** 列出全部文件（按路径排序），返回记录数组。 */
export async function listFiles() {
  if (!hasIdb()) {
    return [...memory.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
  const db = await openDb();
  try {
    const all = await tx(db, 'readonly', (store) => requestPromise(store, 'getAll'));
    return (all ?? []).sort((a, b) => a.path.localeCompare(b.path));
  } finally {
    db.close();
  }
}

/** 读取单个文件，不存在返回 null。 */
export async function getFile(path) {
  const clean = normalizePath(path);
  if (!hasIdb()) return memory.get(clean) ?? null;
  const db = await openDb();
  try {
    return (await tx(db, 'readonly', (store) => requestPromise(store, 'get', clean))) ?? null;
  } finally {
    db.close();
  }
}

/** 写入（新建或覆盖，自动更新 updatedAt）。 */
export async function putFile(path, content) {
  const rec = makeRecord(path, content);
  if (!hasIdb()) {
    memory.set(rec.path, rec);
    return rec;
  }
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (store) => requestPromise(store, 'put', rec));
    return rec;
  } finally {
    db.close();
  }
}

/** 删除单个文件。 */
export async function deleteFile(path) {
  const clean = normalizePath(path);
  if (!hasIdb()) {
    memory.delete(clean);
    return;
  }
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (store) => requestPromise(store, 'delete', clean));
  } finally {
    db.close();
  }
}

/** 重命名（同一事务内读旧写新删旧，保证原子性）。 */
export async function renameFile(oldPath, newPath) {
  const from = normalizePath(oldPath);
  const rec = await getFile(from);
  if (!rec) throw new Error(`文件不存在：${from}`);
  const next = makeRecord(newPath, rec.content);
  if (!hasIdb()) {
    memory.delete(from);
    memory.set(next.path, next);
    return next;
  }
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      const store = t.objectStore(STORE);
      store.delete(from);
      store.put(next);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error ?? new Error('重命名失败'));
      t.onabort = () => reject(t.error ?? new Error('重命名事务中止'));
    });
    return next;
  } finally {
    db.close();
  }
}

/** 上传导入：FileList/File[] → {path, name, lang, content, updatedAt}[]。
 *  文本按 UTF-8 读取；路径取文件名（不重建目录结构）。 */
export async function importFiles(fileList) {
  const files = [...(fileList ?? [])].filter(Boolean);
  const out = [];
  for (const file of files) {
    const content = await file.text();
    out.push(await putFile(file.name, content));
  }
  return out;
}

/** 清空工作区。 */
export async function clearWorkspace() {
  if (!hasIdb()) {
    memory.clear();
    return;
  }
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (store) => requestPromise(store, 'clear'));
  } finally {
    db.close();
  }
}