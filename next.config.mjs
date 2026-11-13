/**
 * 构建号：随每次部署变化（Vercel 每次部署注入 VERCEL_GIT_COMMIT_SHA，
 * 数据 CI 与功能提交都会换 SHA）。经响应头 X-AC-Build 下发到所有响应，
 * Service Worker 据此识别「缓存 HTML 属于旧版应用」——见 lib/pwa/sw-source.js
 * 导航版本门卫；本地 next start 无上述环境变量时退化为固定 'dev'（SW 仅在
 * 生产注册，不影响本地开发）。
 */
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'dev';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Historical detail pages render on demand on Vercel. Keep their file data in the function.
  outputFileTracingIncludes: {
    '/problems/[platform]/[problemId]': ['./data/index.json', './data/*/contests.json', './data/*/problems/*.json'],
    '/contests/[platform]/[contestId]': ['./data/index.json', './data/*/contests.json', './data/*/problems/*.json'],
    '/api/problems': ['./data/index.json'],
    '/api/problems/[platform]/[problemId]': ['./data/index.json', './data/*/problems/*.json'],
    '/ci': ['./data/ci-log.json'],
  },
  outputFileTracingExcludes: {
    '*': ['./data/.*', './data/*/.*'],
  },
  async headers() {
    return [
      {
        // 跨域隔离：编译器「交互运行」依赖 SharedArrayBuffer（worker 内
        // Atomics.wait 阻塞读 stdin）。credentialless 允许带 CORS 的第三方
        // 请求（jsDelivr 等），不破坏 Pyodide/上游数据拉取。
        // X-AC-Build：构建号随部署变化，SW 导航门卫比对缓存 HTML 的版本，
        // 已知跨版本过期时改走网络，杜绝把旧版整套界面喂给用户。
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
          { key: 'X-AC-Build', value: BUILD_ID },
        ],
      },
    ];
  },
};

export default nextConfig;
