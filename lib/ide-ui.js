/**
 * IDE 界面偏好（设备本地数据，不进设置导出）。
 *
 * 记录用户反复调整、刷新后应当保持的界面状态：
 *   markdownMode      Markdown 工作台模式（split / wysiwyg / preview）
 *   markdownSplitPct  分屏比例（20–80，双击分隔条回 50）
 *   filesExpanded     文件管理里展开的文件夹路径
 *   recent            快速打开（⌘P）的最近文件
 *
 * 与 lib/ide-tabs.js（标签栏）分开：标签随打开/关闭高频变化，这里是低频偏好。
 * 纯函数 + 注入 storage，node 测试用内存实现。
 */

export const IDE_UI_KEY = 'ysc-uia-qznhxe-b3';

export const MARKDOWN_MODES = ['split', 'wysiwyg', 'preview'];

const MAX_EXPANDED = 200;
const MAX_RECENT = 20;

const isPath = (v) => typeof v === 'string' && v.length > 0 && v.length <= 400;
const uniq = (list) => [...new Set(list)];

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export const IDE_UI_DEFAULTS = Object.freeze({
  markdownMode: 'split',
  markdownSplitPct: 50,
  filesExpanded: [],
  recent: [],
});

/** 归一化：容忍缺失 / 旧格式 / 被篡改的存储内容。 */
export function normalizeIdeUi(raw) {
  const mode = MARKDOWN_MODES.includes(raw?.markdownMode) ? raw.markdownMode : IDE_UI_DEFAULTS.markdownMode;
  const pct = Number(raw?.markdownSplitPct);
  const splitPct = Number.isFinite(pct) ? Math.min(80, Math.max(20, Math.round(pct))) : IDE_UI_DEFAULTS.markdownSplitPct;
  const filesExpanded = Array.isArray(raw?.filesExpanded)
    ? uniq(raw.filesExpanded.filter(isPath)).slice(-MAX_EXPANDED)
    : [];
  const recent = Array.isArray(raw?.recent) ? uniq(raw.recent.filter(isPath)).slice(0, MAX_RECENT) : [];
  return { markdownMode: mode, markdownSplitPct: splitPct, filesExpanded, recent };
}

export function loadIdeUi(store = defaultStorage()) {
  try {
    const raw = store?.getItem(IDE_UI_KEY);
    if (!raw) return { ...IDE_UI_DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...IDE_UI_DEFAULTS };
    return normalizeIdeUi(parsed);
  } catch {
    return { ...IDE_UI_DEFAULTS };
  }
}

/** 合并写入（读改写），避免不同组件只带自己的字段把别的偏好清掉。 */
export function patchIdeUi(patch, store = defaultStorage()) {
  const next = normalizeIdeUi({ ...loadIdeUi(store), ...(patch || {}) });
  try {
    store?.setItem(IDE_UI_KEY, JSON.stringify(next));
  } catch {}
  return next;
}