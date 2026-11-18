import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.route(/\/api\/contests\/clist\?/, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ contests: [{
      id: 998877, event: 'Clist 测试未来赛', resource: 'codeforces.com',
      start: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      end: new Date(Date.now() + 2 * 86_400_000 + 7200_000).toISOString(),
      duration: 7200, href: 'https://codeforces.com/contest/998877',
    }] }),
  }));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: /AC 题库/ }).waitFor();
  assert.equal(await page.getByRole('link', { name: '自定义首页' }).count(), 1);

  await page.getByRole('link', { name: '自定义首页' }).click();
  const editor = page.getByRole('textbox', { name: '首页 HTML 布局' });
  await page.getByRole('radio', { name: '高级 HTML' }).click();
  await editor.waitFor();
  assert.match(page.url(), /\/settings#home$/);
  assert.equal(await page.locator('button').filter({ hasText: '填入编辑器' }).count(), 12);

  await page.locator('button').filter({ hasText: '竞赛仪表盘' }).click();
  assert.match(await editor.inputValue(), /<ac-weather>/);
  assert.match(await editor.inputValue(), /<ac-cf-rating>/);

  const layout = `<div class="space-y-6 py-6">
    <h1 id="custom-home-title">我的测试首页</h1>
    <script>window.__homeXss = true</script>
    <img id="safe-image" src="/icons/icon-192.png" onerror="window.__homeXss = true" alt="图标">
    <ac-clock name="测试"></ac-clock>
    <ac-section title="未来比赛"><ac-contests kind="upcoming" limit="2" compact="true"></ac-contests></ac-section>
    <ac-section title="最近编辑"><ac-files limit="3"></ac-files></ac-section>
    <ac-section title="看过的比赛"><ac-history-contests kind="viewed"></ac-history-contests></ac-section>
    <ac-section title="做过的比赛"><ac-history-contests kind="practiced"></ac-history-contests></ac-section>
  </div>`;
  await editor.fill(layout);
  await page.getByRole('button', { name: /保存并查看首页/ }).click();
  await page.waitForURL(`${baseUrl}/`);
  await page.locator('#custom-home-title').waitFor();
  assert.equal(await page.locator('script').evaluateAll((nodes) => nodes.some((node) => node.textContent.includes('__homeXss'))), false);
  assert.equal(await page.locator('#safe-image').getAttribute('onerror'), null);
  assert.equal(await page.evaluate(() => window.__homeXss), undefined);
  await page.getByRole('link', { name: /Clist 测试未来赛/ }).waitFor();
  const cfSiteFilter = page.getByRole('button', { name: /Codeforces/ });
  await cfSiteFilter.click();
  assert.equal(await page.getByRole('link', { name: /Clist 测试未来赛/ }).count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('stmt-settings-v1')).calendarSites.includes('codeforces.com')), false);
  await cfSiteFilter.click();
  await page.getByRole('link', { name: /Clist 测试未来赛/ }).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('stmt-settings-v1')).calendarSites.includes('codeforces.com')), true);

  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ac-ide', 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files', { keyPath: 'path' });
        if (!request.result.objectStoreNames.contains('view-history')) request.result.createObjectStore('view-history', { keyPath: ['platform', 'problemId'] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['files', 'view-history'], 'readwrite');
      tx.objectStore('files').put({ path: 'recent-work.cpp', name: 'recent-work.cpp', lang: 'cpp', content: 'int main() {}', updatedAt: Date.now() });
      tx.objectStore('view-history').put({
        platform: 'codeforces', problemId: '2000A', contestId: '2000',
        contestTitle: 'E2E Round 1', contestTitleZh: '端到端测试赛',
        title: 'Problem A', titleZh: '题目 A', url: '', firstSeen: Date.now(), lastSeen: Date.now(),
        totalDwellMs: 1000, lastJudge: { verdict: 'ac', at: Date.now() },
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('recent-work.cpp', { exact: true }).waitFor();
  assert.ok(await page.getByText('端到端测试赛', { exact: true }).count() >= 2);
  await page.locator('#custom-home-title').waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth + 1, undefined, { timeout: 1500 });

  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      current: { temperature_2m: 22.4, apparent_temperature: 23.1, relative_humidity_2m: 55, weather_code: 1, wind_speed_10m: 8.2 },
      current_units: { temperature_2m: '°C' },
      daily: { temperature_2m_min: [15], temperature_2m_max: [25] },
    }),
  }));
  await page.route('https://codeforces.com/api/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ status: 'OK', result: [{ handle: 'tourist', rating: 3408, maxRating: 4009, rank: 'legendary grandmaster', maxRank: 'legendary grandmaster' }] }),
  }));
  await page.goto(`${baseUrl}/settings#home`, { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: 'Codeforces Handle' }).fill('tourist');
  await page.locator('button').filter({ hasText: '竞赛仪表盘' }).click();
  await page.getByRole('button', { name: /保存并查看首页/ }).click();
  await page.waitForURL(`${baseUrl}/`);
  await page.getByText('3408', { exact: true }).waitFor();
  await page.getByText(/体感 23°C/).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log('首页 E2E 通过：经典页、12 预设、HTML 保存/持久化、XSS 净化、Clist 未来比赛列表、日历站点同步、历史/文件、天气/CF 数据、窄屏布局');
} finally {
  await browser.close();
}
