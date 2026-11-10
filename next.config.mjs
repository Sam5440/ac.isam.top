/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Historical detail pages render on demand on Vercel. Keep their file data in the function.
  outputFileTracingIncludes: {
    '/problems/[platform]/[problemId]': ['./data/index.json', './data/*/contests.json', './data/*/problems/*.json'],
    '/contests/[platform]/[contestId]': ['./data/index.json', './data/*/contests.json', './data/*/problems/*.json'],
    '/api/problems': ['./data/index.json'],
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
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
};

export default nextConfig;
