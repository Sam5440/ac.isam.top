/**
 * Service Worker 源码。以字符串形式导出，由 app/sw.js/route.js 在构建期注入
 * 版本号后作为 /sw.js 预渲染输出（文件内容随构建变化 → 浏览器自动检测更新）。
 *
 * 缓存桶名固定（不随部署换名），内容新鲜度靠 SWR 后台刷新维持：
 * 每次部署后 SW 文件字节变化 → 新 SW install/activate → 不清缓存 →
 * 用户首次访问仍命中旧 HTML（秒开），后台 revalidate 拉新，下次导航即新版；
 * 新 HTML 引用的新 chunk（哈希文件名）在运行时自动入缓存。旧 chunk 留在缓存
 * 里供仍被旧页引用时使用，超出上限后按插入序（最旧优先）淘汰。
 *
 * 策略表：
 *  - 导航请求（HTML 页面）      stale-while-revalidate（PAGES，SHELL 首访迁移）
 *  - RSC（Next 客户端路由）     SWR；离线未命中 → 307 回退整页导航走已缓存 HTML
 *  - /_next/static/*、/_next/image   cache-first（哈希文件名不可变）
 *  - /compiler*（clang/lld WASM 运行时 + bridge/worker）cache-first：
 *    首次在线使用后即离线可用
 *  - 其余同源 GET               network-first → 缓存兜底
 *  - /api/*                     直连（MT/AI 代理必须走网络）
 *  - 牛客图床 uploadfiles.nowcoder.com  cache-first（opaque，上限 600 条）
 *  - /offline-manifest.json     仅 SW 自身 fetch（不走 fetch handler）
 *
 * 后台同步 syncOffline(limit)：拉 /offline-manifest.json（构建期生成的最近
 * 100 场比赛清单），预取比赛详情页 + 全部题目页（并发 4，已缓存跳过），再从
 * 已缓存页面 HTML 收割 /_next/static 资源引用补进 ASSETS，保证页面离线可完整
 * 渲染（KaTeX/高亮/字体/Monaco chunk 全部同源自托管）。进度经 postMessage
 * 广播（OFFLINE_SYNC），设置面板「离线缓存」区块消费。
 *
 * 注意：SW 代码必须避免模板字符串（本文件是外层模板字面量）。
 */

