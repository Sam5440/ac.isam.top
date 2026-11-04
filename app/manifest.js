export default function manifest() {
  return {
    name: 'AC 题库 —— AtCoder / Codeforces 中文题库',
    short_name: 'AC 题库',
    description:
      'AtCoder / Codeforces / 牛客竞赛题库：完整题面、样例、AI 中文翻译、在线编译器，支持离线浏览最近 100 场比赛。',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'zh-CN',
    dir: 'ltr',
    background_color: '#16151a',
    theme_color: '#16151a',
    categories: ['education', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: '题库', url: '/problems', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: '比赛', url: '/contests', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
