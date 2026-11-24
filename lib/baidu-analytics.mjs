/**
 * 百度统计（hm.js）的唯一接入点。
 * 只放「公开的站点标识」与「纯函数」，服务端 / 客户端 / 单测都能直接 import。
 */

/** 站点标识（公开可见，不是密钥）。换站点只改这一行。 */
export const BAIDU_HM_SRC = 'https://hm.baidu.com/hm.js?e95fdee4b21eea052338f8394ce084ee';

/**
 * 上报给 `_hmt.push(['_trackPageview', ...])` 的路径：pathname + search，**不含 hash**。
 * 站内 hash 可能是一整份分享载荷（如 `#data=` 里的模拟赛题单，默认还是 Base64），
 * 原样上报既没有分析价值，也可能超出统计系统的字段长度。
 */
export function trackPath(pathname, search) {
  const path = pathname || '/';
  const query = String(search ?? '').replace(/^\?/, '');
  return query ? path + '?' + query : path;
}