/**
 * 主题注册表(node/浏览器同源,纯数据 + 浏览器侧 CRUD)。
 *
 * 三层主题:
 * 1. 内置 3 种(夜间/日间/墨水屏)——沿用 <html> class 驱动(dark / 无 / eink),
 *    变量定义在 app/globals.css;
 * 2. 模板 4 套(Nord / Dracula / Gruvbox / 樱花浅色)——html[data-theme] 属性 +
 *    <style id="ac-theme-css"> 注入 css 字段驱动;base 决定同时挂的 Tailwind
 *    基类(dark = 保留 .dark 使 dark: 变体生效,light = 无类);
 * 3. 用户自定义主题——localStorage stmt-custom-themes-v1,机制同模板,
 *    可从任一模板复制 CSS 起步。
 *
 * 模板/自定义主题的 css 必须覆盖:标准 CSS 变量(html[data-theme=id] 选择器)+
 * 编译器周边硬编码暗色(.compiler-edge-tab / .compiler-launch / .compiler-toast /
 * .cp-kb*,参照 globals.css 里 .eink 的覆盖写法)。
 */

export const BUILTIN_THEMES = [
  { id: 'dark', label: '夜间', kind: 'builtin', base: 'dark', swatch: ['#141417', '#1f1f24', '#e4e4e7', '#fafafa'] },
  { id: 'light', label: '日间', kind: 'builtin', base: 'light', swatch: ['#ffffff', '#f4f4f5', '#18181b', '#18181b'] },
  { id: 'eink', label: '墨水屏', kind: 'builtin', base: 'eink', swatch: ['#f9f8ef', '#fefdfa', '#5236c8', '#29293d'] },
];

/** 编译器周边(全局硬编码暗色)→ 主题变量的统一覆盖块,四套模板共用。 */
function compilerOverrides(id) {
  const s = `html[data-theme="${id}"]`;
  return `/* 编译器周边(globals 硬编码暗色)→ 主题配色 */
${s} .compiler-edge-tab { color: var(--primary); background: var(--card); border-color: var(--border); }
${s} .compiler-edge-tab:hover { background: var(--accent); }
${s} .compiler-launch { background: var(--secondary); color: var(--primary); border-color: var(--border); }
${s} .compiler-launch:hover { background: var(--accent); border-color: var(--ring); }
${s} .compiler-launch kbd { color: var(--muted-foreground); }
${s} .compiler-toast { background: var(--popover); color: var(--popover-foreground); }
${s} .cp-kb { background: var(--background); }
${s} .cp-kb-key { background: var(--secondary); color: var(--foreground); }
${s} .cp-kb-key-tool { background: var(--muted); color: var(--muted-foreground); }
${s} .cp-kb-key:active,
${s} .cp-kb-key[data-active] { background: color-mix(in srgb, var(--primary) 38%, transparent); transform: scale(0.96); }`;
}

const nordCss = `/* Nord 极夜 —— 冷蓝灰暗色,源自 nordtheme.com 官方 Polar Night / Frost / Aurora 色板 */
html[data-theme="nord"] {
  color-scheme: dark;
  --radius: 0.625rem;
  --background: #2e3440;
  --foreground: #eceff4;
  --card: #353c4a;
  --card-foreground: #eceff4;
  --popover: #3b4252;
  --popover-foreground: #eceff4;
  --primary: #88c0d0;
  --primary-foreground: #2e3440;
  --secondary: #3f4757;
  --secondary-foreground: #e5e9f0;
  --muted: #3b4252;
  --muted-foreground: #aeb7c6;
  --accent: #434c5e;
  --accent-foreground: #eceff4;
  --destructive: #bf616a;
  --border: #434c5e;
  --input: #4c566a;
  --ring: #88c0d0;
}

${compilerOverrides('nord')}`;

const draculaCss = `/* Dracula 魅影 —— 深紫霓虹暗色,源自 draculatheme.com 官方色板 */
html[data-theme="dracula"] {
  color-scheme: dark;
  --radius: 0.75rem;
  --background: #282a36;
  --foreground: #f8f8f2;
  --card: #2f3140;
  --card-foreground: #f8f8f2;
  --popover: #343746;
  --popover-foreground: #f8f8f2;
  --primary: #bd93f9;
  --primary-foreground: #1e2029;
  --secondary: #3a3d4d;
  --secondary-foreground: #f8f8f2;
  --muted: #343746;
  --muted-foreground: #9ca0b8;
  --accent: #44475a;
  --accent-foreground: #f8f8f2;
  --destructive: #ff5555;
  --border: #44475a;
  --input: #44475a;
  --ring: #bd93f9;
}

${compilerOverrides('dracula')}`;

