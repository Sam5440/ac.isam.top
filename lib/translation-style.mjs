export const TRANSLATION_PRESETS = [
  { id: 'none', label: '无', group: '常规' },
  { id: 'dashed', label: '虚线下划线', group: '下划线' },
  { id: 'underline', label: '直线下划线', group: '下划线' },
  { id: 'dotted', label: '点状下划线', group: '下划线' },
  { id: 'thinDashed', label: '细虚线下划线', group: '下划线' },
  { id: 'wavy', label: '波浪线', group: '下划线' },
  { id: 'nativeDotted', label: '系统自带点状下划线', group: '下划线' },
  { id: 'nativeDashed', label: '系统自带虚线下划线', group: '下划线' },
  { id: 'nativeUnderline', label: '系统自带直线下划线', group: '下划线' },
  { id: 'dashedBorder', label: '虚线边框', group: '边框与背景' },
  { id: 'solidBorder', label: '实线边框', group: '边框与背景' },
  { id: 'dividingLine', label: '分割线', group: '边框与背景' },
  { id: 'highlight', label: '高亮', group: '边框与背景' },
  { id: 'marker', label: '马克笔', group: '边框与背景' },
  { id: 'marker2', label: '马克笔2', group: '边框与背景' },
  { id: 'blockquote', label: '引用样式', group: '边框与背景' },
  { id: 'paper', label: '白纸阴影效果', group: '边框与背景' },
  { id: 'background', label: '背景色', group: '边框与背景' },
  { id: 'mask', label: '模糊效果（学习模式）', group: '文字效果' },
  { id: 'opacity', label: '透明效果', group: '文字效果' },
  { id: 'weakening', label: '弱化', group: '文字效果' },
  { id: 'grey', label: '黑灰色', group: '文字效果' },
  { id: 'italic', label: '斜体', group: '文字效果' },
  { id: 'bold', label: '加粗', group: '文字效果' },
];

export const TRANSLATION_FONTS = [
  { id: 'default', label: '跟随题面' },
  { id: 'sans', label: '无衬线（黑体）', css: 'ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: 'serif', label: '衬线（宋体）', css: '"Songti SC", "Noto Serif CJK SC", SimSun, ui-serif, serif' },
  { id: 'kai', label: '楷体', css: 'Kaiti SC, STKaiti, KaiTi, "Noto Serif CJK SC", serif' },
  { id: 'mono', label: '等宽', css: 'ui-monospace, Menlo, Consolas, monospace' },
  { id: 'custom', label: '自定义字体' },
];

export const TRANSLATION_STYLE_LIMITS = {
  fontSize: { min: 8, max: 40, step: 1 },
  zoom: { min: 50, max: 200, step: 1 },
  spacingScale: { min: 0.5, max: 10, step: 0.1 },
  lineHeight: { min: 1, max: 3, step: 0.05 },
  weight: { min: 100, max: 900, step: 1 },
};

export const DEFAULT_ZH_STYLE = Object.freeze({
  preset: 'none',
  colorMode: 'theme',
  color: '',
  borderColor: '',
  backgroundColor: '',
  fontSize: '',
  zoom: 100,
  spacingScale: 1,
  lineHeight: 1.65,
  weight: '',
  italic: null,
  font: 'default',
  fontFamily: '',
});

const PRESET_IDS = new Set(TRANSLATION_PRESETS.map(({ id }) => id));
const FONT_CSS = new Map(TRANSLATION_FONTS.map(({ id, css }) => [id, css]));
const COLOR_MODES = new Set(['theme', 'inverse', 'custom']);
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded']);

export function parseTranslationColor(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text) return '';
  if (!/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/.test(text)) return null;
  return text.length < 6 ? '#' + [...text.slice(1)].map((digit) => digit.repeat(2)).join('') : text;
}

