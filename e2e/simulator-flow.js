import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const base = process.env.BASE_URL || 'http://127.0.0.1:3096';
const storeKey = 'ac-simulator-contests-v1';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const issues = [];
page.on('pageerror', (error) => issues.push(error.message));
const rows = [
  'CodeForces | 1519B | 1 | 道路是曲折的，前途是光明的',
  'CodeForces | 1582F1 | 1 | 补-不简单的签到题easy version',
  'CodeForces | 1582F2 | 1 | 很困难的签到题hard version',
  'CodeForces | 1624C | 1 | 补-世间所有的相遇，都是久别重逢',
  'Gym | 105481A | 1 | 在无数次重复中，依然忠实于最初的逻辑',
  'CodeForces | 1992A | 1 | 咖啡不断加加加加加到厌倦',
  'CodeForces | 1106D | 1 | 补-图图～是个聪明的小孩',
  'CodeForces | 651C | 1 | 麦田里的守望者',
  'CodeForces | 233B | 1 | 愿你在有序的世界里遇见唯一的答案',
  'Gym | 105485H | 1 | 蓦然回首 xcpc却在灯火阑珊处',
  'CodeForces | 1560D | 1 | 每一步都算数',
  'CodeForces | 1245C | 1 | 补-每一个uu里 都藏着一个w',
  'CodeForces | 1703A | 1 | ',
  'AtCoder | abc034_b | 1 | ',
  '牛客 | 25005 | 1 | ',
];
const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), storeKey);
const assertNoOverflow = async () => {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 12).map((element) => ({ tag: element.tagName, className: String(element.className).slice(0, 100), right: element.getBoundingClientRect().right })),
  }));
  assert.ok(dimensions.content <= dimensions.viewport + 1, `横向溢出 ${JSON.stringify(dimensions)}`);
};

