'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startNavProgress } from '@/components/NavigationProgress';

import {
  DEFAULT_AI_ASSIGN,
  DEFAULT_AI_PROVIDERS,
  normalizeAssign,
  normalizeProviders,
} from '@/lib/ai-providers';
import { allThemes, findTheme, loadCustomThemes, mappedIdeTheme } from '@/lib/themes';
import { CONTEST_TYPES } from '@/lib/contest-type';

// IDE 主题联动写入：动态 import 编译器偏好纯模块（浏览器端写入 localStorage，
// 并通知已打开的 CompilerDock 刷新）。binding = 'auto' 时随网页主题切换联动。
async function syncIdeTheme(webThemeId, customs) {
  try {
    const { saveCpSettings } = await import('@/lib/compiler/cp-settings');
    saveCpSettings({ editorTheme: mappedIdeTheme(webThemeId, customs) });
    window.dispatchEvent(new Event('ysc-cp-settings-changed'));
  } catch {}
}

/* ---------------- constants ---------------- */

export const CHANNELS = [
  { id: 'deepl', label: 'DeepL' },
  { id: 'youdao', label: '有道' },
  { id: 'caiyun', label: '彩云' },
  { id: 'iflyrec', label: '讯飞' },
  { id: 'ai', label: 'AI (CI翻译)' },
  { id: 'ai_custom', label: 'AI (用户自定义翻译)' },
];

// CI 管线在仓库里存档的渠道（'ai' 由 CI AI 翻译写入）
export const ARCHIVED_CHANNELS = ['deepl', 'youdao', 'caiyun', 'iflyrec'];

// 对照模式按此链逐段取首个有译文的渠道；AI (CI翻译) 默认居首
export const DEFAULT_PRIORITY = ['ai', 'deepl', 'caiyun', 'iflyrec', 'youdao'];

export const channelLabel = (id) => CHANNELS.find((c) => c.id === id)?.label || id;

// 译文样式偏好：空字符串/false = 跟随默认（.zh-styled 的回退值等价于无操作）
export const DEFAULT_ZH_STYLE = { color: '', fontSize: '', bold: false, italic: false, underline: false };

export const DEFAULT_HOME_TYPES = CONTEST_TYPES.map((t) => t.id);

// AI 对话默认配置：默认复用「AI (用户自定义翻译)」的接口，悬浮窗默认开启
export const DEFAULT_CHAT = {
  useTranslationAi: true,
  baseUrl: '',
  apiKey: '',
  model: '',
  includeStatement: true,
  includeCode: true,
  floatingButton: true,
  // 工作项 2：双显示模式（'float' 视口浮窗 | 'sidebar' 右侧抽屉）与上下文注入开关
  displayMode: 'float',
  includeSamples: true,
  includeRunErrors: true,
};