export function parseTranslationNumber(key, value) {
  const limits = TRANSLATION_STYLE_LIMITS[key];
  if (!limits) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!text) return DEFAULT_ZH_STYLE[key];
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  if (number < limits.min || number > limits.max) return null;
  const stepCount = number / limits.step;
  if (Math.abs(stepCount - Math.round(stepCount)) > 1e-8) return null;
  return number;
}

export function parseTranslationFont(value) {
  if (typeof value !== 'string' || value.length > 160) return null;
  if (!value.trim()) return '';
  const names = value.split(',').map((part) => part.trim().replace(/^(["'])(.*)\1$/, '$2').trim());
  if (names.length > 5 || names.some((name) => !/^[\p{L}\p{M}\p{N} ._\-]+$/u.test(name))) return null;
  return names.join(', ');
}

export function normalizeTranslationStyle(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const color = parseTranslationColor(value.color) ?? '';
  return {
    preset: PRESET_IDS.has(value.preset) ? value.preset : value.preset === undefined && value.underline === true ? 'nativeUnderline' : 'none',
    colorMode: COLOR_MODES.has(value.colorMode)
      ? value.colorMode === 'custom' && !color ? 'theme' : value.colorMode
      : color ? 'custom' : 'theme',
    color,
    borderColor: parseTranslationColor(value.borderColor) ?? '',
    backgroundColor: parseTranslationColor(value.backgroundColor) ?? '',
    fontSize: parseTranslationNumber('fontSize', value.fontSize) ?? '',
    zoom: parseTranslationNumber('zoom', value.zoom) ?? DEFAULT_ZH_STYLE.zoom,
    spacingScale: parseTranslationNumber('spacingScale', value.spacingScale) ?? DEFAULT_ZH_STYLE.spacingScale,
    lineHeight: parseTranslationNumber('lineHeight', value.lineHeight) ?? DEFAULT_ZH_STYLE.lineHeight,
    weight: parseTranslationNumber('weight', value.weight) ?? (value.weight === undefined && value.bold === true ? 600 : ''),
    italic: typeof value.italic === 'boolean' && !(value.preset === undefined && value.italic === false) ? value.italic : null,
    font: FONT_CSS.has(value.font) ? value.font : 'default',
    fontFamily: parseTranslationFont(value.fontFamily) ?? '',
  };
}

export function isTranslationStyleCustomized(style) {
  return Object.keys(DEFAULT_ZH_STYLE).some((key) => style[key] !== DEFAULT_ZH_STYLE[key]);
}

export function translationAppearance(style) {
  const css = {};
  if (style.colorMode === 'inverse') css['--zh-ink'] = 'var(--zh-inverse)';
  else if (style.colorMode === 'custom' && style.color) css['--zh-ink'] = style.color;
  if (style.borderColor) css['--zh-rule-ink'] = style.borderColor;
  if (style.backgroundColor) css['--zh-bg'] = style.backgroundColor;
  if (style.fontSize) css['--zh-size'] = `${style.fontSize}px`;
  if (style.zoom !== 100) css['--zh-zoom'] = style.zoom / 100;
  if (style.spacingScale !== 1) css['--zh-spacing'] = style.spacingScale;
  if (style.lineHeight !== DEFAULT_ZH_STYLE.lineHeight) css['--zh-line-height'] = style.lineHeight;
  if (style.weight) css['--zh-weight'] = style.weight;
  if (style.italic !== null) css['--zh-slant'] = style.italic ? 'italic' : 'normal';
  if (style.font === 'custom' && style.fontFamily) {
    const families = style.fontFamily.split(', ').map((name) => GENERIC_FONTS.has(name.toLowerCase()) ? name : `"${name}"`);
    css['--zh-family'] = [...families, 'var(--zh-system-font)'].join(', ');
  } else if (FONT_CSS.get(style.font)) {
    css['--zh-family'] = FONT_CSS.get(style.font);
  }
  return {
    'data-zh-preset': style.preset,
    'data-zh-background': style.backgroundColor ? '' : undefined,
    'data-zh-spaced': style.spacingScale !== 1 ? '' : undefined,
    style: Object.keys(css).length ? css : undefined,
  };
}
