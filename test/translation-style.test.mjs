import test from 'node:test';
import assert from 'node:assert/strict';

import { renderRich } from '../lib/render.js';
import {
  DEFAULT_ZH_STYLE,
  isTranslationStyleCustomized,
  normalizeTranslationStyle,
  parseTranslationColor,
  parseTranslationFont,
  parseTranslationNumber,
  TRANSLATION_FONTS,
  TRANSLATION_PRESETS,
  translationAppearance,
} from '../lib/translation-style.mjs';

test('译文预设涵盖附件里的 24 种互斥效果', () => {
  assert.equal(TRANSLATION_PRESETS.length, 24);
  assert.equal(new Set(TRANSLATION_PRESETS.map(({ id }) => id)).size, 24);
  for (const id of ['dashedBorder', 'highlight', 'mask', 'wavy', 'background']) {
    assert.ok(TRANSLATION_PRESETS.some((preset) => preset.id === id));
  }
});

test('译文样式规范化保留旧版偏好并处理无效配置', () => {
  assert.deepEqual(normalizeTranslationStyle(), { ...DEFAULT_ZH_STYLE });
  assert.deepEqual(normalizeTranslationStyle({
    color: '#abc',
    fontSize: '24',
    bold: true,
    italic: true,
    underline: true,
  }), {
    ...DEFAULT_ZH_STYLE,
    preset: 'nativeUnderline',
    colorMode: 'custom',
    color: '#aabbcc',
    fontSize: 24,
    weight: 600,
    italic: true,
  });
  assert.deepEqual(normalizeTranslationStyle({
    preset: '<script>',
    color: 'red; background:url(javascript:alert(1))',
    fontSize: 1000,
    spacingScale: 'Infinity',
    weight: '900px',
    fontFamily: 'Arial; color:red',
  }), { ...DEFAULT_ZH_STYLE });
  assert.equal(isTranslationStyleCustomized(normalizeTranslationStyle({})), false);
  assert.equal(isTranslationStyleCustomized(normalizeTranslationStyle({ preset: 'bold' })), true);
});

test('译文颜色、字号、行距与字体值只接收安全白名单输入', () => {
  assert.equal(parseTranslationColor('#abc'), '#aabbcc');
  assert.equal(parseTranslationColor('red'), null);
  assert.equal(parseTranslationColor('var(--background)'), null);
  assert.equal(parseTranslationNumber('fontSize', 40), 40);
  assert.equal(parseTranslationNumber('fontSize', 41), null);
  assert.equal(parseTranslationNumber('spacingScale', 0.5), 0.5);
  assert.equal(parseTranslationNumber('spacingScale', 0.55), null);
  assert.equal(parseTranslationNumber('lineHeight', 1.65), 1.65);
  assert.equal(parseTranslationNumber('lineHeight', 1.63), null);
  assert.equal(parseTranslationFont('Noto Sans SC, sans-serif'), 'Noto Sans SC, sans-serif');
  assert.equal(parseTranslationFont('Arial; color: red'), null);
  assert.ok(TRANSLATION_FONTS.some(({ id }) => id === 'custom'));
});

test('译文样式生成隔离的主题变量并将用户选项回退到默认值', () => {
  const style = normalizeTranslationStyle({
    preset: 'highlight',
    colorMode: 'inverse',
    backgroundColor: '#fff1aa',
    borderColor: '#336699',
    zoom: 120,
    spacingScale: 1.5,
    lineHeight: 1.8,
    font: 'custom',
    fontFamily: 'Noto Sans SC, sans-serif',
  });
  const props = translationAppearance(style);
  assert.equal(props['data-zh-preset'], 'highlight');
  assert.equal(props['data-zh-background'], '');
  assert.equal(props['data-zh-spaced'], '');
  assert.equal(props.style['--zh-ink'], 'var(--zh-inverse)');
  assert.equal(props.style['--zh-bg'], '#fff1aa');
  assert.equal(props.style['--zh-rule-ink'], '#336699');
  assert.equal(props.style['--zh-zoom'], 1.2);
  assert.equal(props.style['--zh-line-height'], 1.8);
  assert.deepEqual(normalizeTranslationStyle(DEFAULT_ZH_STYLE), { ...DEFAULT_ZH_STYLE });
});

test('译文段落只为普通文字加样式锚点', () => {
  const html = renderRich('普通文本 **重点**、`inline code` 与 $x_i$。', { translation: true });
  assert.match(html, /<span data-zh-prose="">普通文本 <\/span>/);
  assert.match(html, /<strong><span data-zh-prose="">重点<\/span><\/strong>/);
  assert.match(html, /<code class="inline-code">inline code<\/code>/);
  assert.match(html, /<code class="zs-math" data-display="0">\$x_i\$<\/code>/);
  assert.equal((html.match(/data-zh-prose=/g) || []).length, 5);
  assert.doesNotMatch(html, /data-zh-prose=""><code class="(?:inline-code|zs-math)"/);
});

test('原文代码图片公式和标记内的数字、数学标记保持原始节点', () => {
  const html = renderRich('第 **2** 题，输入 `x2`，看 $x_2$：![题图](https://example.com/2.png)', { translation: true });
  assert.match(html, /<strong><span data-zh-prose="">2<\/span><\/strong>/);
  assert.match(html, /<code class="inline-code">x2<\/code>/);
  assert.match(html, /<code class="zs-math" data-display="0">\$x_2\$<\/code>/);
  assert.match(html, /<img[^>]+alt="题图"/);
  assert.equal((html.match(/data-zh-prose=/g) || []).length, 5);
});

test('译文原文不标记为译文，危险 HTML 仍被渲染边界清除', () => {
  const original = renderRich('English <img src=x onerror=alert(1)>');
  const translation = renderRich('<p>纯文本</p><script>alert(1)</script>', { translation: true });
  assert.doesNotMatch(original, /data-zh-prose|onerror/);
  assert.match(translation, /<span data-zh-prose="">纯文本<\/span>/);
  assert.doesNotMatch(translation, /<script|alert\(1\)/);
});
