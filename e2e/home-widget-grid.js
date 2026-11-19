import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true, serviceWorkers: 'block' });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const requests = [];
page.on('request', (request) => { if (/open-meteo|codeforces\.com\/api|\/api\/contests\/clist/.test(request.url())) requests.push(request.url()); });
const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('stmt-settings-v1')));
const button = (name) => page.getByRole('button', { name, exact: true });
const inspect = page.getByRole('region', { name: '小组件属性' });
const canvas = page.getByLabel('布局预览');
const clock = page.locator('[data-home-root="home"] [data-widget="clock"]');
const editorClock = canvas.locator('[data-widget="clock"]');
const configure = () => page.getByRole('link', { name: '自定义首页' }).click();
const coord = (item) => item.evaluate((element) => [element.style.gridColumn, element.style.gridRow]);
try {
  await page.route('https://geocoding-api.open-meteo.com/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ results: [{ name: '苏州', admin1: '江苏', country: '中国', latitude: 31.3, longitude: 120.6 }] }),
  }));
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      current: { temperature_2m: 22.4, apparent_temperature: 23.1, relative_humidity_2m: 55, weather_code: 1, wind_speed_10m: 8.2 },
      current_units: { temperature_2m: '°C' }, daily: { temperature_2m_min: [15], temperature_2m_max: [25] },
    }),
  }));
  await page.goto(base);
  const problems = page.locator('[data-home-root="home"] [data-widget="problems"]');
  const problemLinks = problems.locator('a[href^="/problems/"]');
  assert.equal(await problemLinks.count(), 7);
  assert.equal((await coord(problems))[0], '3 / span 2');
  await configure();
  const previewProblems = page.locator('[data-home-root="preview"] [data-widget="problems"] a[href^="/problems/"]');
  await previewProblems.nth(6).waitFor();
  assert.equal(await previewProblems.count(), 7);
  await button('选择最近收录').click();
  const grid = page.getByLabel('布局预览');
  const canvasProblems = grid.locator('[data-widget="problems"]');
  const originalHeight = (await grid.boundingBox()).height;
  await inspect.getByLabel('高度').selectOption('6');
  assert.equal(await inspect.getByLabel('题目数量').count(), 0);
  await inspect.getByText(/当前最多 11 条/).waitFor();
  await previewProblems.nth(10).waitFor();
  assert.equal(await previewProblems.count(), 11);
  const bottom = (box) => box.y + box.height;
  assert.ok((await grid.boundingBox()).height > originalHeight);
  assert.equal(bottom(await grid.boundingBox()), bottom(await canvasProblems.boundingBox()));
  assert.ok(await grid.evaluate((element) => element.parentElement.scrollHeight <= element.parentElement.clientHeight + 1));
  await button('保存并查看首页').click();
  await page.waitForURL(`${base}/`);
  await page.reload();
  await problemLinks.nth(10).waitFor();
  assert.equal(await problemLinks.count(), 11);
  await configure();
  await button('添加时钟').dragTo(button('选择站点介绍'), { targetPosition: { x: 25, y: 12 } });
  await editorClock.waitFor();
  assert.deepEqual(await coord(editorClock), ['1 / span 2', '1 / span 2']);
  const handle = await editorClock.locator('[data-resize]').boundingBox();
  const width = (await page.getByLabel('布局预览').boundingBox()).width;
  await page.mouse.move(handle.x + 12, handle.y + 12);
  await page.mouse.down();
  await page.mouse.move(handle.x + 12 + width / 4, handle.y + 64, { steps: 8 });
  await page.mouse.up();
  assert.deepEqual(await coord(editorClock), ['1 / span 3', '1 / span 3']);
  await button('选择时钟').dragTo(button('选择近期比赛'), { targetPosition: { x: 40, y: 60 } });
  const position = await coord(editorClock);
  assert.notEqual(position[1], '1 / span 3');
  await inspect.getByLabel('问候称呼').fill('晨练');
  const html = page.getByRole('radio', { name: '高级 HTML' });
  const visual = page.getByRole('radio', { name: '小组件布局' });
  await html.click();
  await page.getByLabel('首页 HTML 布局').fill('<h1>保留的草稿</h1>');
  await visual.click();
  await button('保存并查看首页').click();
  await page.waitForURL(`${base}/`);
  await page.reload();
  await clock.getByText(/晨练/).waitFor();
  assert.deepEqual(await coord(clock), position);
  const saved = await settings();
  await configure();
  await html.click();
  assert.equal(await page.getByLabel('首页 HTML 布局').inputValue(), '<h1>保留的草稿</h1>');
  await visual.click();
  await button('选择时钟').focus();
  await page.keyboard.press('Enter');
  await inspect.getByLabel('宽度').press('ArrowDown');
  assert.equal(await inspect.getByLabel('宽度').inputValue(), '4');
  await button('前移').press('Enter');
  await button('取消修改').click();
  assert.deepEqual(await coord(editorClock), position);
  assert.deepEqual(await settings(), saved);
  await page.setViewportSize({ width: 390, height: 844 });
  await button('模块库').tap();
  await page.getByRole('dialog').getByRole('button', { name: '添加天气' }).tap();
  await inspect.getByLabel('天气城市').fill('苏州');
  await page.locator('[data-home-root="preview"] [data-widget="weather"]').getByText(/22°C/).waitFor();
  await button('前移').tap();
  assert.equal(await page.getByRole('dialog').isVisible(), false);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await button('取消修改').tap();
  await page.getByRole('link', { name: '返回首页' }).tap();
  await clock.waitFor();
  assert.equal((await coord(clock))[0], '1 / span 1');
  assert.equal((await settings()).homeWidgets.find((item) => item.type === 'clock').w, 3);
  assert.ok(requests.some((url) => url.includes('api.open-meteo.com')));
  assert.deepEqual(errors, []);
  console.log('首页组件 E2E 通过：高度自动匹配条数、真实数据预览、拖入、双轴缩放、换位、保存刷新、键盘、手机抽屉、取消与 HTML 独立草稿');
} finally { await browser.close(); }