export const DEFAULT_SETTINGS = {
  defaultChannel: 'deepl', // 旧字段：仅作向后兼容，新代码用 defaultZhChannel
  // 首次访问（无本机选择记录）时的题面语言模式：对照（原文 + 优先级链译文）
  defaultLangMode: 'both',
  // 每次重新打开网页时把题面语言/翻译渠道重置为下面的默认值（默认开启）
  resetLangOnLoad: true,
  // 默认翻译渠道：AI (CI翻译)。mode 为 zh 时直接使用；also 应用到对照模式的侧栏选择
  defaultZhChannel: 'ai',
  sidebarChannels: ['deepl', 'youdao', 'caiyun', 'iflyrec', 'ai', 'ai_custom'],
  zhPriority: DEFAULT_PRIORITY,
  zhStyle: DEFAULT_ZH_STYLE,
  // 旧版字段（v1.4 及以前的翻译 AI 表单、对话独立配置）已于 v1.5 抛弃，
  // 不再保留默认值；loadSettings 合并时直接丢弃存量，全局 AI 服务商是
  // 唯一的接口配置入口（设置 →「AI 服务商」）。
  // 全局 AI 服务商：接口地址/Key 只在这里配置，功能模块（翻译 / AI 对话 /
  // AI 代码补全）只能挑选服务商并覆盖模型。
  aiProviders: DEFAULT_AI_PROVIDERS,
  aiAssign: DEFAULT_AI_ASSIGN,
  // 题目页切换条（比赛含 ≥2 题时显示）：题目卡上方横向题目条 / 视口左侧中部悬浮题号竖条（正文全区预留空间）
  topSwitcher: true,
  letterRail: true,
  // 首页「最新比赛」展示的比赛类型（CONTEST_TYPES 子集）
  homeContestTypes: DEFAULT_HOME_TYPES,
  // 界面外观：内置 dark/light/eink，或模板/自定义主题 id（lib/themes.js）
  theme: 'dark',
  // IDE（Monaco）编辑器主题与网页外观的绑定：'auto' = 跟随网页主题映射，
  // 'manual' = 在编译器设置 / /ide 编辑器设置中自选，切换网页主题不再联动
  ideThemeBinding: 'auto',
  // 全局自定义 CSS：叠加在当前主题之上（所有页面生效）
  customCss: '',
  // AI 对话（题目页悬浮窗）
  chat: DEFAULT_CHAT,
  // PWA 离线题库：后台自动保存最近 N 场比赛的全部题目页（OfflineCacheSection 可调）
  offlineLimit: 100,
};

const LANG_KEY = 'stmt-lang-v2';
const SETTINGS_KEY = 'stmt-settings-v1';

const LANG_CHANNELS = ['deepl', 'youdao', 'caiyun', 'iflyrec', 'ai', 'ai_custom'];

// 语言记录迁移版本：v1.1 时代 'ai' 指用户自定义翻译，v1.1.1 起 id 改为 ai_custom。
// 旧实现永久重映射 channel==='ai' → 'ai_custom'，导致「AI (CI翻译)」的选择每次
// 刷新都被改写为自定义翻译（渠道选择 bug 的根因）。现在只对无迁移标记的
// v1.1 存量执行一次，之后一律原样信任：'ai' = CI 翻译。
const LANG_MIGRATION = 2;

function migrateLangRecord(v) {
  if (v.channel === 'ai') v.channel = 'ai_custom';
  return { ...v, m: LANG_MIGRATION };
}

