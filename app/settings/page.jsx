'use client';

/**
 * 设置页（v1.8 重构）：按「你想做什么」分成 5 个分区，一次只显示一个，
 * 不再是 7 张卡片的长滚动页。
 *
 *   题面与翻译  语言 / 渠道 / 牛客默认翻译 / 题目页切换条 / 首页比赛类型 / 译文样式 / 高级（折叠）
 *   外观        主题库、自定义主题、自定义 CSS
 *   编程        编辑器配色绑定、运行时、编辑与运行、手机端、高级（模板）
 *   AI 助手     服务商 → 各功能使用的模型 → AI 对话 → AI 代码补全 → 高级（用量 / 日志）
 *   离线与数据  离线缓存、设置导出导入、翻译缓存、关于与更新日志
 *
 * 所有设置即时保存（Key 类字段除外）。URL hash 记录当前分区，旧 hash
 * （#translation / #ai-providers / #chat / #compiler / #offline / #about / #ai-completion）
 * 经 HASH_COMPAT 映射到新分区，外部深链不失效。
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, Code2, HardDrive, Languages, Palette } from 'lucide-react';

import { CustomCssBlock, IdeThemeBindingRow, ThemeGallery } from '@/components/settings/AppearanceSection';
import { ModuleAssignments, ProviderList, SettingsIO } from '@/components/settings/AiProviderSection';
import TranslationSection from '@/components/settings/TranslationSection';
import ChatSection from '@/components/settings/ChatSection';
import AboutSection, { ClearZhCacheRow } from '@/components/settings/AboutSection';
import { Group } from '@/components/settings/controls';
import CompilerSettingsSection from '@/components/compiler/CompilerSettingsSection';
import AiCompletionSettingsSection from '@/components/compiler/AiCompletionSettingsSection';
import OfflineCacheSection from '@/components/OfflineCacheSection';

const SECTIONS = [
  {
    id: 'reading',
    label: '题面与翻译',
    icon: Languages,
    desc: '题面默认语言、翻译渠道、牛客题目是否翻译，以及题目页的辅助导航。',
  },
  { id: 'appearance', label: '外观', icon: Palette, desc: '界面主题、自定义主题与全局 CSS。' },
  {
    id: 'coding',
    label: '编程',
    icon: Code2,
    desc: '浏览器内 C++ / Python 编译器：运行时下载、编辑器与运行偏好、手机端布局。',
  },
  {
    id: 'ai',
    label: 'AI 助手',
    icon: Bot,
    desc: '先添加服务商（填一次接口和 Key），再为翻译、AI 对话、代码补全挑选模型。',
  },
  { id: 'data', label: '离线与数据', icon: HardDrive, desc: '离线题库、设置备份、本机缓存，以及版本信息。' },
];

// 旧分区 hash → 新分区（外部链接 / openSettings(hash) 兼容）
const HASH_COMPAT = {
  translation: 'reading',
  'ai-providers': 'ai',
  'ai-completion': 'ai',
  chat: 'ai',
  compiler: 'coding',
  offline: 'data',
  about: 'data',
};

const resolveHash = (raw) => {
  const h = HASH_COMPAT[raw] || raw;
  return SECTIONS.some((s) => s.id === h) ? h : null;
};

function SectionBody({ id }) {
  switch (id) {
    case 'reading':
      return <TranslationSection />;
    case 'appearance':
      return (
        <div className="space-y-6">
          <Group title="主题">
            <ThemeGallery />
          </Group>
          <Group title="高级">
            <CustomCssBlock />
          </Group>
        </div>
      );
    case 'coding':
      return (
        <div className="space-y-6">
          <Group title="编辑器配色">
            <IdeThemeBindingRow />
          </Group>
          <CompilerSettingsSection />
        </div>
      );
    case 'ai':
      return (
        <div className="space-y-6">
          <ProviderList />
          <ModuleAssignments />
          <ChatSection />
          <AiCompletionSettingsSection />
        </div>
      );
    case 'data':
      return (
        <div className="space-y-6">
          <Group title="离线缓存（PWA）" desc="断网也能看题、跑代码。">
            <div className="px-4 py-3">
              <OfflineCacheSection />
            </div>
          </Group>
          <Group title="数据">
            <SettingsIO />
            <ClearZhCacheRow />
          </Group>
          <AboutSection />
        </div>
      );
    default:
      return null;
  }
}

export default function SettingsPage() {
  const [active, setActive] = useState(SECTIONS[0].id);

  // 深链：/settings#ai 等直接打开对应分区；浏览器前进后退同步
  useEffect(() => {
    const sync = () => {
      const h = resolveHash(window.location.hash.slice(1));
      if (h) setActive(h);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const pick = (id) => {
    setActive(id);
    history.replaceState(null, '', `#${id}`);
    window.scrollTo({ top: 0 });
  };

  const current = SECTIONS.find((s) => s.id === active) || SECTIONS[0];

  return (
    <div className="mx-auto w-full max-w-5xl px-0 pb-20 sm:px-2">
      <div className="flex items-center gap-3 pt-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs transition-colors"
        >
          <ArrowLeft className="size-4" />
          返回首页
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">设置</h1>
        <span className="text-muted-foreground ml-auto hidden text-[11px] sm:inline">修改即时保存在本机浏览器</span>
      </div>

      {/* 移动端：横向分区标签 */}
      <nav className="mt-4 flex gap-1.5 overflow-x-auto pb-1 lg:hidden" aria-label="设置分类">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => pick(s.id)}
            aria-current={active === s.id ? 'page' : undefined}
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
        {/* 桌面端：左侧分区导航 */}
        <nav className="hidden w-52 shrink-0 lg:sticky lg:top-20 lg:block" aria-label="设置分类">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => pick(s.id)}
                  aria-current={active === s.id ? 'page' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
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

        <div className="min-w-0 flex-1">
          <header className="mb-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <current.icon className="text-primary size-5" />
              {current.label}
            </h2>
            <p className="text-muted-foreground mt-1 text-[12px] leading-relaxed">{current.desc}</p>
          </header>
          <SectionBody id={current.id} />
        </div>
      </div>
    </div>
  );
}
