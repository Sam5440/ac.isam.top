'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingsGearButton, ThemeToggleButton } from '@/components/settings';
import GithubMark from '@/components/GithubMark';

const NAV = [
  { href: '/', label: '首页' },
  { href: '/problems', label: '题库' },
  { href: '/contests', label: '比赛' },
];

export default function SiteHeader() {
  const pathname = usePathname();
  // 编译器只在题目页存在（题目页挂载 CompilerDock）；开合状态经
  // body.compiler-open 同步（CompilerDock 是唯一写方，这里只读）。
  const dockAvailable = pathname.startsWith('/problems/');
  const [dockOpen, setDockOpen] = useState(false);

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
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md text-[13px] font-bold">
            AC
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            AC 题库 <span className="text-muted-foreground">ac.isam.top</span>
          </span>
        </Link>
        <nav className="ml-2 hidden items-center gap-1 sm:flex">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Button key={item.href} asChild variant="ghost" size="sm">
                <Link href={item.href} className={active ? 'text-foreground' : 'text-muted-foreground'}>
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
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
              编译器
              <kbd>⌘ J</kbd>
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
            >
              <GithubMark className="size-3.5" />
              GitHub
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}
