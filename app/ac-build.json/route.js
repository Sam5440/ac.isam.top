import { BUILD_ID } from '@/lib/build-id.mjs';

export const dynamic = 'force-static';

/**
 * /ac-build.json —— SW 导航版本门卫与错误边界自愈的数据源：返回当前部署的
 * 构建号（几百字节）。构建期预渲染，字节随部署变化；max-age=0 保证每次探测
 * 都拿到最新值。与全站响应头 X-AC-Build（next.config.mjs）、页面里的
 * <meta name="ac-build">（app/layout.jsx）同源同值（lib/build-id.mjs）。
 */
export async function GET() {
  return Response.json(
    { build: BUILD_ID },
    { headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' } },
  );
}
