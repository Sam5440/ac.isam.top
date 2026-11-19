import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { VISUAL_HOME_PRESETS } from '../lib/home-presets.mjs';
import { normalizeWidgets } from '../lib/home-grid.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

async function checkLayout(preset, widgets, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate((value) => {
    const settings = JSON.parse(localStorage.getItem('stmt-settings-v1'));
    localStorage.setItem('stmt-settings-v1', JSON.stringify({
      ...settings, homeLayoutMode: 'visual', homeWidgets: value, homeCfHandle: 'tourist',
    }));
  }, widgets);
  await page.goto(base, { waitUntil: 'networkidle' });
  const cells = page.locator('[data-home-root="home"] [data-widget]');
  assert.equal(await cells.count(), widgets.length, `${preset.id} / ${width}: 组件数量`);
  await page.waitForFunction(() => document.querySelectorAll('[data-home-root="home"] [aria-label="加载中"]').length === 0);
  const result = await cells.evaluateAll((nodes) => {
    const boxes = nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push([i, j]);
      }
    }
    return {
      overlaps,
      clipped: nodes.flatMap((node, index) => {
        const style = getComputedStyle(node);
        const scrolling = /(auto|scroll)/.test(style.overflowX) || /(auto|scroll)/.test(style.overflowY);
        const clipped = node.scrollHeight > node.clientHeight + 2 || node.scrollWidth > node.clientWidth + 2;
        return scrolling || clipped ? [{ index, scrolling, clipped, height: [node.clientHeight, node.scrollHeight], width: [node.clientWidth, node.scrollWidth] }] : [];
      }),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  assert.deepEqual(result.overlaps, [], `${preset.id} / ${width}: 组件重叠`);
  assert.deepEqual(result.clipped, [], `${preset.id} / ${width}: 内部滚动或内容裁切`);
  assert.ok(result.documentWidth <= width + 1, `${preset.id} / ${width}: 页面横向溢出 ${result.documentWidth}`);
}

try {
  await page.route(/\/api\/contests\/clist\?/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ contests: [{
      id: 998877, event: '预设检查未来赛', resource: 'codeforces.com',
      start: new Date(Date.now() + 86_400_000).toISOString(), end: new Date(Date.now() + 93_600_000).toISOString(),
      duration: 7200, href: 'https://codeforces.com/contest/998877',
    }] }),
  }));
  await page.route('https://geocoding-api.open-meteo.com/**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ results: [{ name: '北京', latitude: 39.9, longitude: 116.4 }] }),
  }));
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      current: { temperature_2m: 22.4, apparent_temperature: 23.1, relative_humidity_2m: 55, weather_code: 1, wind_speed_10m: 8.2 },
      current_units: { temperature_2m: '°C' }, daily: { temperature_2m_min: [15], temperature_2m_max: [25] },
    }),
  }));
  await page.route('https://codeforces.com/api/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ status: 'OK', result: [{ handle: 'tourist', rating: 3408, maxRating: 4009, rank: 'legendary grandmaster', maxRank: 'legendary grandmaster' }] }),
  }));
  await page.goto(base);
  await page.goto(`${base}/settings#home`, { waitUntil: 'networkidle' });
  const choices = page.locator('[data-visual-preset]');
  assert.equal(await choices.count(), 10);
  for (const preset of VISUAL_HOME_PRESETS) {
    await page.locator(`[data-visual-preset="${preset.id}"]`).click();
    const expected = preset.widgets.length;
    assert.equal(await page.getByLabel('布局预览').locator('[data-widget]').count(), expected, `${preset.id}: 画布未随预设更新`);
    await page.waitForFunction((count) => document.querySelectorAll('[data-home-root="preview"] [data-widget]').length === count, expected);
  }
  for (const preset of VISUAL_HOME_PRESETS) {
    const widgets = normalizeWidgets(preset.widgets);
    await checkLayout(preset, widgets, 1440, 900);
    for (const width of [320, 390, 430]) await checkLayout(preset, widgets, width, 844);
    console.log(`通过：${preset.label}（桌面 / 320 / 390 / 430）`);
  }
  assert.deepEqual(errors, []);
  console.log('10 套可视化预设全部通过：桌面与 320/390/430px 手机无重叠、横向溢出、内容裁切或组件内滚动条');
} finally {
  await browser.close();
}
