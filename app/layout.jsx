import 'katex/dist/katex.min.css';

import SiteHeader from '@/components/SiteHeader';
import KatexRuntime from '@/components/KatexRuntime';
import HighlightRuntime from '@/components/HighlightRuntime';
import LanguageSidebar from '@/components/language-sidebar';
import NavigationProgress from '@/components/NavigationProgress';
import OfflineIndicator from '@/components/OfflineIndicator';
import PwaRegister from '@/components/PwaRegister';
import ToastHost from '@/components/ui/ToastHost';
import { SettingsProvider } from '@/components/settings';
import GithubMark from '@/components/GithubMark';
import { getIndex } from '@/lib/data';
import { TEMPLATE_THEMES } from '@/lib/themes';
import { formatDateTime } from '@/lib/utils';

import './globals.css';

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://ac.yslsy.top'),
  title: {
    default: 'AC 题库 —— AtCoder / Codeforces / 牛客 中文题库',
    template: '%s · AC 题库',
  },
  description:
    'AtCoder、Codeforces 与牛客竞赛题目的自动抓取题库：完整题面、样例、难度分级，AI 中文翻译，随 CI 持续更新。',
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
  openGraph: {
    type: 'website',
    siteName: 'AC 题库',
    title: 'AC 题库 —— AtCoder / Codeforces / 牛客 中文题库',
    description:
      '1.6 万道竞赛题目：完整题面、样例、难度分级与 AI 中文翻译，内置浏览器编译器与离线题库。',
    images: ['/icons/icon-512.png'],
  },
  twitter: {
    card: 'summary',
    title: 'AC 题库 —— AtCoder / Codeforces / 牛客 中文题库',
    description: '竞赛题库 + AI 中文翻译 + 浏览器内编译器 + PWA 离线',
  },
};

export const viewport = {
  themeColor: '#16151a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/** 首帧前应用外观（settings.jsx 存的 theme）：
    内置主题：夜间=dark，日间=无类，墨水屏=eink；
    模板主题（lib/themes.js）：html[data-theme] + 注入 <style id="ac-theme-css">；
    自定义主题（stmt-custom-themes-v1）：同模板机制，CSS 从 localStorage 取；
    全局自定义 CSS：注入 <style id="ac-user-css">。
    默认（无记录/读不到）保持 SSR 的 dark，避免闪白。脚本由服务端用模板数据生成。 */
const TEMPLATE_CSS = JSON.stringify(Object.fromEntries(TEMPLATE_THEMES.map((t) => [t.id, t.css])));
const TEMPLATE_BASE = JSON.stringify(Object.fromEntries(TEMPLATE_THEMES.map((t) => [t.id, t.base])));
const THEME_BOOTSTRAP = `(function(){try{
var s=JSON.parse(localStorage.getItem('stmt-settings-v1')||'{}');
var t=s.theme||'dark';
var TPL=${TEMPLATE_CSS},BASE=${TEMPLATE_BASE};
var root=document.documentElement;
function style(id,css){var el=document.getElementById(id);if(!css){if(el)el.remove();return;}if(!el){el=document.createElement('style');el.id=id;document.head.appendChild(el);}el.textContent=css;}
var css='',base='dark';
if(t==='light')base='light';else if(t==='eink')base='eink';
else if(TPL[t]){css=TPL[t];base=BASE[t];}
else if(t!=='dark'){var list=JSON.parse(localStorage.getItem('stmt-custom-themes-v1')||'[]');for(var i=0;i<list.length;i++){if(list[i].id===t){css=list[i].css||'';base=list[i].base||'dark';break;}}}
root.classList.toggle('dark',base==='dark');
root.classList.toggle('eink',base==='eink');
if(css){root.setAttribute('data-theme',t);style('ac-theme-css',css);}else{root.removeAttribute('data-theme');style('ac-theme-css','');}
if(s.customCss)style('ac-user-css',String(s.customCss));
}catch(e){}})();`;

export default function RootLayout({ children }) {
  const idx = getIndex();
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <NavigationProgress />
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
                    AtCoder / Codeforces / 牛客比赛题目自动抓取 + AI 中文翻译，题面版权归原作者所有，本站仅作学习交流之用。
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
          <ToastHost />
          <PwaRegister />
        </SettingsProvider>
      </body>
    </html>
  );
}
