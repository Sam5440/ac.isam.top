import 'katex/dist/katex.min.css';

import SiteHeader from '@/components/SiteHeader';
import KatexRuntime from '@/components/KatexRuntime';
import HighlightRuntime from '@/components/HighlightRuntime';
import LanguageSidebar from '@/components/language-sidebar';
import OfflineIndicator from '@/components/OfflineIndicator';
import PwaRegister from '@/components/PwaRegister';
import { SettingsProvider } from '@/components/settings';
import GithubMark from '@/components/GithubMark';
import { getIndex } from '@/lib/data';
import { formatDateTime } from '@/lib/utils';

import './globals.css';

export const metadata = {
  title: {
    default: 'AC 题库 —— AtCoder / Codeforces 中文题库',
    template: '%s · AC 题库',
  },
  description:
    'AtCoder Beginner Contest 与 Codeforces 比赛题目的自动抓取题库：完整题面、样例、难度分级，AI 中文翻译，随 CI 持续更新。',
  applicationName: 'AC 题库',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'AC 题库' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport = {
  themeColor: '#16151a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/** 首帧前应用外观（settings.jsx 存的 theme）：夜间=dark，日间=无类，墨水屏=eink。
    默认（无记录/读不到）保持 SSR 的 dark，避免闪白。 */
const THEME_BOOTSTRAP = `(function(){try{var t=JSON.parse(localStorage.getItem('stmt-settings-v1')||'{}').theme;if(t==='light')document.documentElement.classList.remove('dark');else if(t==='eink'){document.documentElement.classList.remove('dark');document.documentElement.classList.add('eink');}}catch(e){}})();`;

export default function RootLayout({ children }) {
  const idx = getIndex();
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <KatexRuntime />
        <HighlightRuntime />
        <SettingsProvider>
          <div className="compiler-workspace">
            <div className="site-shell">
              <SiteHeader />
              <main className="mx-auto w-full max-w-6xl flex-1 px-4">{children}</main>
              <footer className="border-t">
                <div className="text-muted-foreground mx-auto w-full max-w-6xl space-y-2.5 px-4 py-6 text-xs">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
                    <a
                      href="https://github.com/Sam5440/ac.isam.top"
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                    >
                      <GithubMark className="size-3.5 shrink-0" />
                      本站仓库：Sam5440/ac.isam.top
                    </a>
                    <a
                      href="https://atcoder.jp"
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                    >
                      题目来源：AtCoder
                    </a>
                    <a
                      href="https://codeforces.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                    >
                      题目来源：Codeforces
                    </a>
                  </div>
                  <p>
                    ABC / Codeforces 比赛题目自动抓取 + AI 中文翻译，题面版权归原作者所有，本站仅作学习交流之用。
                  </p>
                  <p>
                    {idx?.generatedAt ? `数据更新于 ${formatDateTime(idx.generatedAt)} · ` : ''}
                    GitHub Actions 定时拉取与翻译 · 由 Vercel 驱动
                  </p>
                </div>
              </footer>
            </div>
            {/* 编译器独立工作区右列：CompilerDock 通过 portal 挂进来。
                没有编译器的页面保持 0 宽，不影响排版。 */}
            <div className="compiler-track" id="compiler-dock-root" />
          </div>
          <LanguageSidebar />
          <OfflineIndicator />
          <PwaRegister />
        </SettingsProvider>
      </body>
    </html>
  );
}
