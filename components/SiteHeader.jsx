'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  History,
  ScrollText,
  SquareTerminal,
  Terminal,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingsGearButton, ThemeToggleButton } from '@/components/settings';
import GithubMark from '@/components/GithubMark';

const NAV = [
  { href: '/', label: '首页' },
  { href: '/problems', label: '题库' },
  { href: '/contests', label: '比赛' },
];

// 「更多」下拉：次级页面（3.1 起陆续上线）收纳于此，桌面与移动端同样可见
const MORE_NAV = [
  { href: '/ide', label: 'IDE 编程台', icon: SquareTerminal, desc: '多文件工作区与样例对拍' },
  { href: '/history', label: '浏览历史', icon: History, desc: '看过的题目与判题状态' },
  { href: '/ci', label: '抓取日志', icon: ScrollText, desc: '数据抓取运行记录' },
  { href: '/calendar', label: '比赛日历', icon: CalendarDays, desc: '近期比赛日程' },
];

export default function SiteHeader() {
  const pathname = usePathname();
  // 编译器只在题目页存在（题目页挂载 CompilerDock）；开合状态经
  // body.compiler-open 同步（CompilerDock 是唯一写方，这里只读）。
  const dockAvailable = pathname.startsWith('/problems/');
  const [dockOpen, setDockOpen] = useState(false);
  // 「更多」下拉（轻量 popover：useState + 点击外部/ Esc 关闭，无新依赖）
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  const moreActive = MORE_NAV.some((item) => pathname.startsWith(item.href));

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e) => {
      if (!moreRef.current?.contains(e.target)) setMoreOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setMoreOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  // 路由切换后收起下拉
  useEffect(() => setMoreOpen(false), [pathname]);

  useEffect(() => {
    if (!dockAvailable) return;
    const sync = () => setDockOpen(document.body.classList.contains('compiler-open'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [dockAvailable]);

  const toggleCompiler = () => {
    window.dispatchEvent(new CustomEvent('ysc-compiler-toggle'));
  };
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
        {/* min-w-0 + truncate:窄屏(≤430px)下品牌文案可收缩,避免右侧按钮簇被
            挤出视口(审查 2026-11-09 编译-14 的溢出根因之一) */}
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-md text-[13px] font-bold">
            AC
          </span>
          <span className="truncate text-[15px] font-semibold tracking-tight">
            AC 题库 <span className="text-muted-foreground">ac.isam.top</span>
          </span>
        </Link>
        <nav className="ml-2 hidden items-center gap-1 sm:flex">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Button key={item.href} asChild variant="ghost" size="sm">
                <Link href={item.href} prefetch={false} className={active ? 'text-foreground' : 'text-muted-foreground'}>
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>
        {/* 「更多」下拉：次级页面入口，移动端也可见（nav 本身 hidden sm:flex，
            下拉按钮不受其影响） */}
        <div ref={moreRef} className="relative ml-1">
          <Button
            variant="ghost"
            size="sm"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            className={moreActive ? 'text-foreground' : 'text-muted-foreground'}
            title="更多页面"
          >
            更多
            <ChevronDown className={`size-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
          </Button>
          {moreOpen && (
            <div
              role="menu"
              className="bg-popover text-popover-foreground absolute top-9 left-0 z-50 w-60 overflow-hidden rounded-lg border shadow-lg"
            >
              {MORE_NAV.map((item) => {
                const active = pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    prefetch={false}
                    className={`flex items-start gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-accent ${
                      active ? 'text-foreground font-medium' : ''
                    }`}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block leading-5">{item.label}</span>
                      <span className="text-muted-foreground block text-[11px] leading-4">{item.desc}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {dockAvailable && (
            <Button
              size="sm"
              className="compiler-launch"
              onClick={toggleCompiler}
              aria-expanded={dockOpen}
              aria-controls="compiler-panel"
              title={dockOpen ? '收起编译器工作区（Ctrl/⌘+J）' : '打开编译器工作区（Ctrl/⌘+J）'}
            >
              <Terminal className="size-3.5" />
              <span className="hidden min-[420px]:inline">编译器</span>
              <kbd className="hidden md:inline">⌘ J</kbd>
            </Button>
          )}
          <ThemeToggleButton />
          <SettingsGearButton />
          <Button asChild size="sm">
            <a
              href="https://github.com/Sam5440/ac.isam.top"
              target="_blank"
              rel="noreferrer"
              title="本站仓库：Sam5440/ac.isam.top"
              aria-label="GitHub 仓库"
            >
              <GithubMark className="size-3.5" />
              <span className="hidden min-[420px]:inline">GitHub</span>
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}
