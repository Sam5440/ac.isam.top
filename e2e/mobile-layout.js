import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch();
try {
  for (const width of [320, 390, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 812 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const open = async (route) => {
      const response = await page.goto(new URL(route, base).href);
      if (response) assert.equal(response.status(), 200, route);
      await page.evaluate(() => document.fonts.ready);
    };
    const fits = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width}px ${page.url()}`);
    await open('/');
    await page.getByTitle('更多页面').tap();
    const menu = await page.getByRole('menu').boundingBox();
    assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= width);
    await page.getByRole('menuitem', { name: /浏览历史/ }).tap();
    await page.waitForURL('**/history');
    await fits();
    for (const route of ['/', '/ci', '/ide', '/calendar', '/contests', '/problems']) {
      await open(route);
      await fits();
      if (route === '/contests' || route === '/problems') {
        const link = page.locator(`main a[href^="${route}/"]`).first();
        await open(await link.getAttribute('href'));
        await fits();
      }
    }
    for (const [hash, title] of Object.entries({ reading: '题面与翻译', home: '首页布局', appearance: '外观', coding: '编程', ai: 'AI 助手', data: '离线与数据' })) {
      await open(`/settings#${hash}`);
      await page.getByRole('heading', { name: title, exact: true, level: 2 }).waitFor();
      await fits();
      if (hash === 'home') {
        await page.getByRole('button', { name: '模块库', exact: true }).tap();
        await page.getByRole('dialog').getByRole('button', { name: '添加时钟' }).tap();
        await page.getByRole('button', { name: '取消修改' }).tap();
      }
    }
    await page.close();
    console.log(`${width}px 路由、设置分区、菜单及编辑器操作通过`);
  }
} finally { await browser.close(); }
