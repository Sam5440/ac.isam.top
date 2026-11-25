/**
 * 题面图片代理的纯校验逻辑（Route Handler 与单测共用）。
 *
 * PDF 导出要把题面图片画进 canvas：浏览器直接 fetch 第三方图床会被 CORS
 * 拦截，画布还会被污染，所以必须走同源代理。代理只允许题库实际用到的
 * 图片域名，不接收任意 URL；协议固定 https、默认端口、无用户信息。
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_PROXY_MAX_REDIRECTS = 3;

const EXACT_HOSTS = new Set([
  'img.atcoder.jp',
  'atcoder.jp',
  'espresso.codeforces.com',
  'codeforces.com',
  'uploadfiles.nowcoder.com',
  'japl.pl',
]);

const SUFFIX_HOSTS = ['.atcoder.jp', '.codeforces.com', '.nowcoder.com'];

export const IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/bmp',
]);

export function isAllowedImageHost(hostname) {
  const host = String(hostname ?? '').replace(/\.$/, '').toLowerCase();
  if (!host) return false;
  if (EXACT_HOSTS.has(host)) return true;
  return SUFFIX_HOSTS.some((suffix) => host.endsWith(suffix));
}

export function normalizeImageProxyUrl(raw) {
  let url;
  try {
    url = raw instanceof URL ? new URL(raw.toString()) : new URL(String(raw ?? ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;
  if (!isAllowedImageHost(url.hostname)) return null;
  url.hash = '';
  return url;
}

export function isAllowedImageContentType(value) {
  const type = String(value ?? '').split(';')[0].trim().toLowerCase();
  return IMAGE_CONTENT_TYPES.has(type);
}