function loadLang(defaultChannel, defaultMode = 'both') {
  try {
    const raw = window.localStorage.getItem(LANG_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v && ['en', 'zh', 'both'].includes(v.mode) && typeof v.channel === 'string') {
        if (v.m !== LANG_MIGRATION) {
          // 一次性迁移并写回标记；此后记录被原样信任
          const migrated = migrateLangRecord(v);
          try {
            window.localStorage.setItem(LANG_KEY, JSON.stringify(migrated));
          } catch {}
          return migrated;
        }
        return v;
      }
    }
    const legacy = window.localStorage.getItem('stmt-lang');
    if (legacy === 'zh') return { mode: 'zh', channel: defaultChannel };
    if (legacy === 'both') return { mode: 'both', channel: defaultChannel };
  } catch {}
  return { mode: defaultMode, channel: defaultChannel };
}

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      // 抛弃旧 AI 数据（v1.5）：剥掉 v.ai / chat.useTranslationAi 等遗留字段，
      // chat 仅保留行为开关（悬浮窗/上下文注入），接口类字段一律丢弃
      const { ai: _legacyAi, ...rest } = v;
      const legacyChat = rest.chat || {};
      const { useTranslationAi: _u, baseUrl: _b, apiKey: _k, model: _m, ...chatBehavior } = legacyChat;
      const merged = {
        ...DEFAULT_SETTINGS,
        ...rest,
        ...(Object.keys(chatBehavior).length ? { chat: { ...DEFAULT_CHAT, ...chatBehavior } } : {}),
        zhStyle: { ...DEFAULT_ZH_STYLE, ...(v.zhStyle || {}) },
        homeContestTypes: Array.isArray(v.homeContestTypes) ? v.homeContestTypes : DEFAULT_HOME_TYPES,
      };
      const saved = (Array.isArray(merged.zhPriority) ? merged.zhPriority : []).filter(
        (id) => ARCHIVED_CHANNELS.includes(id) || id === 'ai',
      );
      merged.zhPriority = saved.includes('ai')
        ? [...saved, ...ARCHIVED_CHANNELS.filter((id) => !saved.includes(id))]
        : ['ai', ...saved, ...ARCHIVED_CHANNELS.filter((id) => !saved.includes(id))];
      merged.sidebarChannels = [
        ...new Set([...(Array.isArray(merged.sidebarChannels) ? merged.sidebarChannels : []), 'ai', 'ai_custom']),
      ];
      // 旧「默认翻译渠道」字段迁移：v1.3 及以前从未提供过 defaultChannel 的设置
      // 入口，存量值全是当年硬编码默认值 'deepl'，并非用户选择——不可继承
      // （否则老用户默认渠道会落到 DeepL 而不是 CI 翻译）。一律重置为 CI 翻译。
      delete merged.defaultChannel;
      if (!merged.defaultZhChannel || !LANG_CHANNELS.includes(merged.defaultZhChannel)) {
        merged.defaultZhChannel = 'ai';
      }
      // 旧版「比赛题目页视图 = 整页阅读」偏好迁移：此前选整页的用户默认关闭两类切换条
      if (v.topSwitcher === undefined) merged.topSwitcher = v.contestView !== 'full';
      if (v.letterRail === undefined) merged.letterRail = v.contestView !== 'full';
      // 全局 AI 服务商结构归一（脏数据容错）
      merged.aiProviders = normalizeProviders(merged.aiProviders);
      merged.aiAssign = {
        ...DEFAULT_AI_ASSIGN,
        ...(v.aiAssign || {}),
        translation: normalizeAssign(v.aiAssign?.translation),
        chat: normalizeAssign(v.aiAssign?.chat),
        completion: normalizeAssign(v.aiAssign?.completion),
      };
      return merged;
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

