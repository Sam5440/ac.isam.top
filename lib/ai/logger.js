/**
 * 应用内诊断日志：每个模块独立 tag（如 ai/webllm、compiler、runtime），
 * 统一进入内存环形缓冲并持久化到 localStorage，供设置页「诊断日志」查看/导出。
 *
 * 设计动机：手机端没有 devtools，模型加载等问题需要能直接在页面里看到
 * 「卡在哪一步、为什么失败」。所有条目同时镜像到 console（桌面开发不变）。
 *
 * - debug：细节流水（进度回调、逐条消息）；info：生命周期里程碑；warn/error：异常
 * - data 参数会被 JSON 序列化存储（error 对象转为 {name, message, stack}）
 * - 持久化按 800ms 节流写入，页面隐藏时强制落盘；上限 MAX_ENTRIES 条，超出丢最旧
 */

const MAX_ENTRIES = 1200;
const STORE_KEY = 'ysc-ai-logs-v1';
const FLUSH_MS = 800;

let entries = loadEntries();
let version = 0;
const listeners = new Set();
let flushTimer = null;

function loadEntries() {
  try {
    const arr = JSON.parse(window.localStorage.getItem(STORE_KEY));
    return Array.isArray(arr) ? arr.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function persist() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch {} // 存储满：日志只在内存里
  }, FLUSH_MS);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES))); } catch {}
    }
  });
}

function serialize(data) {
  if (data === undefined) return undefined;
  if (data instanceof Error) return { name: data.name, message: data.message, stack: data.stack };
  try {
    JSON.stringify(data);
    return data;
  } catch {
    return String(data);
  }
}

function write(tag, level, msg, data) {
  const entry = { ts: Date.now(), tag, level, msg: String(msg) };
  const d = serialize(data);
  if (d !== undefined) entry.data = d;
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  const con = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (d !== undefined) con(`[${tag}] ${entry.msg}`, d);
  else con(`[${tag}] ${entry.msg}`);
  persist();
  version += 1;
  for (const cb of listeners) {
    try { cb(); } catch {}
  }
}

/** 创建某模块的独立日志器：const log = createLogger('ai/webllm'); */
export function createLogger(tag) {
  return {
    debug: (msg, data) => write(tag, 'debug', msg, data),
    info: (msg, data) => write(tag, 'info', msg, data),
    warn: (msg, data) => write(tag, 'warn', msg, data),
    error: (msg, data) => write(tag, 'error', msg, data),
  };
}

/** 读取日志（tag/level/关键字过滤；不传返回全部）。返回快照副本。 */
export function getLogEntries({ tag, level, q } = {}) {
  let out = entries.slice();
  if (tag) out = out.filter((e) => e.tag === tag);
  if (level) out = out.filter((e) => e.level === level);
  if (q) out = out.filter((e) => e.msg.includes(q) || (e.data && JSON.stringify(e.data).includes(q)));
  return out;
}

/** 当前日志里出现过的全部模块 tag（新到旧），供筛选下拉。 */
export function logTags() {
  const seen = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (!seen.includes(entries[i].tag)) seen.push(entries[i].tag);
  }
  return seen;
}

export function subscribeLogs(cb) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function clearLogs() {
  entries = [];
  version += 1;
  try { window.localStorage.removeItem(STORE_KEY); } catch {}
  for (const cb of listeners) {
    try { cb(); } catch {}
  }
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** 导出为可粘贴的纯文本（发给他人 debug 用）。 */
export function exportLogsText() {
  return entries
    .map((e) => {
      const base = `${fmtTime(e.ts)} [${e.tag}] [${e.level.toUpperCase()}] ${e.msg}`;
      if (e.data === undefined) return base;
      let ds;
      try { ds = typeof e.data === 'string' ? e.data : JSON.stringify(e.data); } catch { ds = String(e.data); }
      return `${base} | ${ds}`;
    })
    .join('\n');
}

/** 供组件在渲染中触发重渲染的版本号。 */
export function logVersion() {
  return version;
}
