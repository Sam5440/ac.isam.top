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
    assert.equal(await page.getByRole('group', { name: '译文效果' }).getByRole('radio').count(), 24);

    await page.getByRole('radio', { name: '虚线边框' }).click();
    await page.getByRole('radio', { name: '反转背景色' }).click();
    await page.getByRole('spinbutton', { name: '译文字号' }).fill('24');
    await page.getByRole('spinbutton', { name: '译文段间距倍数' }).fill('1.5');
    await page.getByRole('spinbutton', { name: '译文行高倍数' }).fill('1.8');
    await page.getByLabel('译文字体').selectOption('serif');
    await page.getByLabel('译文边框颜色').fill('#336699');
    await page.getByLabel('译文背景颜色').fill('#fff1aa');
    await page.getByRole('spinbutton', { name: '译文字号' }).press('Tab');

    const preview = page.locator('[lang="zh-Hans"]');
    assert.equal(await preview.getAttribute('data-zh-preset'), 'dashedBorder');
    const previewStyle = await preview.evaluate((element) => ({
      color: getComputedStyle(element.querySelector('[data-zh-prose]')).color,
      fontSize: getComputedStyle(element.querySelector('[data-zh-prose]')).fontSize,
      lineHeight: getComputedStyle(element.querySelector('[data-zh-prose]')).lineHeight,
      borderColor: getComputedStyle(element).getPropertyValue('--zh-rule-ink').trim(),
      background: getComputedStyle(element.querySelector('.zh-copy')).backgroundColor,
    }));
    assert.equal(previewStyle.fontSize, '24px');
    assert.equal(previewStyle.lineHeight, '43.2px');
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
      assert.equal(await page.locator('[lang="zh-Hans"]').getAttribute('data-zh-preset'), 'dashedBorder');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stmt-settings-v1')));
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