const gruvboxCss = `/* Gruvbox 暖调 —— 复古暖棕暗色,源自 github.com/morhetz/gruvbox 官方色板 */
html[data-theme="gruvbox"] {
  color-scheme: dark;
  --radius: 0.5rem;
  --background: #282828;
  --foreground: #ebdbb2;
  --card: #32302f;
  --card-foreground: #ebdbb2;
  --popover: #3c3836;
  --popover-foreground: #ebdbb2;
  --primary: #fabd2f;
  --primary-foreground: #1d2021;
  --secondary: #3c3836;
  --secondary-foreground: #ebdbb2;
  --muted: #3c3836;
  --muted-foreground: #bdae93;
  --accent: #504945;
  --accent-foreground: #fbf1c7;
  --destructive: #fb4934;
  --border: #504945;
  --input: #504945;
  --ring: #fabd2f;
}

${compilerOverrides('gruvbox')}`;

const sakuraCss = `/* 樱花浅色 —— 柔和粉调浅色(樱白底 + 玫红主色),适合白天长时间阅读 */
html[data-theme="sakura"] {
  color-scheme: light;
  --radius: 0.75rem;
  --background: #fdf6f8;
  --foreground: #453640;
  --card: #fffdfd;
  --card-foreground: #453640;
  --popover: #fffdfd;
  --popover-foreground: #453640;
  --primary: #d5708f;
  --primary-foreground: #fff8fa;
  --secondary: #f7e8ed;
  --secondary-foreground: #6d5460;
  --muted: #f7e8ed;
  --muted-foreground: #9c8290;
  --accent: #f3dde5;
  --accent-foreground: #6d3a4d;
  --destructive: #d23f5c;
  --border: #ecd7e0;
  --input: #ecd7e0;
  --ring: #d5708f;
}

${compilerOverrides('sakura')}`;

export const TEMPLATE_THEMES = [
  {
    id: 'nord',
    label: 'Nord 极夜',
    kind: 'template',
    base: 'dark',
    monaco: 'one-dark',
    swatch: ['#2e3440', '#353c4a', '#88c0d0', '#eceff4'],
    css: nordCss,
  },
  {
    id: 'dracula',
    label: 'Dracula 魅影',
    kind: 'template',
    base: 'dark',
    monaco: 'dracula',
    swatch: ['#282a36', '#2f3140', '#bd93f9', '#f8f8f2'],
    css: draculaCss,
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox 暖调',
    kind: 'template',
    base: 'dark',
    monaco: 'monokai',
    swatch: ['#282828', '#32302f', '#fabd2f', '#ebdbb2'],
    css: gruvboxCss,
  },
  {
    id: 'sakura',
    label: '樱花浅色',
    kind: 'template',
    base: 'light',
    monaco: 'solarized-light',
    swatch: ['#fdf6f8', '#fffdfd', '#d5708f', '#453640'],
    css: sakuraCss,
  },
];

/* ---------------- 用户自定义主题 CRUD(localStorage)---------------- */

const CUSTOM_KEY = 'stmt-custom-themes-v1';

function isValidTheme(t) {
  return t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.css === 'string';
}

export function loadCustomThemes() {
  if (typeof window === 'undefined') return [];
  try {
    const list = JSON.parse(window.localStorage.getItem(CUSTOM_KEY) || '[]');
    return Array.isArray(list) ? list.filter(isValidTheme) : [];
  } catch {
    return [];
  }
}

/** 新建或更新(按 id upsert),返回保存后的完整列表。 */
export function saveCustomTheme(theme) {
  const list = loadCustomThemes();
  const next = { ...theme, kind: 'custom' };
  const i = list.findIndex((t) => t.id === theme.id);
  if (i >= 0) list[i] = next;
  else list.push(next);
  try {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {}
  return list;
}

export function deleteCustomTheme(id) {
  const list = loadCustomThemes().filter((t) => t.id !== id);
  try {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {}
  return list;
}

/* ---------------- 查询与预览辅助 ---------------- */

/** 全部主题:内置 + 模板 + 自定义。customs 缺省时从 localStorage 读取。 */
export function allThemes(customs) {
  const list = customs ?? loadCustomThemes();
  return [...BUILTIN_THEMES, ...TEMPLATE_THEMES, ...list.map((t) => ({ ...t, kind: 'custom' }))];
}

export function findTheme(id, customs) {
  if (!id) return null;
  return allThemes(customs).find((t) => t.id === id) || null;
}

/** 主题卡片的四色预览条 [背景, 卡片, 主色, 文字]。自定义主题从 CSS 文本解析。 */
export function swatchOf(theme) {
  if (Array.isArray(theme.swatch) && theme.swatch.length >= 4) return theme.swatch;
  const pick = (name, fallback) => {
    const m = theme.css?.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
    return m ? m[1].trim() : fallback;
  };
  return [
    pick('background', '#1f1f24'),
    pick('card', '#2a2a31'),
    pick('primary', '#8b8bff'),
    pick('foreground', '#fafafa'),
  ];
}
