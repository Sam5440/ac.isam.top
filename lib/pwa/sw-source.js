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
 *  - /offline-manifest.json     SWR
 *  - 其余同源 GET               network-first → 缓存兜底
 *  - /api/*                     直连（MT/AI 代理必须走网络）
 *  - 牛客图床 uploadfiles.nowcoder.com  cache-first（opaque，上限 600 条）
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
  '/compiler-js/shared.js',
];

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

async function pruneCache(cache, cap, keepPaths) {
  var keep = new Set(keepPaths || []);
  var keys = await cache.keys();
  if (keys.length <= cap) return;
  var excess = keys.length - cap;
  var removed = 0;
  for (var i = 0; i < keys.length && removed < excess; i++) {
    if (keep.has(keys[i].url)) continue;
    await cache.delete(keys[i]);
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

/** 导航（HTML）：SWR。SHELL 命中先迁移到 PAGES，之后统一走 PAGES 的新鲜副本。 */
async function navigationHandler(req) {
  var pages = await caches.open(PAGES);
  var cached = await pages.match(req.url);
  if (!cached) {
    var shell = await caches.open(SHELL);
    cached = await shell.match(req.url);
    if (cached) pages.put(new Request(req.url), cached.clone()).catch(function () {});
  }
  if (cached) {
    revalidate(req);
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
async function rscHandler(req) {
  var cached = await caches.match(req.url);
  if (cached) {
    revalidate(req);
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
  var state = { phase: 'manifest', done: 0, total: 0, added: 0 };
  try {
    await markDbg({ phase: 'start', limit: limit });
    var mres = await fetch('/offline-manifest.json', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
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
      while (queue.length) {
        var u = queue.shift();
        state.done++;
        try {
          if (!(await pages.match(u))) {
            var r = await fetch(u, { credentials: 'same-origin', signal: AbortSignal.timeout(20000) });
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

    // 编译器运行时预取（并发 2 —— 单文件 20-40MB，避免挤占带宽）
    state.phase = 'compiler';
    state.done = 0;
    state.total = COMPILER_FILES.length;
    broadcast(state);
    await markDbg({ phase: 'compiler-start', total: state.total });
    var cQueue = COMPILER_FILES.slice();
    var cWorker = async function () {
      while (cQueue.length) {
        var cu = cQueue.shift();
        state.done++;
        try {
          if (!(await caches.match(cu))) {
            var cr = await fetch(cu, { credentials: 'same-origin', signal: AbortSignal.timeout(120000) });
            if (cr && (cr.status === 200 || cr.type === 'opaque')) {
              var rc = await caches.open(RUNTIME);
              await putNormalized(rc, cu, cr);
            }
          }
        } catch (e) { /* 单文件失败跳过，下次同步重试 */ }
        broadcast(state);
      }
    };
    await Promise.all([cWorker(), cWorker()]);
    var meta = {
      lastSyncAt: Date.now(),
      contests: contests.length,
      pages: (await pages.keys()).filter(function (k) { return k.url.indexOf(META_KEY) !== 0; }).length,
      total: state.total,
      added: state.added,
      version: VERSION,
    };
    await pages.put(META_KEY, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    state.phase = 'done';
    state.meta = meta;
    broadcast(state);
  } catch (e) {
    state.phase = 'error';
    state.error = String((e && e.message) || e);
    broadcast(state);
    await markDbg({ phase: 'error', error: state.error, at: state.phase });
  } finally {
    syncing = false;
  }
}

/** 从已缓存的页面 HTML 里收割 /_next/static 资源引用（chunk/字体/KaTeX 样式），
    缺的补进 ASSETS —— 这是离线页面能完整渲染（KaTeX/高亮/Monaco）的关键。 */
async function harvestAssets() {
  var pages = await caches.open(PAGES);
  var assets = await caches.open(ASSETS);
  var keys = (await pages.keys()).slice(0, 120);
  var found = new Set();
  var re = /\\/_next\\/(?:static|image)\\/[A-Za-z0-9._\\-/%]+/g;
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].url === META_KEY) continue;
    try {
      var r = await pages.match(keys[i]);
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
    await Promise.allSettled(['/', '/problems', '/contests'].map(async function (u) {
      var res = await fetch(u, { credentials: 'same-origin', cache: 'no-store' });
      if (res && res.status === 200) await putNormalized(shell, u, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keep = new Set(ALL);
    var names = await caches.keys();
    await Promise.all(names.map(function (n) { return keep.has(n) ? null : caches.delete(n); }));
    await self.clients.claim();
    // 必须 await：waitUntil 结束后 SW 会被立即回收，脱离 waitUntil 的
    // 同步任务会在中途被杀（实测 616 页 0 入库）。await 后整个同步都在
    // extendable event 生命周期内，SW 不会被杀；后续 SYNC 消息触发时
    // syncing 互斥仍然成立（同步真在跑才跳过）。
    await syncOffline(100);
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
  if (req.mode === 'navigate') { event.respondWith(navigationHandler(req)); return; }
  if (req.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) { event.respondWith(rscHandler(req)); return; }
  if (url.pathname.indexOf('/compiler') === 0) { event.respondWith(cacheFirst(req, RUNTIME, 400)); return; }
  if (url.pathname.indexOf('/_next/static/') === 0 || url.pathname.indexOf('/_next/image') === 0) {
    event.respondWith(cacheFirst(req, ASSETS, ASSET_CAP));
    return;
  }
  if (url.pathname === '/offline-manifest.json') { event.respondWith(cacheFirst(req, PAGES, PAGE_CAP)); return; }
  event.respondWith(networkFirst(req));
});
`;
