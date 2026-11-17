/**
 * 客户端错误归类（纯函数，供 app/error.jsx 选文案与恢复动作）。
 *
 * 为什么需要它（2026-11-17）：部署换版后，SW 缓存里可能留着旧构建的整页
 * HTML / RSC 载荷，浏览器侧抛出的消息因引擎而异，旧版正则一条都认不出来
 * ——于是明明是可自愈的换版问题，用户却看到通用文案 + 无效的 reset()。
 * 这里把「旧构建残留」「服务端渲染错误」两类识别集中维护，并有单测
 * （test/error-classify.test.mjs）。
 *
 * 归类结果：
 *  - 'stale'   ：旧构建脚本/chunk/模块表残留，刷新（或清页面缓存后刷新）必好；
 *  - 'server'  ：服务端渲染本页时就出错了（RSC 载荷里带回的错误），刷新重试；
 *  - 'unknown' ：真正的运行时异常，需要看错误原文与堆栈。
 */

/** 旧构建残留：脚本/chunk 取不到，或取回来的不是 JS（被 CDN 回了 HTML）。 */
const STALE_PATTERNS = [
  /Failed to fetch dynamically imported/i,
  /error loading dynamically imported module/i,
  /dynamically imported module/i,
  /Importing a module script failed/i,
  /Failed to load module script/i,
  /not a valid JavaScript MIME type/i,
  /MIME type of ["']?text\/html/i,
  /ChunkLoadError/i,
  /Loading chunk \d+ failed/i,
  // webpack 模块表错配（旧 HTML 引用的入口 chunk 已不在，工厂表里没有该 id）
  /Cannot read properties of undefined \(reading ['"]call['"]\)/i,
  // 旧 chunk 被 CDN 404 成 HTML：浏览器按 JS 解析时报语法错误
  /Unexpected token '</i,
  /Unexpected token "</i,
];

/** 服务端渲染错误：Next 把 RSC 渲染期异常转成这句通用文案发给客户端。 */
const SERVICE_RENDER_PATTERNS = [
  /An error occurred in the Server Components render/i,
  /Failed to find Server Component for module/i,
];

/**
 * @param {unknown} message 错误消息（通常是 error.message）
 * @returns {'stale'|'server'|'unknown'}
 */
export function classifyClientError(message) {
  const msg = typeof message === 'string' ? message : message == null ? '' : String(message);
  if (!msg) return 'unknown';
  if (STALE_PATTERNS.some((re) => re.test(msg))) return 'stale';
  if (SERVICE_RENDER_PATTERNS.some((re) => re.test(msg))) return 'server';
  return 'unknown';
}

export const PATTERNS = { stale: STALE_PATTERNS, server: SERVICE_RENDER_PATTERNS };
