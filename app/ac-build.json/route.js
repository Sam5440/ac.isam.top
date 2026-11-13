export const dynamic = 'force-static';

/**
 * /ac-build.json —— SW 导航版本门卫的数据源：返回当前部署的构建号（几百字节）。
 * 构建期预渲染，字节随部署变化；max-age=0 保证 SW 每次探测都拿到最新值。
 * 与全站响应头 X-AC-Build（next.config.mjs）同源同值，SW 优先读响应头。
 */
export async function GET() {
  const build = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'dev';
  return Response.json(
    { build },
    { headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' } },
  );
}
