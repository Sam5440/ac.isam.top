/**
 * 浏览器端运行时缓存层（Cache API）。
 *
 * 设置页「下载编译器」把运行时文件抓进 Cache API（compiler-runtime-v1），
 * 之后 worker / py-worker 一律缓存优先（离线可用、二次加载零网络）。
 * pyodide 文件键为完整 CDN URL；clang 系列键为同源路径 /compiler/<name>。
 * 存储时以显式 Content-Type 重建 Response（instantiateStreaming 需要
 * application/wasm；缓存命中路径不看网络响应头）。
 */

const CACHE_NAME = 'compiler-runtime-v1';
const META_KEY = 'ysc-runtime-meta-v1';

async function openCache() {
  if (typeof caches === 'undefined') throw new Error('当前环境不支持 Cache API');
  return caches.open(CACHE_NAME);
}

function readMeta() {
  try {
    return JSON.parse(window.localStorage.getItem(META_KEY)) || {};
  } catch {
    return {};
  }
}

function writeMeta(meta) {
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {}
}

/** 下载单个文件（流式进度），写入缓存。 */
export async function downloadFile(url, { onProgress, signal } = {}) {
  const cache = await openCache();
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`下载 ${url} 失败：HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const type = response.headers.get('content-type') || 'application/octet-stream';

  let buffer;
  if (response.body?.getReader && onProgress) {
    const reader = response.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
      onProgress({ url, got, total: total || got });
    }
    buffer = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) {
      buffer.set(c, off);
      off += c.byteLength;
    }
  } else {
    buffer = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ url, got: buffer.length, total: buffer.length });
  }

  await cache.put(url, new Response(buffer, { headers: { 'Content-Type': type } }));
  return buffer.length;
}

/** 同源可达性探测结果缓存。false 结果只信 60s（审查 2026-11-09 PWA-5）：
 *  旧实现无 TTL,断网期间的探测失败会永久冻结整个会话的「就绪」判定,
 *  网络恢复后也只能靠整页刷新救回。online 事件顺带清空缓存立即重探。 */
const PROBE_TTL = 60 * 1000;
const originProbe = new Map(); // url → { ok, at }
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => originProbe.clear());
}

async function originReachable(url) {
  const hit = originProbe.get(url);
  if (hit && (hit.ok || Date.now() - hit.at < PROBE_TTL)) return hit.ok;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    originProbe.set(url, { ok: r.ok, at: Date.now() });
    return r.ok;
  } catch {
    originProbe.set(url, { ok: false, at: Date.now() });
    return false;
  }
}

/**
 * 运行时是否可用：全部文件已进 Cache API（自身 compiler-runtime-v1，或
 * Service Worker 的 ac-runtime —— PWA 后台同步会把 /compiler/* 预取进去，
 * worker 的 fetch 也会被 SW cacheFirst 接住）；或为同源相对路径且源站可达
 * （CI 把 data/runtime 注入 deploy 后 /compiler/* 直接可取，worker 会走
 * 网络回退，无需先经设置页下载）。跨源 CDN 文件（Pyodide）必须已缓存。
 */
export async function hasRuntime(urls) {
  try {
    const cache = await openCache();
    for (const url of urls) {
      const hit = await cache.match(url);
      if (hit) continue;
      if (url.startsWith('/')) {
        // SW 缓存兜底：ac-runtime 里已预取的同源运行时文件，离线也可用
        if (await caches.match(url)) continue;
        if (!(await originReachable(url))) return false;
      } else {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function removeRuntime(urls, label = null) {
  const cache = await openCache();
  await Promise.all(urls.map((u) => cache.delete(u)));
  const meta = readMeta();
  for (const url of urls) delete meta.files?.[url];
  // 同步清理同名汇总条目（审查 2026-11-09 编译-25/PWA-18）：旧实现遗留
  // meta['cpp'] / meta['python:<id>'],runtimeStats 返回陈旧记账
  if (label && meta[label]) delete meta[label];
  writeMeta(meta);
}

/** 已缓存字节数（按 meta 记账；未记录的逐个探测太慢）。 */
export function runtimeStats() {
  return readMeta();
}

export function recordDownload(urls, sizes, label) {
  const meta = readMeta();
  meta.files = meta.files || {};
  urls.forEach((u, i) => {
    meta.files[u] = sizes[i] ?? 0;
  });
  meta[label] = { downloadedAt: new Date().toISOString(), total: sizes.reduce((a, b) => a + (b || 0), 0) };
  writeMeta(meta);
}

/** 主线程流式下载一组文件（顺序），汇总进度 + 汇报每个文件完成。
 *  已完整缓存的文件直接跳过（PWA-14:旧实现中途失败重试会把已完成的
 *  100+MB 从头重下）。 */
export async function downloadAll(items, { onFileStart, onProgress, onFileDone, signal } = {}) {
  const cache = await openCache();
  const sizes = [];
  for (const item of items) {
    onFileStart?.(item);
    const cached = await cache.match(item.url);
    if (cached) {
      const size = Number(cached.headers.get('content-length')) || (await cached.clone().arrayBuffer()).byteLength;
      sizes.push(size);
      onProgress?.(item, { url: item.url, got: size, total: size });
      onFileDone?.(item, size);
      continue;
    }
    const size = await downloadFile(item.url, {
      signal,
      onProgress: (p) => onProgress?.(item, p),
    });
    sizes.push(size);
    onFileDone?.(item, size);
  }
  return sizes;
}

export const RUNTIME_CACHE_NAME = CACHE_NAME;
