'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useEffect, useRef, useState } from 'react';
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

const GITHUB_URL = 'https://github.com/Sam5440/ac.isam.top';

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

  // 顶栏自适应压缩：按优先级逐级收缩，直到整行放得下（每级一次同步重排，绘制前完成）。
  // 顺序：⌘J 提示 → 域名 ac.isam.top → 「AC 题库」→「编译器」文字（留图标）
  // →「GitHub」文字 → GitHub 图标（收进「更多」）→ AC 图标
  // → 最后导航入口从右往左依次收进「更多」。
  const ALL_NAV = [...NAV, ...MORE_NAV];
  const STEPS = ['kbd', 'domain', 'name', 'compilerLabel', 'ghText', 'ghIcon', 'acIcon', ...ALL_NAV.map(() => 'fold')];
  const [level, setLevel] = useState(0);
  const applied = STEPS.slice(0, level);
  const has = (k) => applied.includes(k);
  const foldCount = applied.filter((k) => k === 'fold').length;
  const visibleCount = ALL_NAV.length - foldCount;
  const navBoxRef = useRef(null); // 导航可用区域（flex-1）
  const navInnerRef = useRef(null); // 导航内容（w-max，自然宽度）
  const rowRef = useRef(null);
  // 重新测量：level 归零 + tick 递增（保证即使 level 已是 0 也会重渲染并重新爬升）
  const [tick, setTick] = useState(0);
  const remeasure = () => {
    setLevel(0);
    setTick((t) => t + 1);
  };
  // 页面切换导致编译器按钮出现/消失 → 重新测量（跳过首次挂载）
  const prevDock = useRef(dockAvailable);
  useLayoutEffect(() => {
    if (prevDock.current === dockAvailable) return;
    prevDock.current = dockAvailable;
    remeasure();
  }, [dockAvailable]);
  // 顶栏宽度变化 → 重新测量
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let last = Math.round(row.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      if (w !== last) {
        last = w;
        remeasure();
      }
    });
    ro.observe(row);
    return () => ro.disconnect();
  }, []);
  // 逐级爬升：每次提交后检测是否溢出，溢出则再压一级（layout effect 内同步重排，绘制前收敛）
  useLayoutEffect(() => {
    const box = navBoxRef.current;
    const inner = navInnerRef.current;
    const row = rowRef.current;
    if (!box || !inner || !row) return;
    const overflow = inner.offsetWidth > box.clientWidth + 0.5 || row.scrollWidth > row.clientWidth + 0.5;
    if (overflow && level < STEPS.length) setLevel(level + 1);
  }, [level, tick, dockAvailable]);
  const shownNav = ALL_NAV.slice(0, visibleCount);
  const overflowNav = ALL_NAV.slice(visibleCount);
  const isActive = (href) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const ghInMore = has('ghIcon');
  const moreActive = overflowNav.some((item) => isActive(item.href));
  const showMore = overflowNav.length > 0 || ghInMore;

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
      <div ref={rowRef} className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
        {/* 品牌区不收缩：由上方 level 逐级隐藏域名 / 站名 / 图标，而不是 truncate 成「AC …」 */}
        {!(has('name') && has('acIcon')) && (
          <Link href="/" className="flex shrink-0 items-center gap-2.5" title="AC 题库 ac.isam.top" aria-label="AC 题库首页">
            {!has('acIcon') && (
              <span className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-md text-[13px] font-bold">
                AC
              </span>
            )}
            {!has('name') && (
              <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight">
                AC 题库{!has('domain') && <span className="text-muted-foreground"> ac.isam.top</span>}
              </span>
            )}
          </Link>
        )}
        {/* 导航区：占据品牌与右侧按钮簇之间的全部空间；放不下的入口收进「更多」 */}
        <div ref={navBoxRef} className="relative ml-2 flex min-w-0 flex-1 items-center">
          <div ref={navInnerRef} className="flex w-max shrink-0 items-center">
          <nav className="flex min-w-0 items-center gap-1 whitespace-nowrap" aria-label="站点导航">
            {shownNav.map((item) => (
              <Button key={item.href} asChild variant="ghost" size="sm">
                <Link href={item.href} prefetch={false} className={isActive(item.href) ? 'text-foreground' : 'text-muted-foreground'}>
                  {item.label}
                </Link>
              </Button>
            ))}
          </nav>
          {showMore && (
            <div ref={moreRef} className="relative ml-1 shrink-0">
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
                  {overflowNav.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        prefetch={false}
                        className={`flex items-start gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-accent ${
                          isActive(item.href) ? 'text-foreground font-medium' : ''
                        }`}
                      >
                        {Icon ? <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <span className="size-4 shrink-0" />}
                        <span className="min-w-0">
                          <span className="block leading-5">{item.label}</span>
                          {item.desc && <span className="text-muted-foreground block text-[11px] leading-4">{item.desc}</span>}
                        </span>
                      </Link>
                    );
                  })}
                  {ghInMore && (
                    <a
                      href={GITHUB_URL}
                      target="_blank"
                      rel="noreferrer"
                      role="menuitem"
                      className="flex items-start gap-2.5 border-t px-3 py-2.5 text-sm transition-colors hover:bg-accent"
                    >
                      <GithubMark className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block leading-5">GitHub</span>
                        <span className="text-muted-foreground block text-[11px] leading-4">本站仓库 Sam5440/ac.isam.top</span>
                      </span>
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
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
              {!has('compilerLabel') && <span>编译器</span>}
              {!has('kbd') && <kbd>⌘ J</kbd>}
            </Button>
          )}
          <ThemeToggleButton />
          <SettingsGearButton />
          {!ghInMore && (
            <Button asChild size="sm" className={has('ghText') ? 'px-2.5' : undefined}>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" title="本站仓库：Sam5440/ac.isam.top" aria-label="GitHub 仓库">
                <GithubMark className="size-3.5" />
                {!has('ghText') && <span>GitHub</span>}
              </a>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
