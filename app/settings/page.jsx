'use client';

/**
 * 独立设置页：左侧分类导航（桌面 sticky）/ 顶部横向标签（移动端），
 * 右侧为各设置分区。所有设置即时保存，无需「保存」按钮（Key 类字段除外）。
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, CloudDownload, Info, Languages, Palette, Sparkles, Terminal } from 'lucide-react';

import AppearanceSection from '@/components/settings/AppearanceSection';
import TranslationSection from '@/components/settings/TranslationSection';
import ChatSection from '@/components/settings/ChatSection';
import AboutSection from '@/components/settings/AboutSection';
import { SectionCard } from '@/components/settings/controls';
import AiCompletionSettingsSection from '@/components/compiler/AiCompletionSettingsSection';
import CompilerSettingsSection from '@/components/compiler/CompilerSettingsSection';
import OfflineCacheSection from '@/components/OfflineCacheSection';

const SECTIONS = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'translation', label: '翻译', icon: Languages },
  { id: 'chat', label: 'AI 对话', icon: Bot },
  { id: 'ai-completion', label: 'AI 代码补全', icon: Sparkles },
  { id: 'compiler', label: '编译器', icon: Terminal },
  { id: 'offline', label: '离线缓存', icon: CloudDownload },
  { id: 'about', label: '关于', icon: Info },
];

export default function SettingsPage() {
  const [active, setActive] = useState(SECTIONS[0].id);

  // 滚动高亮：分区进入视口上部 1/3 时点亮对应导航
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  // 深链:/settings#translation 等直接滚动到对应分区(openSettings(hash) 由此生效)
  useEffect(() => {
    const hash = window.location.hash?.slice(1);
    if (hash && SECTIONS.some((s) => s.id === hash)) {
      const el = document.getElementById(hash);
      if (el) {
        setActive(hash);
        el.scrollIntoView({ block: 'start' });
      }
    }
  }, []);

  const jump = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-20">
      <div className="flex items-center gap-3 pt-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs transition-colors"
        >
          <ArrowLeft className="size-4" />
          返回首页
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">设置</h1>
      </div>

      {/* 移动端：横向滚动标签 */}
      <nav className="mt-4 flex gap-1.5 overflow-x-auto pb-1 lg:hidden" aria-label="设置分类">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(s.id)}
            aria-current={active === s.id}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              active === s.id
                ? 'border-primary bg-primary/10 font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <s.icon className="size-3.5" />
            {s.label}
          </button>
        ))}
      </nav>

      <div className="mt-4 flex items-start gap-8 lg:mt-6">
        {/* 桌面端：左侧 sticky 导航 */}
        <nav className="hidden w-48 shrink-0 lg:sticky lg:top-20 lg:block" aria-label="设置分类">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => jump(s.id)}
                  aria-current={active === s.id}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
                    active === s.id
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <s.icon className="size-4" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          <AppearanceSection />
          <TranslationSection />
          <ChatSection />
          <SectionCard
            id="ai-completion"
            icon={Sparkles}
            title="AI 代码补全"
            desc="Monaco 编辑器内的 AI ghost text：多方案接口、本地模型、触发方式与用量统计。"
          >
            <AiCompletionSettingsSection />
          </SectionCard>
          <SectionCard
            id="compiler"
            icon={Terminal}
            title="编译器"
            desc="浏览器 C++ / Python 运行时、默认模板、编辑器主题与移动端布局。"
          >
            <CompilerSettingsSection />
          </SectionCard>
          <SectionCard
            id="offline"
            icon={CloudDownload}
            title="离线缓存"
            desc="PWA 离线题库与离线编译器：同步进度、条数上限与清除。"
          >
            <OfflineCacheSection />
          </SectionCard>
          <AboutSection />
        </div>
      </div>
    </div>
  );
}
