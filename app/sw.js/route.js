import { SW_SOURCE } from '@/lib/pwa/sw-source';

export const dynamic = 'force-static';

/**
 * /sw.js —— 构建期把 SW 源码注入版本号后预渲染输出。版本 = 构建时间 + 部署
 * commit，随每次构建变化 → 浏览器在导航时检测到 SW 字节更新 → 后台换新。
 * 缓存桶名固定不随版本换（见 sw-source.js），换 SW 不会清掉已离线的题库。
 */
export async function GET() {
  const version = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'}`;
  const source = SW_SOURCE.replace('__AC_SW_VERSION__', JSON.stringify(version));
  return new Response(source, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
