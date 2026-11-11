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

/** 全部记录（文件 + 文件夹，按路径排序）。文件夹记录形态 {path, name, type:'dir', updatedAt}。 */
async function listAll() {
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

/** 列出全部文件（按路径排序，不含文件夹记录），返回记录数组。 */
export async function listFiles() {
  return (await listAll()).filter((r) => r.type !== 'dir');
}

/** 列出显式创建的文件夹路径（含空文件夹；文件路径里隐含的父目录由调用方推导）。 */
export async function listFolders() {
  return (await listAll()).filter((r) => r.type === 'dir').map((r) => r.path);
}

/** 新建文件夹（多级路径一次建好；已存在则忽略）。 */
export async function createFolder(path) {
  const clean = normalizePath(path).replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  const recs = parts.map((_, i) => {
    const p = parts.slice(0, i + 1).join('/');
    return { path: p, name: parts[i], type: 'dir', updatedAt: Date.now() };
  });
  if (!hasIdb()) {
    for (const r of recs) if (!memory.has(r.path)) memory.set(r.path, r);
    return clean;
  }
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (store) => {
      for (const r of recs) store.put(r);
    });
    return clean;
  } finally {
    db.close();
  }
}

/** 批量改写（同一事务）：dels 先删、puts 后写。 */
async function batch(dels, puts) {
  if (!hasIdb()) {
    for (const d of dels) memory.delete(d);
    for (const r of puts) memory.set(r.path, r);
    return;
  }
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      const store = t.objectStore(STORE);
      for (const d of dels) store.delete(d);
      for (const r of puts) store.put(r);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error ?? new Error('IDE 工作区写入失败'));
      t.onabort = () => reject(t.error ?? new Error('IDE 工作区事务中止'));
    });
  } finally {
    db.close();
  }
}

/** 重命名 / 移动文件夹：其下所有文件与子文件夹一并改前缀。返回 {from, to, moved:[{from,to}]}。 */
export async function renameFolder(oldPath, newPath) {
  const from = normalizePath(oldPath).replace(/\/+$/, '');
  const to = normalizePath(newPath).replace(/\/+$/, '');
  if (to === from || to.startsWith(`${from}/`)) throw new Error('不能把文件夹移动到它自身内部');
  const all = await listAll();
  const under = all.filter((r) => r.path === from || r.path.startsWith(`${from}/`));
  const taken = new Set(all.map((r) => r.path));
  const moved = [];
  const puts = [];
  for (const r of under) {
    const np = to + r.path.slice(from.length);
    if (taken.has(np) && !under.some((u) => u.path === np)) throw new Error(`目标已存在：${np}`);
    moved.push({ from: r.path, to: np, type: r.type });
    puts.push(r.type === 'dir' ? { ...r, path: np, name: np.split('/').pop(), updatedAt: Date.now() } : makeRecord(np, r.content));
  }
  // 目标父目录与自身目录记录
  const parents = to.split('/').slice(0, -1);
  for (let i = 1; i <= parents.length; i++) {
    const p = parents.slice(0, i).join('/');
    if (!taken.has(p)) puts.push({ path: p, name: parents[i - 1], type: 'dir', updatedAt: Date.now() });
  }
  if (!under.some((r) => r.path === from)) puts.push({ path: to, name: to.split('/').pop(), type: 'dir', updatedAt: Date.now() });
  await batch(under.map((r) => r.path), puts);
  return { from, to, moved: moved.filter((m) => m.type !== 'dir') };
}

/** 删除文件夹及其全部内容。返回被删除的文件路径。 */
export async function deleteFolder(path) {
  const clean = normalizePath(path).replace(/\/+$/, '');
  const under = (await listAll()).filter((r) => r.path === clean || r.path.startsWith(`${clean}/`));
  await batch(under.map((r) => r.path), []);
  return under.filter((r) => r.type !== 'dir').map((r) => r.path);
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
 *  文本按 UTF-8 读取；dir 为目标文件夹（'' = 根）；上传文件夹时
 *  （webkitRelativePath）保留相对目录结构。 */
export async function importFiles(fileList, dir = '') {
  const files = [...(fileList ?? [])].filter(Boolean);
  const base = String(dir ?? '').replace(/^\/+|\/+$/g, '');
  const out = [];
  for (const file of files) {
    const content = await file.text();
    const rel = file.webkitRelativePath || file.name;
    out.push(await putFile(base ? `${base}/${rel}` : rel, content));
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