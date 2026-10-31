'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import { AI_MODELS, aiTranslate } from '@/components/ai-translate';
import CompilerSettingsSection from '@/components/compiler/CompilerSettingsSection';
import GithubMark from '@/components/GithubMark';
import { clearZhCache } from '@/lib/zh-store';
import { CHANGELOG, APP_VERSION } from '@/lib/changelog';
import { CONTEST_TYPES } from '@/lib/contest-type';

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
const priorityLabel = (id) => channelLabel(id);

// 译文样式偏好：空字符串/false = 跟随默认（.zh-styled 的回退值等价于无操作）
export const DEFAULT_ZH_STYLE = { color: '', fontSize: '', bold: false, italic: false, underline: false };

export const DEFAULT_HOME_TYPES = CONTEST_TYPES.map((t) => t.id);

// 界面外观：夜间（默认）/ 日间 / 墨水屏。html 类名驱动：dark / 无 / eink
export const THEME_OPTIONS = [
  { id: 'dark', label: '夜间' },
  { id: 'light', label: '日间' },
  { id: 'eink', label: '墨水屏' },
];

const DEFAULT_SETTINGS = {
  defaultChannel: 'deepl',
  // 首次访问（无本机选择记录）时的题面语言模式：对照（原文 + 优先级链译文）
  defaultLangMode: 'both',
  sidebarChannels: ['deepl', 'youdao', 'caiyun', 'iflyrec', 'ai', 'ai_custom'],
  zhPriority: DEFAULT_PRIORITY,
  zhStyle: DEFAULT_ZH_STYLE,
  ai: { baseUrl: '', apiKey: '', model: AI_MODELS[0] },
  // 比赛题目页视图：'sidebar'（侧栏题目列表 + 顶部切换）| 'full'（整页阅读）
  contestView: 'sidebar',
  // 首页「最新比赛」展示的比赛类型（CONTEST_TYPES 子集）
  homeContestTypes: DEFAULT_HOME_TYPES,
  // 界面外观（THEME_OPTIONS 之一，默认夜间）
  theme: 'dark',
};

const LANG_KEY = 'stmt-lang-v2';
const SETTINGS_KEY = 'stmt-settings-v1';