export const SW_SOURCE = `/**
 * AC 题库 Service Worker（构建期生成，勿手改——源码在 lib/pwa/sw-source.js）
 */
const VERSION = __AC_SW_VERSION__;

const SHELL = 'ac-shell';
const PAGES = 'ac-pages';
const ASSETS = 'ac-assets';
const RUNTIME = 'ac-runtime';
const IMGS = 'ac-imgs';
const ALL = [SHELL, PAGES, ASSETS, RUNTIME, IMGS];
const META_KEY = '/__offline_meta__';
const PAGE_CAP = 3500;
const ASSET_CAP = 800;
const IMG_CAP = 600;
const SYNC_CONCURRENCY = 4;
/** 浏览器编译器同源运行时（clang/lld WASM + sysroot + worker 桥），
    随离线同步一并预取，使编译器首次同步后即可离线使用（约 150MB，
    已缓存自动跳过；Pyodide 为跨源 CDN，仍需在设置里手动下载）。 */
const COMPILER_FILES = [
  '/compiler/clang22',
  '/compiler/clang22-noeh',
  '/compiler/lld22',
  '/compiler/lld22-noeh',
  '/compiler/sysroot22.tar',
  '/compiler/memfs',
  '/compiler-js/bridge.js',
  '/compiler-js/cpp-worker.js',
  '/compiler-js/py-worker.js',
  '/compiler-js/shared.js',
];

/** AbortSignal.timeout 的全浏览器降级（旧内核无 AbortSignal.timeout 会直接
    TypeError,整个离线同步走 error 分支 —— 审查 PWA-19）。 */
function timeoutSignal(ms) {
  var ctrl = new AbortController();
  setTimeout(function () { ctrl.abort(new Error('timeout')); }, ms);
  return ctrl.signal;
}

/** 用户/页面请求中止当前同步（clearAll 前先停同步,避免删完又被写回）。 */
var syncAbortCtrl = null;

function broadcast(state) {
  self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage(Object.assign({ type: 'OFFLINE_SYNC' }, state)); });
  });
}

/** 统一入库：去掉 Vary 后按 URL 字符串为键存储，匹配时不再受请求头影响。 */
function putNormalized(cache, url, res) {
  var h = new Headers(res.headers);
  h.delete('Vary');
  var body = res.ok || res.type === 'default' ? res.body : null;
  return cache.put(new Request(url, { method: 'GET' }), new Response(body, { status: res.status, statusText: res.statusText, headers: h }));
}

async function revalidate(req) {
  try {
    var res = await fetch(req, { cache: 'no-store' });
    if (res && res.status === 200) await putNormalized(await caches.open(PAGES), req.url, res);
  } catch (e) { /* 离线时静默 */ }
}

function maybePrune(cache, cap, keepPaths) {
  if (Math.random() > 0.05) return Promise.resolve();
  return pruneCache(cache, cap, keepPaths);
}

/** 资源淘汰保护:已缓存页面 HTML 仍引用的 /_next/static 资源不得被淘汰,
    否则离线刷新旧页时 chunk 504 → hydration 失败 → 白屏。引用集由
    harvestAssets 在每次同步后写入 '/__asset_refs__'。 */
function assetKeepPaths() {
  return caches.match(META_KEY + 'asset_refs__').then(function (r) {
    return r ? r.json() : [];
  }).catch(function () { return []; });
}

function pruneAssets(cache, cap) {
  if (Math.random() > 0.05) return Promise.resolve();
  return assetKeepPaths().then(function (keep) { return pruneCache(cache, cap, keep); });
}

/** 淘汰候选排序（PWA-3/PWA-8 修复）：
 *  1. keepPaths 里的条目按「前缀」保护（META_KEY 家族含 asset_refs/debug 等
 *     meta 条目,旧实现只精确匹配 META_KEY 自身,保护条目自己反而会被淘汰,
 *     v1.3 修掉的离线白屏问题会因此复发）;
 *  2. RSC 载荷（URL 含 _rsc=）最先逐出 —— 它是导航副产物且随来源哈希变化,
 *     与离线题库页共享 PAGE_CAP 会把最早同步的比赛页挤出去;
 *  3. 其余按插入序（最旧优先）。 */
async function pruneCache(cache, cap, keepPaths) {
  var keep = new Set(keepPaths || []);
  var keys = await cache.keys();
  if (keys.length <= cap) return;
  var isKept = function (u) {
    if (keep.has(u)) return true;
    for (var i = 0; i < keep.length; i++) {
      if (typeof keep[i] === 'string' && u.indexOf(keep[i]) === 0) return true;
    }
    return false;
  };
  var evictable = [];
  var rsc = [];
  for (var i = 0; i < keys.length; i++) {
    var u = keys[i].url;
    if (isKept(u)) continue;
    if (u.indexOf('_rsc=') !== -1) rsc.push(keys[i]);
    else evictable.push(keys[i]);
  }
  var ordered = rsc.concat(evictable);
  var excess = keys.length - cap;
  var removed = 0;
  for (var j = 0; j < ordered.length && removed < excess; j++) {
    await cache.delete(ordered[j]);
    removed++;
  }
}

function offlineFallback() {
  var btn = 'display:inline-block;color:#5b8dff;text-decoration:none;border:1px solid #303038;'
    + 'border-radius:.5rem;padding:.5rem 1rem;margin:.15rem';
  var html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>离线 · AC 题库</title>'
    + '<body style="margin:0;background:#16151a;color:#d4d4d8;font:15px/1.7 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">'
    + '<div style="max-width:26rem;padding:2rem;text-align:center">'
    + '<p style="font-size:2rem;margin:0 0 .5rem">📴</p>'
    + '<h1 style="font-size:1.1rem;margin:0 0 .5rem">当前离线</h1>'
    + '<p style="color:#9ca3af;margin:0 0 1.25rem">此页面尚未缓存。已缓存的最近 100 场比赛与题目仍可离线浏览；恢复联网后将自动打开本页。</p>'
    + '<div>'
    + '<a href="/" style="' + btn + '">🏠 返回首页</a>'
    + '<a href="/problems" style="' + btn + '">📚 题库</a>'
    + '<a href="/contests" style="' + btn + '">🏆 比赛</a>'
    + '</div>'
    + '<p id="st" style="color:#6b7280;margin:1rem 0 0;font-size:12px">等待网络恢复…（恢复后自动刷新）</p>'
    + '<script>window.addEventListener("online",function(){var s=document.getElementById("st");if(s)s.textContent="已恢复联网，正在刷新…";setTimeout(function(){location.reload()},400)});</script>'
    + '</div></body>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* ---------------- strategies ---------------- */

/** 导航（HTML）：SWR。SHELL 命中先迁移到 PAGES，之后统一走 PAGES 的新鲜副本。
 *  revalidate 挂到 event.waitUntil（PWA-10）：SW 提前回收时后台刷新不被截断。 */
async function navigationHandler(req, event) {
  var pages = await caches.open(PAGES);
  var cached = await pages.match(req.url);
  if (!cached) {
    var shell = await caches.open(SHELL);
    cached = await shell.match(req.url);
    if (cached) pages.put(new Request(req.url), cached.clone()).catch(function () {});
  }
  if (cached) {
    try { event.waitUntil(revalidate(req)); } catch (e) { revalidate(req); }
    return cached;
  }
  try {
    var res = await fetch(req);
    if (res && res.status === 200) await putNormalized(pages, req.url, res.clone());
    return res;
  } catch (e) {
    return offlineFallback();
  }
}

/** RSC（客户端路由载荷）：SWR；离线未命中 → 307 回退整页导航（走缓存 HTML）。 */
async function rscHandler(req, event) {
  var cached = await caches.match(req.url);
  if (cached) {
    try { event.waitUntil(revalidate(req)); } catch (e) { revalidate(req); }
    return cached;
  }
  try {
    var res = await fetch(req);
    if (res && res.status === 200) await putNormalized(await caches.open(PAGES), req.url, res.clone());
    return res;
  } catch (e) {
    // 离线未命中:一律 307 回退整页导航。已缓存页命中缓存 HTML;未缓存页落到
    // offlineFallback(带「返回首页/题库/比赛」)。绝不能把 503 HTML 当 RSC
    // flight 载荷返回——Next 客户端路由会解析失败,白屏报错且无任何出口。
    var u = new URL(req.url);
    var plain = u.origin + u.pathname;
    // 307 已剥掉 _rsc 查询;若此刻已在裸路径上,再 307 就是自指死循环
    // (实测 fetch 最终 Failed to fetch)——此时直接给离线引导页,
    // Next 收到非 flight 响应会转整页导航,落到同一张引导页。
    if (req.url === plain) return offlineFallback();
    return Response.redirect(plain, 307);
  }
}

async function cacheFirst(req, name, cap) {
  var cached = await caches.match(req.url);
  if (cached) return cached;
  try {
    var res = await fetch(req);
    if (res && res.status === 200) {
      var cache = await caches.open(name);
      putNormalized(cache, req.url, res.clone()).then(function () {
        return name === ASSETS ? pruneAssets(cache, cap) : maybePrune(cache, cap);
      }).catch(function () {});
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504 });
  }
}

async function imgCacheFirst(req) {
  var cached = await caches.match(req.url);
  if (cached) return cached;
  try {
    var res = await fetch(req, { mode: 'no-cors' });
    if (res && (res.type === 'opaque' || res.ok)) {
      var cache = await caches.open(IMGS);
      cache.put(new Request(req.url, { method: 'GET' }), res.clone()).then(function () { maybePrune(cache, IMG_CAP); }).catch(function () {});
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504 });
  }
}

async function networkFirst(req) {
  try {
    return await fetch(req);
  } catch (e) {
    var cached = await caches.match(req.url);
    if (cached) return cached;
    return new Response('', { status: 504 });
  }
}

/* ---------------- offline sync ---------------- */

var syncing = false;

/** 调试埋点：SW 自身状态写入缓存，页面端可读（'/__sync_debug__'）。 */
async function markDbg(obj) {
  try {
    var c = await caches.open(PAGES);
    await c.put(META_KEY + 'debug__', new Response(JSON.stringify(Object.assign({ t: Date.now() }, obj)), { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) { /* 忽略 */ }
}

async function syncOffline(limit) {
  if (syncing) { markDbg({ phase: 'skip-mutex' }); return; }
  syncing = true;
  syncAbortCtrl = new AbortController();
  var abortSignal = syncAbortCtrl.signal;
  var state = { phase: 'manifest', done: 0, total: 0, added: 0 };
  try {
    await markDbg({ phase: 'start', limit: limit });
    var mres = await fetch('/offline-manifest.json', { cache: 'no-store', signal: timeoutSignal(20000) });
    if (!mres.ok) throw new Error('manifest HTTP ' + mres.status);
    var manifest = await mres.json();
    await markDbg({ phase: 'manifest-ok', contests: (manifest.contests || []).length });
    var pages = await caches.open(PAGES);
    var urls = ['/', '/problems', '/contests'];
    var contests = (manifest.contests || []).slice(0, limit || 100);
    contests.forEach(function (c) {
      urls.push(c.page);
      (c.problems || []).forEach(function (p) { urls.push(p.page); });
    });
    state.phase = 'pages';
    state.total = urls.length;
    broadcast(state);
    await markDbg({ phase: 'pages-start', total: state.total });
    var queue = urls.slice();
    var worker = async function () {
      while (queue.length && !abortSignal.aborted) {
        var u = queue.shift();
        state.done++;
        try {
          if (!(await pages.match(u))) {
            var r = await fetch(u, { credentials: 'same-origin', signal: timeoutSignal(20000) });
            if (r && r.status === 200) { await putNormalized(pages, u, r); state.added++; }
          }
        } catch (e) { /* 单页失败跳过 */ }
        if (state.done % 20 === 0 || !queue.length) broadcast(state);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await markDbg({ phase: 'pages-done', added: state.added, done: state.done });
    await harvestAssets();
    await pruneCache(pages, PAGE_CAP, [META_KEY]);

    var meta = {
      lastSyncAt: Date.now(),
      contests: contests.length,
      // 只统计真实页面 URL（PWA-17:RSC 变体与查询变体不再虚增「已离线 N 页」）
      pages: (await pages.keys()).filter(function (k) {
        return k.url.indexOf(META_KEY) !== 0 && k.url.indexOf('_rsc=') === -1;
      }).length,
      total: state.total,
      added: state.added,
      version: VERSION,
    };
    await pages.put(META_KEY, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    state.phase = 'done';
    state.meta = meta;
    broadcast(state);
  } catch (e) {
    state.phase = abortSignal.aborted ? 'aborted' : 'error';
    state.error = String((e && e.message) || e);
    broadcast(state);
    await markDbg({ phase: state.phase, error: state.error });
  } finally {
    syncing = false;
    syncAbortCtrl = null;
  }
}

/** Download the large compiler runtime only after an explicit settings action. */
async function syncCompiler() {
  if (syncing) { markDbg({ phase: 'skip-compiler-busy' }); return; }
  syncing = true;
  syncAbortCtrl = new AbortController();
  var signal = syncAbortCtrl.signal;
  var state = { phase: 'compiler', done: 0, total: COMPILER_FILES.length, added: 0 };
  broadcast(state);
  try {
    var queue = COMPILER_FILES.slice();
    var worker = async function () {
      while (queue.length && !signal.aborted) {
        var url = queue.shift();
        state.done++;
        try {
          if (!(await caches.match(url))) {
            var response = await fetch(url, {
              credentials: 'same-origin',
              signal: timeoutSignal(120000),
            });
            if (response && response.status === 200) {
              await putNormalized(await caches.open(RUNTIME), url, response);
              state.added++;
            }
          }
        } catch (e) { /* 单文件失败跳过，下次主动同步重试 */ }
        broadcast(state);
      }
    };
    await Promise.all([worker(), worker()]);
    if (signal.aborted) {
      state.phase = 'aborted';
    } else {
      state.phase = 'done';
      state.meta = { compilerFiles: COMPILER_FILES.length, added: state.added, lastCompilerSyncAt: Date.now() };
    }
    broadcast(state);
  } finally {
    syncing = false;
    syncAbortCtrl = null;
  }
}

/** 从已缓存的页面 HTML 里收割 /_next/static 资源引用（chunk/字体/KaTeX 样式），
    缺的补进 ASSETS —— 这是离线页面能完整渲染（KaTeX/高亮/Monaco）的关键。
    扫描窗口按同步轮转（PWA-4：固定前 120 页会让「已同步但从未访问」的深处
    页面永远分不到资源;每轮偏移 120 页,多轮同步后覆盖全部清单页）。 */
var HARVEST_WINDOW = 120;
async function harvestAssets() {
  var pages = await caches.open(PAGES);
  var assets = await caches.open(ASSETS);
  var all = (await pages.keys()).map(function (k) { return k.url; })
    .filter(function (u) { return u.indexOf(META_KEY) !== 0 && u.indexOf('_rsc=') === -1; });
  if (!all.length) return;
  var prev = 0;
  try {
    var cr = await pages.match(META_KEY + 'harvest__');
    if (cr) prev = Number((await cr.json()).offset || 0) || 0;
  } catch (e) { /* 忽略 */ }
  var start = prev % all.length;
  var windowUrls = [];
  for (var w = 0; w < Math.min(HARVEST_WINDOW, all.length); w++) {
    windowUrls.push(all[(start + w) % all.length]);
  }
  pages.put(META_KEY + 'harvest__', new Response(JSON.stringify({ offset: start + windowUrls.length }),
    { headers: { 'Content-Type': 'application/json' } })).catch(function () {});
  var found = new Set();
  var re = /\\/_next\\/(?:static|image)\\/[A-Za-z0-9._\\-/%]+/g;
  for (var i = 0; i < windowUrls.length; i++) {
    try {
      var r = await pages.match(windowUrls[i]);
      if (!r) continue;
      var html = await r.text();
      var m;
      while ((m = re.exec(html))) found.add(m[0]);
    } catch (e) { /* 跳过 */ }
  }
  var list = Array.from(found).slice(0, ASSET_CAP);
  // 引用集持久化（供 pruneAssets 淘汰保护用；上限放宽到 2000）
  pages.put(META_KEY + 'asset_refs__', new Response(JSON.stringify(Array.from(found).slice(0, 2000)),
    { headers: { 'Content-Type': 'application/json' } })).catch(function () {});
  var queue = list.slice();
  var worker = async function () {
    while (queue.length) {
      var u = queue.shift();
      try {
        if (!(await assets.match(u))) {
          var r2 = await fetch(u, { credentials: 'same-origin' });
          if (r2 && r2.status === 200) await putNormalized(assets, u, r2);
        }
      } catch (e) { /* 跳过 */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var shell = await caches.open(SHELL);
    await Promise.allSettled(['/'].map(async function (u) {
      var res = await fetch(u, { credentials: 'same-origin', cache: 'no-store' });
      if (res && res.status === 200) await putNormalized(shell, u, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keep = new Set(ALL);
    // 编译器运行时是用户在设置页手动下载的（Pyodide 200MB / clang 145MB）,
    // 不在 ac-* 桶里 —— 不保留的话每次部署 SW 字节变化 → activate 必然把它
    // 删掉,与设置页「已下载的 Pyodide 缓存不受影响」的承诺直接矛盾（P1-9）
    keep.add('compiler-runtime-v1');
    var names = await caches.keys();
    await Promise.all(names.map(function (n) { return keep.has(n) ? null : caches.delete(n); }));
    await self.clients.claim();
    // 必须 await：waitUntil 结束后 SW 会被立即回收，脱离 waitUntil 的
    // 同步任务会在中途被杀（实测 616 页 0 入库）。await 后整个同步都在
    // extendable event 生命周期内，SW 不会被杀；后续 SYNC 消息触发时
    // syncing 互斥仍然成立（同步真在跑才跳过）。
  })());
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'SYNC_OFFLINE') {
    // 个别环境无 ExtendableMessageEvent.waitUntil：兜底直接跑（活跃浏览期间
    // fetch 事件本身会续命），正常环境用 waitUntil 保证同步期间 SW 不被回收。
    try {
      event.waitUntil(syncOffline(data.limit || 100));
    } catch (e) {
      syncOffline(data.limit || 100);
    }
  } else if (data.type === 'SYNC_COMPILER') {
    try {
      event.waitUntil(syncCompiler());
    } catch (e) {
      syncCompiler();
    }
  } else if (data.type === 'ABORT_SYNC') {
    // 页面「清除离线缓存」前先停同步（PWA-7）,避免删完又被写回
    try { syncAbortCtrl && syncAbortCtrl.abort(); } catch (e) { /* 忽略 */ }
  }
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (/^https?:\\/\\/uploadfiles\\.nowcoder\\.com\\//.test(req.url)) event.respondWith(imgCacheFirst(req));
    return;
  }
  if (url.pathname === '/sw.js') return;
  if (url.pathname.indexOf('/api/') === 0) return;
  if (req.mode === 'navigate') { event.respondWith(navigationHandler(req, event)); return; }
  if (req.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) { event.respondWith(rscHandler(req, event)); return; }
  if (url.pathname.indexOf('/compiler') === 0) { event.respondWith(cacheFirst(req, RUNTIME, 400)); return; }
  if (url.pathname.indexOf('/_next/static/') === 0 || url.pathname.indexOf('/_next/image') === 0) {
    event.respondWith(cacheFirst(req, ASSETS, ASSET_CAP));
    return;
  }
  // /offline-manifest.json 无独立分支（PWA-12:全站只有 SW 自身 fetch 该文件,
  // 而 SW 全局 fetch 不触发自身 fetch handler —— 旧 cacheFirst 分支是死代码,
  // 与表头「SWR」注释也不符）;落 networkFirst 对页面侧访问也无害。
  event.respondWith(networkFirst(req));
});
`;
