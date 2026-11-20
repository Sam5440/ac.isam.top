import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const base = process.env.BASE_URL || 'http://127.0.0.1:3096';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const issues = [];
page.on('pageerror', (error) => issues.push(error.message));
try {
  await page.clock.install();
  await page.goto(`${base}/simulator`, { waitUntil: 'networkidle' });
  await page.getByLabel('题目列表').fill([
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
  ].join('\n'));
  await page.getByRole('button', { name: '解析并核验题目' }).click();
  await page.getByRole('status').filter({ hasText: '已解析 15 题' }).waitFor();
  await page.locator('a').filter({ hasText: '题库无此题' }).first().waitFor();
  const gymHref = await page.locator('a[href="https://codeforces.com/gym/105481/problem/A"]').getAttribute('href');
  assert.equal(gymHref, 'https://codeforces.com/gym/105481/problem/A');
  assert.equal(await page.locator('[aria-label="比赛题目"] > div').count(), 15);

  const entryHref = await page.getByRole('link', { name: '进入比赛' }).getAttribute('href');
  assert.match(entryHref, /^\/contests\/codeforces\/sim-[A-Za-z0-9_-]+#data=/);
  await page.getByRole('link', { name: '进入比赛' }).click();
  await page.getByText('自定义模拟赛', { exact: true }).waitFor();
  assert.equal(await page.locator('[aria-label="比赛题目"] > a').count(), 15);
  assert.equal(await page.locator('a[href="https://codeforces.com/gym/105481/problem/A"]').count(), 1);
  await page.goBack();
  await page.getByLabel('题目列表').waitFor();

  const normalContest = await browser.newPage();
  await normalContest.goto(`${base}/contests/codeforces/2285`, { waitUntil: 'networkidle' });
  await normalContest.getByText('第 1135 场 Codeforces Round（Div. 2）', { exact: true }).waitFor();
  assert.equal(await normalContest.getByText('自定义模拟赛', { exact: true }).count(), 0);
  await normalContest.close();

  await page.getByLabel('比赛名称').fill('E2E 计时赛');
  await page.getByLabel('限时（分钟）').fill('1');
  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.getByRole('button', { name: /开始本题/ }).first().click();
  await page.clock.fastForward(5000);
  await page.getByRole('button', { name: '暂停计时' }).click();
  const elapsed = await page.getByLabel('比赛计时').innerText();
  assert.notEqual(elapsed, '00:00:00');
  await page.clock.fastForward(90000);
  assert.equal(await page.getByLabel('比赛计时').innerText(), elapsed, '暂停后计时保持不变');
  await page.getByRole('button', { name: '保存比赛' }).click();
  await page.getByRole('button', { name: /新建模拟赛/ }).click();
  await page.getByLabel('比赛名称').fill('第二场练习');
  await page.getByLabel('题目列表').fill('CF | 1519B | 2 | 测试别名');
  await page.getByRole('button', { name: '解析并核验题目' }).click();
  await page.getByRole('button', { name: '保存比赛' }).click();
  await page.reload();
  await page.getByRole('button', { name: /^E2E 计时赛/ }).click();
  assert.equal(await page.getByLabel('比赛计时').innerText(), elapsed);

  await page.getByRole('button', { name: '继续比赛' }).click();
  await page.clock.fastForward(120000);
  await page.getByText('时间到', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('比赛计时').innerText(), '00:01:00');
  const firstRow = page.locator('[aria-label="比赛题目"] > div').first();
  const problemTime = await firstRow.locator('.tabular-nums').innerText();
  await firstRow.getByLabel('标记完成').click();
  const alias = '道路是曲折的，前途是光明的';
  for (const enabled of [true, false]) {
    await page.getByLabel('分享时带上题目别名').setChecked(enabled);
    await page.getByRole('button', { name: '复制当场链接' }).click();
    await page.getByRole('status').filter({ hasText: '比赛链接已复制' }).waitFor();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(url, new RegExp(`^${base}/contests/codeforces/sim-[A-Za-z0-9_-]+#data=`));
    const recipient = await browser.newPage();
    await recipient.goto(url);
    await recipient.getByText('自定义模拟赛', { exact: true }).waitFor();
    await recipient.locator('[aria-label="比赛题目"] > a').first().waitFor();
    assert.equal(await recipient.getByText(alias, { exact: true }).count() > 0, enabled);
    assert.equal(await recipient.locator('[aria-label="比赛题目"] > a').count(), 15);
    await recipient.close();
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全部比赛日志' }).click();
  const md = await readFile(await (await download).path(), 'utf8');
  assert.match(md, /## 第二场练习/); assert.match(md, /## E2E 计时赛/);
  assert.match(md, /总用时：00:01:00/); assert.ok(md.includes(`| ${problemTime} | 完成 |`));
  assert.ok(!md.includes(alias) && !md.includes('测试别名'));
  assert.deepEqual(issues, []);
  console.log('模拟赛 E2E 通过：15 题校验、Gym 原题链接、比赛/单题计时、暂停、多场保存、别名省略 URL 分享');
} finally { await browser.close(); }