/** 注入/移除一个受控 <style> 节点（主题 CSS / 全局自定义 CSS 共用）。 */
function ensureStyleEl(id, css) {
  let el = document.getElementById(id);
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/* ---------------- context ---------------- */

const SettingsContext = createContext(null);

export function useSettings() {
  return useContext(SettingsContext);
}

export function SettingsProvider({ children }) {
  const router = useRouter();
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [lang, setLangState] = useState({ mode: 'both', channel: DEFAULT_SETTINGS.defaultZhChannel });
  const [customThemes, setCustomThemes] = useState([]);

  useEffect(() => {
    const s = loadSettings();
    setSettingsState(s);
    setCustomThemes(loadCustomThemes());
    // 每次打开网页重置为默认翻译（可关）：默认语言模式 + 默认翻译渠道（CI 翻译）
    if (s.resetLangOnLoad) {
      const ch = LANG_CHANNELS.includes(s.defaultZhChannel) ? s.defaultZhChannel : 'ai';
      setLangState({ mode: ['en', 'zh', 'both'].includes(s.defaultLangMode) ? s.defaultLangMode : 'both', channel: ch });
      try {
        window.localStorage.setItem(LANG_KEY, JSON.stringify({ mode: s.defaultLangMode || 'both', channel: ch }));
      } catch {}
    } else {
      setLangState(loadLang(LANG_CHANNELS.includes(s.defaultZhChannel) ? s.defaultZhChannel : 'ai', s.defaultLangMode));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 界面外观 → <html>：内置主题走类名；模板/自定义主题走 data-theme 属性 +
  // 注入 <style id="ac-theme-css">。base 类始终保留（dark: 变体 / eink 特例）。
  // 绑定为 auto 时同步联动 IDE（Monaco）主题（含程序化换肤，如保存自定义主题即应用）。
  useEffect(() => {
    const t = findTheme(settings.theme, customThemes) || findTheme('dark', customThemes);
    const root = document.documentElement;
    root.classList.toggle('dark', t.base === 'dark');
    root.classList.toggle('eink', t.base === 'eink');
    const css = t.kind === 'builtin' ? '' : t.css || '';
    if (css) root.setAttribute('data-theme', t.id);
    else root.removeAttribute('data-theme');
    ensureStyleEl('ac-theme-css', css);
    if ((settings.ideThemeBinding || 'auto') === 'auto') syncIdeTheme(settings.theme, customThemes);
  }, [settings.theme, customThemes, settings.ideThemeBinding]);

  // 全局自定义 CSS → <style id="ac-user-css">，叠加在主题之上
  useEffect(() => {
    ensureStyleEl('ac-user-css', settings.customCss || '');
  }, [settings.customCss]);

  // 译文样式偏好 → <html>：颜色/字号走 CSS 变量，加粗/斜体/下划线走开关类
  useEffect(() => {
    const st = settings.zhStyle || DEFAULT_ZH_STYLE;
    const root = document.documentElement;
    root.classList.toggle('zh-bold', !!st.bold);
    root.classList.toggle('zh-italic', !!st.italic);
    root.classList.toggle('zh-underline', !!st.underline);
    if (st.color) root.style.setProperty('--zh-color', st.color);
    else root.style.removeProperty('--zh-color');
    const n = Number(st.fontSize);
    if (st.fontSize !== '' && Number.isFinite(n) && n >= 8 && n <= 40) root.style.setProperty('--zh-font-size', `${n}px`);
    else root.style.removeProperty('--zh-font-size');
  }, [settings.zhStyle]);

  const setSettings = (next) => {
    setSettingsState((prev) => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      } catch {}
      return merged;
    });
  };

  const setLang = (next) => {
    setLangState((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      try {
        window.localStorage.setItem(LANG_KEY, JSON.stringify(v));
      } catch {}
      return v;
    });
  };

  const value = {
    lang,
    setLang,
    settings,
    setSettings,
    customThemes,
    reloadCustomThemes: () => setCustomThemes(loadCustomThemes()),
    openSettings: (hash) => (location.pathname !== '/settings' && startNavProgress(), router.push(hash ? `/settings#${hash}` : '/settings')),
    // 翻译模块接口是否就绪（全局服务商已配置 baseUrl+Key）
    aiReady: !!(
      settings.aiProviders &&
      settings.aiProviders.list.some((p) => p.baseUrl && p.apiKey)
    ),
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

/* ---------------- gear button (top-right, in SiteHeader) ---------------- */

function GearIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function SettingsGearButton() {
  return (
    <Link
      href="/settings"
      title="设置"
      aria-label="设置"
      className="text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-md border bg-card transition-colors"
    >
      <GearIcon className="size-4" />
    </Link>
  );
}

/* ---------------- theme quick toggle (top-right, in SiteHeader) ---------------- */

const THEME_ICONS = { dark: MoonIcon, light: SunIcon, eink: EinkIcon };

function PaletteIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

/** 外观快捷切换：在全部主题（内置 3 + 模板 + 自定义）间循环，图标反映当前外观。
    绑定为 auto 时切换后同步联动 IDE（Monaco）主题（Provider 的 effect 兜底程序化换肤）。 */
export function ThemeToggleButton() {
  const { settings, setSettings, customThemes } = useSettings();
  const list = allThemes(customThemes);
  const i = list.findIndex((t) => t.id === settings.theme);
  const cur = i >= 0 ? list[i] : list[0];
  const Icon = THEME_ICONS[cur.id] || PaletteIcon;
  return (
    <button
      type="button"
      onClick={() => {
        const j = i >= 0 ? (i + 1) % list.length : 0;
        setSettings({ theme: list[j].id });
        if ((settings.ideThemeBinding || 'auto') === 'auto') syncIdeTheme(list[j].id, customThemes);
      }}
      title={`外观：${cur.label}（点击切换下一个主题，完整主题库见设置）`}
      aria-label={`界面外观：${cur.label}，点击切换`}
      className="text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-md border bg-card transition-colors"
    >
      <Icon className="size-4" />
    </button>
  );
}

function MoonIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function SunIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function EinkIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="2.5" width="14" height="19" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </svg>
  );
}
