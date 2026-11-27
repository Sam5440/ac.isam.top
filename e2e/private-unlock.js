import assert from 'node:assert/strict';
import { chromium } from 'playwright';

/**
 * 私有化平台「30 天免密 + 带密码链接自动解锁」回归。
 *
 * 需要本地有 data/private/vault/ccpc-2026-xiamen.json，密码从 VAULT_TEST_PASSWORD 读。
 * 用法：BASE_URL=http://127.0.0.1:3467 VAULT_TEST_PASSWORD=xxx node e2e/private-unlock.js
 */

const base = process.env.BASE_URL || 'http://127.0.0.1:3467';
const password = process.env.VAULT_TEST_PASSWORD;
const contestId = process.env.VAULT_TEST_ID || 'ccpc-2026-xiamen';
const key = 'ac-private-unlock-v1';

if (!password) throw new Error('缺少 VAULT_TEST_PASSWORD');

const browser = await chromium.launch({ headless: true });
const issues = [];
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
page.on('pageerror', (e) => issues.push(e.message));
page.on('console', (m) => {
  // 本地没有 Vercel 分析脚本（404）与它的 beacon（连接被断），不算页面问题。
  if (m.type() === 'error' && !/Failed to load resource|Vercel/.test(m.text())) issues.push(m.text());
});

const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), key);
const noOverflow = async () => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `横向溢出 ${over}px`);
};

// 1) 入口页
await page.goto(`${base}/contests/private`, { waitUntil: 'networkidle' });
assert.match(await page.locator('h1').first().innerText(), /私有化/);
assert.equal(await page.locator(`a[href="/contests/private/${contestId}"]`).count(), 1);
assert.equal(await page.evaluate((k) => localStorage.getItem(k), key), null, '初始不应有免密记录');
await noOverflow();

// 2) 错密码 → 报错，且不写记录
await page.goto(`${base}/contests/private/${contestId}`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('输入密码…').fill('definitely-wrong');
await page.getByRole('button', { name: '解锁', exact: true }).click();
await page.waitForSelector('text=密码错误', { timeout: 15000 });
assert.deepEqual(await saved(), {});
await noOverflow();

// 3) 正确密码 → 解锁 13 题 + 写入 30 天记录
await page.getByPlaceholder('输入密码…').fill(password);
await page.getByRole('button', { name: '解锁', exact: true }).click();
await page.waitForSelector(`a[href="/contests/private/${contestId}/problems/A"]`, { timeout: 20000 });
assert.equal(await page.locator(`a[href^="/contests/private/${contestId}/problems/"]`).count(), 13);
const record = (await saved())[contestId];
assert.ok(record, '应写入免密记录');
assert.equal(record.password, password);
const days = (record.expiresAt - Date.now()) / 86_400_000;
assert.ok(days > 29.9 && days <= 30, `有效期应为 30 天，实际 ${days.toFixed(2)}`);
await noOverflow();

// 4) 刷新 → 免密自动解锁，无需再输密码
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector(`a[href="/contests/private/${contestId}/problems/A"]`, { timeout: 20000 });
assert.equal(await page.getByPlaceholder('输入密码…').count(), 0);
await noOverflow();

// 5) 复制带密码链接
await page.evaluate(() => {
  const original = navigator.clipboard.writeText.bind(navigator.clipboard);
  window.__copied = [];
  navigator.clipboard.writeText = async (text) => {
    window.__copied.push(text);
    return original(text);
  };
});
await page.getByRole('button', { name: '复制带密码链接' }).click();
await page.waitForSelector('text=已复制');
const [share] = await page.evaluate(() => window.__copied);
assert.match(share, new RegExp(`/contests/private/${contestId}#p=v1\\.[A-Za-z0-9_-]+$`));
assert.equal(share.includes(password), false, '链接里不应出现明文密码');

// 6) 新浏览器上下文打开带密码链接 → 自动解锁，且地址栏里的 #p= 被抹掉
const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const freshPage = await fresh.newPage();
freshPage.on('pageerror', (e) => issues.push(e.message));
await freshPage.goto(share, { waitUntil: 'networkidle' });
await freshPage.waitForSelector(`a[href="/contests/private/${contestId}/problems/A"]`, { timeout: 20000 });
assert.equal(await freshPage.getByPlaceholder('输入密码…').count(), 0);
await freshPage.waitForFunction(() => !window.location.hash.includes('p='), null, { timeout: 5000 });
// 用链接打开等同明确解锁，也会写入 30 天记录（与勾选框默认值一致）。
const freshRecord = await freshPage.evaluate(
  ({ k, id }) => JSON.parse(localStorage.getItem(k) || '{}')[id],
  { k: key, id: contestId },
);
assert.equal(freshRecord?.password, password);

// 7) 带密码链接直接落到题目页
await freshPage.goto(`${share.replace(`/contests/private/${contestId}`, `/contests/private/${contestId}/problems/C`)}`, {
  waitUntil: 'networkidle',
});
await freshPage.waitForSelector('text=样例', { timeout: 20000 });
await freshPage.waitForFunction(() => !window.location.hash.includes('p='), null, { timeout: 5000 });
await fresh.close();

// 8) 重新上锁 → 清掉本机记录，回到解锁卡
await page.getByRole('button', { name: '重新上锁' }).click();
await page.waitForSelector('text=这场比赛的题面是加密的');
assert.deepEqual(await saved(), {});
await page.reload({ waitUntil: 'networkidle' });
assert.equal(await page.getByPlaceholder('输入密码…').count(), 1, '上锁后刷新应需要重新输入');

// 9) 首页「清除本机记住的密码」
await page.getByPlaceholder('输入密码…').fill(password);
await page.getByRole('button', { name: '解锁', exact: true }).click();
await page.waitForSelector(`a[href="/contests/private/${contestId}/problems/A"]`, { timeout: 20000 });
await page.goto(`${base}/contests/private`, { waitUntil: 'networkidle' });
assert.match(await page.getByRole('button', { name: '清除本机记住的密码' }).innerText(), /清除/);
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: '清除本机记住的密码' }).click();
await page.waitForFunction((k) => localStorage.getItem(k) == null, key);
await noOverflow();

await browser.close();
assert.deepEqual(issues, [], `页面报错：${issues.join(' | ')}`);
console.log('private-unlock e2e: ok');
