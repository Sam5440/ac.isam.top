import assert from 'node:assert/strict';
import { chromium } from 'playwright';

/**
 * IDE 界面状态持久化回归（与 e2e/ide-tabs.js 互补）：
 *  1. 题目页 IDE 关掉后刷新不再自动弹出；重新打开后保持；
 *  2. 题目 / IDE 分栏宽度刷新后保持；
 *  3. 嵌入 IDE 的侧栏开合刷新后保持（右侧样例栏关掉不会自己回来）；
 *  4. Markdown 模式与分屏比例刷新后保持；
 *  5. 文件管理里展开的文件夹刷新后保持；
 *  6. 快速打开的「最近文件」刷新后保持排序。
 */

const base = process.env.BASE_URL || 'http://127.0.0.1:3096';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const issues = [];
page.on('pageerror', (e) => issues.push(e.message));

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const panelWidth = () => page.evaluate(() => Math.round(document.getElementById('compiler-panel')?.getBoundingClientRect().width ?? 0));
const editorTab = (text) =>
  page.locator('[aria-label="代码编辑器"] [role="tablist"] [role="tab"]', { hasText: text }).first();
const mdSection = () => page.locator('section[aria-label="Markdown 工作台"]');

try {
  await page.goto(`${base}/problems/codeforces/2289B`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#compiler-panel .monaco-editor', { timeout: 90_000 });
  await page.waitForTimeout(1200);

  // ---------- 3. 嵌入布局：关掉右侧样例栏、打开左侧文件栏 ----------
  assert.equal(await page.locator('aside[aria-label="右侧栏"]').count(), 1, '首次进入右侧样例栏应展开');
  await page.locator('[title="切换右侧栏 (⌥⌘B)"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('aside[aria-label="右侧栏"]').count(), 0, '右侧栏应能关闭');
  await page.locator('[title="切换左侧栏 (⌘B)"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('aside[aria-label="左侧栏"]').count(), 1, '左侧栏应能打开');

  // ---------- 1. 关闭 IDE → 刷新保持关闭 ----------
  await page.locator('#compiler-panel button[aria-label="关闭 IDE"]').click();
  await page.waitForTimeout(500);
  assert.ok(!(await page.evaluate(() => document.body.classList.contains('compiler-open'))), '关闭后应移除分栏');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  assert.ok(
    !(await page.evaluate(() => document.body.classList.contains('compiler-open'))),
    '关掉的 IDE 刷新后不应自动展开',
  );
  assert.equal(await page.getByRole('button', { name: '展开 IDE' }).getAttribute('aria-expanded'), 'false');

  // 重新打开：侧栏开合状态也应保持
  await page.getByRole('button', { name: '展开 IDE' }).click();
  await page.waitForSelector('#compiler-panel .monaco-editor', { timeout: 90_000 });
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('aside[aria-label="左侧栏"]').count(), 1, '左侧栏打开状态应保持');
  assert.equal(await page.locator('aside[aria-label="右侧栏"]').count(), 0, '右侧栏关闭状态应保持');

  // ---------- 2. 分栏宽度 → 刷新保持 ----------
  const before = await panelWidth();
  const handle = page.locator('#compiler-panel [role="separator"][aria-label="拖动调整题目与 IDE 宽度"]');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 240);
  await page.mouse.down();
  await page.mouse.move(box.x - 140, box.y + 240, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await panelWidth();
  assert.ok(after >= before + 120, `拖动后应明显变宽：${before} → ${after}`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#compiler-panel .monaco-editor', { timeout: 90_000 });
  await page.waitForTimeout(1200);
  const restored = await panelWidth();
  assert.ok(Math.abs(restored - after) <= 8, `分栏宽度刷新后应保持：${after} → ${restored}`);

  // ---------- 4. Markdown 模式 + 分屏比例 ----------
  await editorTab('.md').click();
  await mdSection().waitFor({ timeout: 60_000 });
  await mdSection().getByRole('button', { name: '预览', exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal(await mdSection().locator('.monaco-editor').count(), 0, '预览模式不应有 Monaco');

  await page.reload({ waitUntil: 'networkidle' });
  await mdSection().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1000);
  assert.equal(await mdSection().locator('.monaco-editor').count(), 0, '预览模式刷新后应保持');

  await mdSection().getByRole('button', { name: '分屏', exact: true }).click();
  const splitter = mdSection().locator('[aria-label="调整原文与预览宽度"]');
  await splitter.waitFor({ timeout: 60_000 });
  await splitter.focus();
  for (let i = 0; i < 5; i += 1) await splitter.press('ArrowRight');
  await page.waitForTimeout(300);
  assert.equal(Number(await splitter.getAttribute('aria-valuenow')), 60);

  await page.reload({ waitUntil: 'networkidle' });
  await mdSection().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1000);
  assert.equal(
    Number(await mdSection().locator('[aria-label="调整原文与预览宽度"]').getAttribute('aria-valuenow')),
    60,
    '分屏比例刷新后应保持',
  );

  // ---------- 6. 最近文件 ----------
  await page.keyboard.press(`${MOD}+p`);
  await page.getByRole('dialog', { name: '快速打开' }).waitFor();
  const first = await page.locator('[role="listbox"] [role="option"]').first().innerText();
  assert.ok(first.includes('.md'), `最近文件应把 B.md 排在首位：${first}`);
  assert.ok(first.includes('最近打开'), '最近文件应带「最近打开」标记');
  await page.keyboard.press('Escape');

  // ---------- 5. 展开的文件夹 ----------
  const left = page.locator('aside[aria-label="左侧栏"]');
  assert.equal(await left.count(), 1, '左侧栏应保持打开');
  // IDE 面板随页面滚动可能离开视口，回到顶部再点文件夹
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => document.body.classList.contains('compiler-open')), 'IDE 应保持展开');
  const folder = left.locator('[role="treeitem"][aria-expanded="false"]').first();
  assert.equal(await folder.count(), 1, '工作区应有未展开的文件夹');
  await folder.scrollIntoViewIfNeeded();
  const folderName = (await folder.innerText()).split('\n')[0].trim();
  await folder.locator('div').first().click();
  await page.waitForTimeout(300);
  const opened = left.locator('[role="treeitem"][aria-expanded="true"]').filter({ hasText: folderName });
  assert.ok((await opened.count()) >= 1, `点击后文件夹应展开：${folderName}`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const sameFolder = page
    .locator('aside[aria-label="左侧栏"] [role="treeitem"]')
    .filter({ hasText: folderName })
    .first();
  assert.equal(await sameFolder.getAttribute('aria-expanded'), 'true', `展开的文件夹刷新后应保持：${folderName}`);

  assert.deepEqual(issues, [], `页面报错：${issues.join('; ')}`);
  console.log('IDE 界面状态持久化回归通过');
} finally {
  await browser.close();
}