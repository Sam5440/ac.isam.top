import assert from 'node:assert/strict';
import { chromium } from 'playwright';

/**
 * 题目页 IDE 布局回归：
 *  1. 中间分栏手柄可拖动（题目 / IDE 宽度互换），双击恢复 50vw；
 *  2. 文件管理在左、样例测试在右；题目页默认右侧样例栏以最小宽度展开；
 *  3. 打开题目时自动创建的代码文件带默认模板（不再空白）。
 */

const base = process.env.BASE_URL || 'http://127.0.0.1:3096';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const issues = [];
page.on('pageerror', (e) => issues.push(e.message));

const panelWidth = () => page.evaluate(() => {
  const panel = document.getElementById('compiler-panel');
  const shell = document.querySelector('.site-shell');
  return {
    panel: panel ? Math.round(panel.getBoundingClientRect().width) : null,
    shell: shell ? Math.round(shell.getBoundingClientRect().width) : null,
    viewport: window.innerWidth,
  };
});

try {
  await page.goto(`${base}/problems/codeforces/2289B`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#compiler-panel .monaco-editor', { timeout: 90_000 });
  await page.waitForTimeout(1500);

  // ---------- 3. 默认代码模板 ----------
  await page.waitForFunction(
    () => document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('bits/stdc++'),
    null,
    { timeout: 90_000 },
  );

  // ---------- 2. 布局：右侧样例默认展开、左侧文件 ----------
  const right = page.locator('aside[aria-label="右侧栏"]');
  assert.equal(await right.count(), 1, '右侧栏应默认展开');
  const rightTab = right.locator('[role="tab"][aria-selected="true"]');
  assert.ok((await rightTab.textContent())?.trim().startsWith('样例'), '右侧栏默认标签应为样例');
  const rightW = await right.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  assert.ok(rightW >= 200 && rightW <= 224, `右侧栏应以最小宽度展开，实际 ${rightW}px`);
  assert.equal(await page.locator('aside[aria-label="左侧栏"]').count(), 0, '左侧栏默认收起');

  await page.locator('button[title="切换左侧栏 (⌘B)"]').click();
  await page.waitForTimeout(400);
  const left = page.locator('aside[aria-label="左侧栏"]');
  assert.equal(await left.count(), 1, '左侧栏应能打开');
  assert.ok((await left.locator('[role="tab"][aria-selected="true"]').textContent())?.trim().startsWith('文件'), '左侧栏默认标签应为文件');

  // ---------- 1. 分栏拖拽 ----------
  const before = await panelWidth();
  assert.ok(Math.abs(before.panel - before.viewport / 2) <= 4, `初始分栏应为 50vw：${JSON.stringify(before)}`);
  const handle = page.locator('#compiler-panel [role="separator"][aria-label="拖动调整题目与 IDE 宽度"]');
  const box = await handle.boundingBox();
  assert.ok(box, '未找到分栏手柄');
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + 300, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await panelWidth();
  assert.ok(after.panel >= before.panel + 100 && after.panel <= before.panel + 140, `拖动后 IDE 应变宽：${JSON.stringify({ before, after })}`);
  assert.ok(after.shell < before.shell, `题目列应同步变窄：${JSON.stringify({ before, after })}`);

  await handle.dblclick();
  await page.waitForTimeout(500);
  const reset = await panelWidth();
  assert.ok(Math.abs(reset.panel - reset.viewport / 2) <= 6, `双击应恢复 50vw：${JSON.stringify(reset)}`);

  await page.screenshot({ path: '/tmp/problem-ide-layout.png' });

  // ---------- /ide 默认布局：文件在左、样例在右 ----------
  await page.goto(`${base}/ide`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.monaco-editor', { timeout: 90_000 });
  const ideTabs = await page.evaluate(() =>
    [...document.querySelectorAll('aside')].map((el) => ({
      side: el.getAttribute('aria-label'),
      tab: el.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? '',
    })),
  );
  assert.ok(ideTabs.some((t) => t.side === '左侧栏' && t.tab.startsWith('文件')), `/ide 左侧应为文件：${JSON.stringify(ideTabs)}`);
  assert.ok(ideTabs.some((t) => t.side === '右侧栏' && t.tab.startsWith('样例')), `/ide 右侧应为样例：${JSON.stringify(ideTabs)}`);

  assert.deepEqual(issues, [], `页面报错：${issues.join('; ')}`);
  console.log('题目页 IDE 布局/模板回归通过');
} finally {
  await browser.close();
}