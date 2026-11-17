/**
 * 构建号 —— 单一事实来源（2026-11-17）。
 *
 * Vercel 每次部署注入 commit SHA（数据 CI 每小时一次，代码提交不定时），
 * 本地无该环境变量时退化为固定 'dev'。四个消费者必须拿到同一个值，
 * 否则「页面属于哪一版」的判定会互相矛盾：
 *
 *  1. next.config.mjs          → 全站响应头 X-AC-Build（SW 门卫的数据源）
 *  2. app/ac-build.json/route  → SW 探测端点（缓存 HTML 是否过期）
 *  3. app/layout.jsx           → <meta name="ac-build">（错误边界自愈的判据）
 *  4. app/sw.js/route          → SW 版本号后缀（触发浏览器更新 SW 字节）
 *
 * 只读 process.env、无副作用，可被 next.config（构建期 Node）与 RSC 复用。
 */

export function resolveBuildId(env = process.env) {
  return env.VERCEL_GIT_COMMIT_SHA || env.VERCEL_DEPLOYMENT_ID || 'dev';
}

export const BUILD_ID = resolveBuildId();