function loadLang(defaultChannel, defaultMode = 'both') {
  try {
    const raw = window.localStorage.getItem(LANG_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v && ['en', 'zh', 'both'].includes(v.mode) && typeof v.channel === 'string') {
        if (v.channel === 'ai') v.channel = 'ai_custom';
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
      const merged = {
        ...DEFAULT_SETTINGS,
        ...v,
        zhStyle: { ...DEFAULT_ZH_STYLE, ...(v.zhStyle || {}) },
        ai: { ...DEFAULT_SETTINGS.ai, ...(v.ai || {}) },
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
      return merged;
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

/* ---------------- context ---------------- */

const SettingsContext = createContext(null);

export function useSettings() {
  return useContext(SettingsContext);
}

export function SettingsProvider({ children }) {
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [lang, setLangState] = useState({ mode: 'both', channel: DEFAULT_SETTINGS.defaultChannel });
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const s = loadSettings();
    setSettingsState(s);
    setLangState(loadLang(s.defaultChannel, s.defaultLangMode));
  }, []);

  // 界面外观 → <html> 类名：夜间=dark，日间=两者皆无，墨水屏=eink（去 dark）
  useEffect(() => {
    const t = THEME_OPTIONS.some((o) => o.id === settings.theme) ? settings.theme : 'dark';
    const root = document.documentElement;
    root.classList.toggle('dark', t === 'dark');
    root.classList.toggle('eink', t === 'eink');
  }, [settings.theme]);

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
    openSettings: () => setDialogOpen(true),
    aiReady: !!(settings.ai.baseUrl && settings.ai.apiKey),
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
      {dialogOpen && <SettingsDialog onClose={() => setDialogOpen(false)} />}
    </SettingsContext.Provider>
  );
}

/* ---------------- gear button (top-right, in SiteHeader) ---------------- */

function GearIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function SettingsGearButton() {
  const { openSettings } = useSettings();
  return (
    <button
      type="button"
      onClick={openSettings}
      title="设置"
      aria-label="设置"
      className="text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-md border bg-card transition-colors"
    >
      <GearIcon className="size-4" />
    </button>
  );
}

/* ---------------- theme quick toggle (top-right, in SiteHeader) ---------------- */

const THEME_ICONS = { dark: MoonIcon, light: SunIcon, eink: EinkIcon };

/** 外观快捷切换：点击在 夜间 → 日间 → 墨水屏 间循环，图标反映当前外观。 */
export function ThemeToggleButton() {
  const { settings, setSettings } = useSettings();
  const cur = THEME_OPTIONS.some((o) => o.id === settings.theme) ? settings.theme : 'dark';
  const Icon = THEME_ICONS[cur];
  return (
    <button
      type="button"
      onClick={() => {
        const i = THEME_OPTIONS.findIndex((o) => o.id === cur);
        setSettings({ theme: THEME_OPTIONS[(i + 1) % THEME_OPTIONS.length].id });
      }}
      title={`外观：${THEME_OPTIONS.find((o) => o.id === cur).label}（点击切换 夜间 / 日间 / 墨水屏）`}
      aria-label={`界面外观：${THEME_OPTIONS.find((o) => o.id === cur).label}，点击切换`}
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

/* ---------------- settings dialog ---------------- */

const inputCls =
  'w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/60';

function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-muted-foreground/70 block text-[11px] leading-relaxed">{hint}</span>}
    </label>
  );
}

/* 更新日志：最新版本默认展开，更早版本折叠（details，点击展开）。 */
function ChangelogSection() {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs font-medium">
          更新日志（共 {CHANGELOG.length} 个版本）
        </p>
        <span className="shrink-0 rounded-md border border-primary/60 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-foreground">
          当前 v{APP_VERSION}
        </span>
      </div>
      <div className="space-y-1.5">
        {CHANGELOG.map((v, i) => (
          <details key={v.version} className="rounded-md border px-2.5 py-2" open={i === 0}>
            <summary className="cursor-pointer text-xs">
              <span className="font-medium">v{v.version}</span>{' '}
              <span className="text-muted-foreground ml-1">{v.date}</span>{' '}
              <span>{v.title}</span>
            </summary>
            <ul className="mt-1.5 space-y-1">
              {v.changes.map((c, j) => (
                <li key={j} className="text-muted-foreground text-[11px] leading-relaxed">
                  {c}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

function SettingsDialog({ onClose }) {
  const { settings, setSettings, aiReady, lang, setLang } = useSettings();
  const [ai, setAi] = useState(settings.ai);
  const [test, setTest] = useState(null); // {state: 'loading'|'ok'|'fail', msg}

  const patchAi = (p) => setAi((prev) => ({ ...prev, ...p }));

  // 切换默认题面语言：立即作用于当前浏览，同时存为本机没有选择记录时的默认
  const pickLangMode = (mode) => {
    setLang((prev) => ({ mode, channel: prev.channel }));
    setSettings({ defaultLangMode: mode });
  };

  const saveAi = () => {
    setSettings((prev) => ({ ...prev, ai }));
  };

  const runTest = async () => {
    setTest({ state: 'loading' });
    try {
      const out = await aiTranslate('Print the maximum total tastiness.', ai);
      setTest({ state: 'ok', msg: out });
    } catch (e) {
      setTest({ state: 'fail', msg: e.message });
    }
  };

  const toggleChannel = (id) => {
    const has = settings.sidebarChannels.includes(id);
    const next = has
      ? settings.sidebarChannels.filter((c) => c !== id)
      : [...CHANNELS.map((c) => c.id).filter((c) => settings.sidebarChannels.includes(c) || c === id)];
    setSettings({ sidebarChannels: next });
  };

  const movePriority = (i, d) => {
    const next = [...(settings.zhPriority || [])];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSettings({ zhPriority: next });
  };

  const toggleHomeType = (id) => {
    const has = settings.homeContestTypes.includes(id);
    const next = has
      ? settings.homeContestTypes.filter((t) => t !== id)
      : [...CONTEST_TYPES.map((t) => t.id).filter((t) => settings.homeContestTypes.includes(t) || t === id)];
    setSettings({ homeContestTypes: next });
  };

  const zhStyle = settings.zhStyle || DEFAULT_ZH_STYLE;
  const patchZhStyle = (p) =>
    setSettings((prev) => ({ ...prev, zhStyle: { ...(prev.zhStyle || DEFAULT_ZH_STYLE), ...p } }));
  const resetZhStyle = () => setSettings({ zhStyle: { ...DEFAULT_ZH_STYLE } });
  const zhStyleCustomized =
    zhStyle.color || zhStyle.fontSize !== '' || zhStyle.bold || zhStyle.italic || zhStyle.underline;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]" onClick={onClose}>
      <div
        className="bg-card w-full max-w-md space-y-5 rounded-xl border p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">设置</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">
            界面外观（夜间为默认；顶部按钮可随时快捷切换）
          </p>
          <div className="flex rounded-md border p-0.5">
            {THEME_OPTIONS.map((t) => {
              const active = (settings.theme || 'dark') === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSettings({ theme: t.id })}
                  aria-pressed={active}
                  className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                    active
                      ? 'bg-primary font-medium text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {settings.theme === 'eink' && (
            <p className="text-muted-foreground/70 block text-[11px] leading-relaxed">
              墨水屏模式：纸白底、高对比强色彩（适配彩色墨水屏，黑白屏下对比依旧清晰），去动效去阴影以减少残影。内置代码编辑器的配色可在下方「编译器」里单独选浅色主题。
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">
            默认题面语言（全局默认为对照：原文 + 优先级链译文并列显示；左下角的译字浮标可随时切换）
          </p>
          <div className="flex rounded-md border p-0.5">
            {[
              { id: 'both', label: '对照' },
              { id: 'en', label: '英文' },
              { id: 'zh', label: '中文' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => pickLangMode(m.id)}
                aria-pressed={lang.mode === m.id}
                className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                  lang.mode === m.id
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium">
            对照翻译优先级（每段取首个已有译文的渠道，段落结尾标注来源；缺失的译文由本机向各渠道实时请求，约每 3 秒一条，结果保存在本机浏览器）。AI (CI翻译)
            = CI 任务自动翻译的存档；想让全站优先显示某个渠道的译文，把它排到第一位即可。
          </p>
          <ul className="space-y-1">
            {(settings.zhPriority || []).map((id, i) => (
              <li key={id} className="flex items-center justify-between rounded-md border px-2.5 py-1 text-xs">
                <span>
                  <span className="text-muted-foreground mr-2 inline-block w-3">{i + 1}</span>
                  {priorityLabel(id)}
                </span>
                <span className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => movePriority(i, -1)}
                    disabled={i === 0}
                    aria-label={`${priorityLabel(id)} 上移`}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground rounded px-1.5 py-0.5 transition-colors disabled:opacity-25"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => movePriority(i, 1)}
                    disabled={i === settings.zhPriority.length - 1}
                    aria-label={`${priorityLabel(id)} 下移`}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground rounded px-1.5 py-0.5 transition-colors disabled:opacity-25"
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">侧栏显示的翻译渠道</p>
          <div className="flex flex-wrap gap-1.5">
            {CHANNELS.map((c) => {
              const on = settings.sidebarChannels.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleChannel(c.id)}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    on ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className={`inline-block size-2 rounded-full ${on ? 'bg-primary' : 'bg-border'}`} />
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs font-medium">译文样式（题面中文译文的外观；来源芯片、行内代码与公式不受影响）</p>
            {zhStyleCustomized && (
              <button
                type="button"
                onClick={resetZhStyle}
                className="text-muted-foreground hover:text-foreground shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition-colors"
              >
                恢复默认
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
              字号
              <input
                type="number"
                min={8}
                max={40}
                value={zhStyle.fontSize}
                placeholder="默认"
                onChange={(e) => patchZhStyle({ fontSize: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) })}
                className="bg-background w-16 rounded-md border px-2 py-1 text-sm outline-none focus:border-primary/60"
              />
              <span>px</span>
            </label>
            <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
              颜色
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(zhStyle.color) ? zhStyle.color : '#8b8b9e'}
                onChange={(e) => patchZhStyle({ color: e.target.value })}
                aria-label="译文颜色"
                className="bg-background size-7 cursor-pointer rounded-md border p-0.5"
              />
            </label>
            <div className="ml-auto flex items-center gap-1">
              {[
                { key: 'bold', label: 'B', cls: 'font-bold', name: '加粗' },
                { key: 'italic', label: 'I', cls: 'italic', name: '斜体' },
                { key: 'underline', label: 'U', cls: 'underline', name: '下划线' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={!!zhStyle[t.key]}
                  aria-label={`译文${t.name}`}
                  title={`译文${t.name}`}
                  onClick={() => patchZhStyle({ [t.key]: !zhStyle[t.key] })}
                  className={`inline-flex size-7 items-center justify-center rounded-md border text-xs transition-colors ${t.cls} ${
                    zhStyle[t.key]
                      ? 'border-primary/60 bg-primary/10 text-foreground ring-1 ring-primary/50'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-background rounded-md border px-2.5 py-2">
            <p className="zh-styled text-[13px] leading-6">
              预览：给定一个整数 n，输出 2n 的值。每次修改立即生效并保存在本机。
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-dashed p-3">
          <p className="text-muted-foreground text-xs font-medium">
            AI（用户自定义翻译）· OpenAI 兼容接口，浏览器直连，Key 仅保存在本机
          </p>
          <Field label="Base URL" hint="HTTPS 部署的站点需填写 HTTPS 地址，否则浏览器会拦截混合内容">
            <input
              className={inputCls}
              placeholder="http://localhost:3000"
              value={ai.baseUrl}
              onChange={(e) => patchAi({ baseUrl: e.target.value.trim() })}
            />
          </Field>
          <Field label="API Key">
            <input
              className={inputCls}
              type="password"
              placeholder="sk-..."
              value={ai.apiKey}
              onChange={(e) => patchAi({ apiKey: e.target.value.trim() })}
            />
          </Field>
          <Field label="模型">
            <select className={inputCls} value={ai.model} onChange={(e) => patchAi({ model: e.target.value })}>
              {AI_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runTest}
              disabled={!ai.baseUrl || !ai.apiKey || test?.state === 'loading'}
              className="bg-background hover:bg-accent rounded-md border px-2.5 py-1 text-xs text-foreground transition-colors disabled:opacity-50"
            >
              {test?.state === 'loading' ? '测试中…' : '测试连接'}
            </button>
            <button
              type="button"
              onClick={saveAi}
              className="bg-primary rounded-md px-2.5 py-1 text-xs font-medium text-primary-foreground"
            >
              保存
            </button>
            {aiReady && settings.ai.apiKey === ai.apiKey && settings.ai.baseUrl === ai.baseUrl && (
              <span className="text-[11px] text-emerald-500">已配置</span>
            )}
          </div>
          {test && (
            <p className={`text-[11px] leading-relaxed ${test.state === 'ok' ? 'text-emerald-500' : 'text-red-400'}`}>
              {test.state === 'ok' ? `✓ ${test.msg}` : `✗ ${test.msg}`}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">首页展示的比赛类型</p>
          <div className="flex flex-wrap gap-1.5" data-testid="home-contest-types">
            {CONTEST_TYPES.map((t) => {
              const on = settings.homeContestTypes.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  title={t.desc}
                  onClick={() => toggleHomeType(t.id)}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    on ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className={`inline-block size-2 rounded-full ${on ? 'bg-primary' : 'bg-border'}`} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">比赛题目页视图</p>
          <div className="flex rounded-md border p-0.5">
            {[
              { id: 'sidebar', label: '侧栏 + 切换条' },
              { id: 'full', label: '整页阅读' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSettings({ contestView: m.id })}
                aria-pressed={settings.contestView === m.id}
                className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                  settings.contestView === m.id
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <CompilerSettingsSection />

        <ChangelogSection />

        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium">项目仓库</p>
          <div className="space-y-1">
            <a
              href="https://github.com/Sam5440/ac.isam.top"
              target="_blank"
              rel="noreferrer"
              className="hover:bg-accent flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs text-foreground transition-colors"
            >
              <GithubMark className="size-3.5 shrink-0" />
              <span className="font-medium">本站仓库</span>
              <span className="text-muted-foreground">Sam5440/ac.isam.top</span>
            </a>
            <a
              href="https://github.com/Sam5440/ys_problem_web"
              target="_blank"
              rel="noreferrer"
              className="hover:bg-accent flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs text-foreground transition-colors"
            >
              <GithubMark className="size-3.5 shrink-0" />
              <span className="font-medium">参考项目</span>
              <span className="text-muted-foreground">Sam5440/ys_problem_web</span>
            </a>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={async () => {
              await clearZhCache();
              window.location.reload();
            }}
            className="text-muted-foreground hover:text-foreground rounded-md border px-2.5 py-1.5 text-xs transition-colors"
          >
            清除本机翻译缓存
          </button>
          <button
            type="button"
            onClick={onClose}
            className="bg-background text-muted-foreground hover:text-foreground rounded-md border px-4 py-1.5 text-sm transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