try {
  const startTime = new Date('2026-01-01T12:00:00Z');
  await page.clock.install({ time: startTime });
  await page.clock.pauseAt(startTime);
  await page.goto(`${base}/simulator`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建比赛' }).click();
  await page.getByLabel('比赛名称').fill('E2E 计时赛');
  await page.getByLabel('限时（分钟）').fill('1');
  await page.getByLabel('题目列表').fill(rows.join('\n'));
  await page.getByRole('button', { name: '解析并核验题目' }).click();
  await page.getByRole('status').filter({ hasText: '已解析 15 题' }).waitFor();
  assert.equal(await page.locator('[aria-label="已核验题目"] > div').count(), 15);
  await page.getByRole('button', { name: '保存并进入比赛' }).click();
  await page.getByText('自定义模拟赛', { exact: true }).waitFor();
  const detailUrl = page.url();
  assert.match(detailUrl, /\/contests\/sim\/[A-Za-z0-9_-]+#data=/);
  assert.equal(await page.locator('[aria-label="比赛题目"] > a').count(), 15);
  assert.equal(await page.locator('[aria-label="比赛题目"] > a').first().getByText('道路是曲折的，前途是光明的', { exact: true }).count(), 1);
  for (const label of ['翻译程度', '抓取程度', '平均评级']) await page.getByText(label, { exact: true }).waitFor();

  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.clock.fastForward(4000);
  await page.locator('[aria-label="比赛题目"] > a').first().click();
  await page.getByRole('link', { name: /返回模拟赛/ }).waitFor();
  assert.match(page.url(), /\/problems\/1#data=/);
  await page.getByRole('button', { name: '开始本题' }).click();
  await page.clock.fastForward(5000);
  assert.equal(await page.getByLabel('比赛计时', { exact: true }).innerText(), '00:00:09');
  await page.getByRole('button', { name: '标记完成' }).click();
  await page.getByRole('link', { name: /返回模拟赛/ }).click();
  await page.waitForURL(/\/contests\/sim\/[^/]+#data=/);
  await page.getByRole('button', { name: '暂停计时' }).click();
  const paused = await page.getByLabel('比赛计时', { exact: true }).innerText();
  assert.equal(paused, '00:00:09');
  await page.clock.fastForward(90000);
  assert.equal(await page.getByLabel('比赛计时', { exact: true }).innerText(), paused);
  await page.reload();
  await page.getByRole('button', { name: '继续比赛' }).waitFor();
  assert.equal(await page.getByLabel('比赛计时', { exact: true }).innerText(), paused);
  await page.getByRole('button', { name: '继续比赛' }).click();
  await page.clock.fastForward(120000);
  await page.getByText('时间到', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('比赛计时', { exact: true }).innerText(), '00:01:00');

  await page.getByLabel('分享时带上题目别名').uncheck();
  await page.getByRole('button', { name: '复制当场链接' }).click();
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  const recipient = await browser.newContext();
  const sharedPage = await recipient.newPage();
  await sharedPage.goto(shareUrl);
  await sharedPage.getByText('自定义模拟赛', { exact: true }).waitFor();
  await sharedPage.locator('[aria-label="比赛题目"] > a').first().waitFor();
  assert.equal(await sharedPage.getByText('道路是曲折的，前途是光明的', { exact: true }).count(), 0);
  assert.equal(await sharedPage.getByLabel('比赛计时', { exact: true }).innerText(), '00:00:00');
  await recipient.close();

  await page.goto(`${base}/simulator`);
  await page.getByRole('button', { name: '管理比赛' }).click();
  await page.getByLabel('选择 E2E 计时赛').check();
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出比赛', exact: true }).click();
  const exported = await readFile(await (await exportDownload).path());
  const logDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出比赛日志' }).click();
  const log = await readFile(await (await logDownload).path(), 'utf8');
  assert.match(log, /总用时：00:01:00/);
  assert.match(log, /00:00:05 \| 完成/);
  await page.getByLabel('导入比赛文件').setInputFiles({ name: '模拟赛.json', mimeType: 'application/json', buffer: exported });
  await page.getByRole('status').filter({ hasText: '已导入 1 场比赛' }).waitFor();
  const imported = await saved();
  assert.equal(imported.length, 2);
  assert.notEqual(imported[0].id, imported[1].id);
  assert.equal(imported[0].elapsedMs, 60000);
  assert.equal(imported[0].completed['codeforces:1519b'], true);
  await page.locator('a.contest-row').first().click();
  await page.getByText('时间到', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('比赛计时', { exact: true }).innerText(), '00:01:00');
  await page.goto(`${base}/simulator`);
  await page.getByRole('button', { name: '管理比赛' }).click();
  await page.getByRole('button', { name: '全选筛选结果' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除所选' }).click();
  assert.equal((await saved()).length, 0);

  await page.getByRole('button', { name: '完成管理' }).click();
  await page.getByRole('button', { name: '新建比赛' }).click();
  await page.getByLabel('比赛名称').fill('重复题测试');
  await page.getByLabel('题目列表').fill('CF | 1519B | 1 | 第一题\nCF | 1519B | 1 | 重复题\nAtCoder | abc034_b | 1 | 第三题\nCF | 999999999A | 1 | 题库尚未收录');
  await page.getByRole('button', { name: '解析并核验题目' }).click();
  await page.getByRole('status').filter({ hasText: '已解析 4 题' }).waitFor();
  await page.getByRole('button', { name: '保存并进入比赛' }).click();
  await page.getByText('自定义模拟赛', { exact: true }).waitFor();
  assert.equal(await page.locator('a[href="https://codeforces.com/problemset/problem/999999999/A"]').count(), 1);
  await page.locator('[aria-label="比赛题目"] > a').nth(1).click();
  await page.getByLabel('切换题目').waitFor();
  assert.equal(await page.getByLabel('切换题目').inputValue(), '1');
  await page.getByLabel('选择题目').waitFor();
  assert.equal(await page.getByLabel('选择题目').inputValue(), '1');
  await page.getByRole('button', { name: /样例管理/ }).click();
  const firstSamples = await (await page.request.get(`${base}/api/problems/codeforces/1519B`)).json();
  await page.getByLabel('样例 1 输入').waitFor();
  assert.equal(await page.getByLabel('样例 1 输入').inputValue(), firstSamples.samples[0].input);
  await page.getByLabel('选择题目').selectOption('2');
  const otherSamples = await (await page.request.get(`${base}/api/problems/atcoder/abc034_b`)).json();
  await page.waitForFunction((expected) => document.querySelector('[aria-label="样例 1 输入"]')?.value === expected, otherSamples.samples[0].input);
  await page.getByLabel('样例 1 输入').fill('模拟赛专用样例');
  await page.getByLabel('选择题目').selectOption('1');
  await page.getByLabel('选择题目').selectOption('2');
  assert.equal(await page.getByLabel('样例 1 输入').inputValue(), '模拟赛专用样例');
  await page.getByLabel('选择题目').selectOption('1');
  await page.getByLabel('切换题目').selectOption('2');
  await page.waitForURL(/\/problems\/3#/);
  await page.getByLabel('选择题目').waitFor();
  assert.equal(await page.getByLabel('选择题目').inputValue(), '2');
  await page.getByLabel('题号切换').getByRole('link', { name: '2', exact: true }).click();
  await page.waitForURL(/\/problems\/2#/);
  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.getByRole('button', { name: '开始本题' }).click();
  await page.clock.fastForward(3000);
  await page.getByRole('button', { name: '标记完成' }).click();
  await page.getByRole('link', { name: /返回模拟赛/ }).click();
  await page.waitForURL(/\/contests\/sim\/[^/]+#data=/);
  await page.getByRole('button', { name: '暂停计时' }).click();
  await page.getByRole('link', { name: '比赛设置' }).click();
  await page.getByLabel('题目列表').fill('CF | 1519B | 1 | 重复题\nAtCoder | abc034_b | 1 | 第三题');
  await page.getByRole('button', { name: '解析并核验题目' }).click();
  await page.getByRole('status').filter({ hasText: '已解析 2 题' }).waitFor();
  await page.getByRole('button', { name: '保存并进入比赛' }).click();
  await page.getByText('自定义模拟赛', { exact: true }).waitFor();
  const edited = (await saved())[0];
  assert.equal(edited.problemTimes['codeforces:1519b'], 3000);
  assert.equal(edited.completed['codeforces:1519b'], true);
  assert.equal(edited.problemTimes['codeforces:1519b:1'], undefined);
  await page.locator('[aria-label="比赛题目"] > a').first().click();
  await page.getByRole('link', { name: /返回模拟赛/ }).waitFor();
  await page.getByRole('button', { name: '收起编译器' }).first().click();

  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.runFor(1500);
    await assertNoOverflow();
    await page.getByRole('link', { name: /返回模拟赛/ }).click();
    await page.waitForURL(/\/contests\/sim\/[^/]+#data=/);
    await page.getByRole('button', { name: '继续比赛' }).waitFor();
    await assertNoOverflow();
    await page.goto(`${base}/simulator`);
    await page.getByRole('button', { name: '新建比赛' }).waitFor();
    await assertNoOverflow();
    await page.goBack();
    await page.locator('[aria-label="比赛题目"] > a').first().click();
    await page.getByRole('link', { name: /返回模拟赛/ }).waitFor();
  }

  const legacyContext = await browser.newContext();
  const legacyPage = await legacyContext.newPage();
  const shareData = new URL(shareUrl).hash.slice(1);
  await legacyPage.goto(`${base}/simulator#${shareData}`);
  await legacyPage.getByLabel('题目列表').waitFor();
  assert.equal((await legacyPage.getByLabel('题目列表').inputValue()).split('\n').length, 15);
  await legacyPage.getByRole('button', { name: '解析并核验题目' }).click();
  await legacyPage.getByRole('status').filter({ hasText: '已解析 15 题' }).waitFor();
  await legacyPage.getByRole('button', { name: '保存并进入比赛' }).click();
  await legacyPage.getByText('自定义模拟赛', { exact: true }).waitFor();
  assert.equal(await legacyPage.locator('[aria-label="比赛题目"] > a').count(), 15);
  await legacyPage.goto(`${base}/simulator?${shareData}`);
  await legacyPage.getByLabel('题目列表').waitFor();
  assert.equal((await legacyPage.getByLabel('题目列表').inputValue()).split('\n').length, 15);
  await legacyContext.close();

  const listContext = await browser.newContext();
  const listPage = await listContext.newPage();
  const listFixture = Array.from({ length: 51 }, (_, index) => ({
    ...edited,
    id: `pagination-${index}`,
    name: `分页比赛 ${String(index).padStart(2, '0')}`,
  }));
  await listPage.addInitScript(({ key, contests }) => localStorage.setItem(key, JSON.stringify(contests)), { key: storeKey, contests: listFixture });
  await listPage.goto(`${base}/simulator`);
  await listPage.getByText('51 场', { exact: true }).waitFor();
  assert.equal(await listPage.locator('a.contest-row').count(), 50);
  await listPage.getByRole('button', { name: '下一页' }).click();
  assert.equal(await listPage.locator('a.contest-row').count(), 1);
  await listPage.getByRole('button', { name: '上一页' }).click();
  assert.equal(await listPage.locator('a.contest-row').count(), 50);
  await listPage.getByLabel('搜索比赛名称或编号').fill('分页比赛 50');
  await listPage.getByText('1 场', { exact: true }).waitFor();
  assert.equal(await listPage.locator('a.contest-row').count(), 1);
  await listPage.getByRole('button', { name: '管理比赛' }).click();
  await listPage.getByRole('button', { name: '全选筛选结果' }).click();
  await listPage.getByText('已选 1 场', { exact: true }).waitFor();
  listPage.once('dialog', (dialog) => dialog.accept());
  await listPage.getByRole('button', { name: '删除所选' }).click();
  await listPage.getByLabel('搜索比赛名称或编号').clear();
  await listPage.getByText('50 场', { exact: true }).waitFor();
  await listContext.close();

  assert.deepEqual(issues, []);
  console.log('模拟赛 E2E 通过，覆盖 15 题、计时、分享、导入导出、重复题、分页搜索与移动端布局。');
} catch (error) {
  console.error('失败时页面地址', page.url());
  console.error('失败时页面内容', (await page.locator('body').innerText()).slice(0, 2500));
  throw error;
} finally {
  await browser.close();
}
