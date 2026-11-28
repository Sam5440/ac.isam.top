import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://127.0.0.1:3107';
const browser = await chromium.launch();

try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600 });
    const issues = [];
    page.on('pageerror', (error) => issues.push(error.message));
    await page.goto(`${base}/settings#reading`, { waitUntil: 'networkidle' });
    const effects = page.getByRole('group', { name: '译文效果' });
    assert.equal(await effects.getByRole('button', { name: '无' }).count(), 1);
    assert.equal(await effects.locator('button[aria-pressed]').count(), 24);

    const effect = (name) => effects.getByRole('button', { name, exact: true });
    await effect('虚线下划线').click();
    assert.equal(await effect('虚线下划线').getAttribute('aria-pressed'), 'true');
    await effect('波浪线').click();
    assert.equal(await effect('虚线下划线').getAttribute('aria-pressed'), 'false');
    await effect('虚线下划线').click();
    await effect('虚线边框').click();
    await effect('高亮').click();
    await effect('加粗').click();
    await effect('斜体').click();
    await effect('模糊效果（学习模式）').click();
    const preview = page.locator('[lang="zh-Hans"]');
    assert.ok(await preview.locator('[data-zh-prose]').evaluate((element) => getComputedStyle(element).filter.startsWith('blur(')));
    await page.getByRole('button', { name: '显示译文' }).click();
    assert.equal(await preview.getAttribute('data-zh-revealed'), '');
    await page.getByRole('button', { name: '隐藏译文' }).click();
    await effect('模糊效果（学习模式）').click();
    assert.equal(await effect('无').getAttribute('aria-pressed'), 'false');
    await page.getByRole('radio', { name: '反转背景色' }).click();
    await page.getByRole('spinbutton', { name: '译文字号' }).fill('24');
    await page.getByRole('spinbutton', { name: '译文段间距倍数' }).fill('1.5');
    await page.getByRole('spinbutton', { name: '译文行高倍数' }).fill('1.8');
    await page.getByLabel('译文字体').selectOption('serif');
    await page.getByLabel('译文边框颜色').fill('#336699');
    await page.getByLabel('译文背景颜色').fill('#fff1aa');
    await page.getByRole('spinbutton', { name: '译文字号' }).press('Tab');

    assert.deepEqual((await preview.getAttribute('data-zh-presets')).split(' '), ['dashed', 'dashedBorder', 'highlight', 'bold', 'italic']);
    const previewStyle = await preview.evaluate((element) => ({
      color: getComputedStyle(element.querySelector('[data-zh-prose]')).color,
      fontSize: getComputedStyle(element.querySelector('[data-zh-prose]')).fontSize,
      lineHeight: getComputedStyle(element.querySelector('[data-zh-prose]')).lineHeight,
      fontWeight: getComputedStyle(element.querySelector('[data-zh-prose]')).fontWeight,
      fontStyle: getComputedStyle(element.querySelector('[data-zh-prose]')).fontStyle,
      fontFamily: getComputedStyle(element.querySelector('[data-zh-prose]')).fontFamily,
      underline: getComputedStyle(element.querySelector('[data-zh-prose]')).borderBottomStyle,
      cardBorder: getComputedStyle(element.querySelector('.zh-copy')).borderTopStyle,
      borderColor: getComputedStyle(element).getPropertyValue('--zh-rule-ink').trim(),
      background: getComputedStyle(element.querySelector('[data-zh-prose]')).backgroundColor,
    }));
    assert.equal(previewStyle.fontSize, '24px');
    assert.equal(previewStyle.lineHeight, '43.2px');
    assert.equal(previewStyle.fontWeight, '700');
    assert.equal(previewStyle.fontStyle, 'italic');
    assert.match(previewStyle.fontFamily, /Songti SC/);
    assert.equal(previewStyle.underline, 'dashed');
    assert.equal(previewStyle.cardBorder, 'dashed');
    assert.equal(previewStyle.borderColor, '#336699');
    assert.equal(previewStyle.background, 'rgb(255, 241, 170)');
    const darkMode = await page.locator('html').evaluate((element) => element.classList.contains('dark'));
    const darkText = await preview.locator('[data-zh-prose]').evaluate((element) => getComputedStyle(element).color);
    assert.notEqual(darkText, await page.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor));
    await page.evaluate((darkMode) => {
      const key = 'stmt-settings-v1';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify({ ...settings, theme: darkMode ? 'light' : 'dark' }));
    }, darkMode);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('html').evaluate((element) => element.classList.contains('dark')), !darkMode);
    const lightText = await page.locator('[lang="zh-Hans"] [data-zh-prose]').evaluate((element) => getComputedStyle(element).color);
    assert.notEqual(lightText, await page.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor));
    assert.notEqual(lightText, darkText, '反转色随页面主题背景实时变化');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${width}px 设置页横向溢出 ${overflow}px`);

    if (width === 1440) {
      assert.deepEqual((await page.locator('[data-zh-preview]').getAttribute('data-zh-presets')).split(' '), ['dashed', 'dashedBorder', 'highlight', 'bold', 'italic']);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stmt-settings-v1')));
      assert.deepEqual(saved.zhStyle.presets, ['dashed', 'dashedBorder', 'highlight', 'bold', 'italic']);
      assert.equal(Object.hasOwn(saved.zhStyle, 'preset'), false);
      assert.equal(Object.hasOwn(saved.zhStyle, 'italic'), false);
      assert.equal(saved.zhStyle.colorMode, 'inverse');
      assert.equal(saved.zhStyle.fontSize, 24);
      assert.equal(saved.zhStyle.spacingScale, 1.5);
      assert.equal(saved.zhStyle.lineHeight, 1.8);
      assert.equal(saved.zhStyle.font, 'serif');
      assert.equal(saved.zhStyle.backgroundColor, '#fff1aa');
      assert.equal(saved.zhStyle.borderColor, '#336699');
    }
    assert.deepEqual(issues, []);

    await page.close();
    console.log(`translation-style ${width}px: ok`);
  }
} finally {
  await browser.close();
}
