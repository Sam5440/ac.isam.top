import assert from 'node:assert/strict';
import { chromium } from 'playwright';

/**
 * IDE 标签栏持久化回归（lib/ide-tabs.js）：
 *  1. 题目页：关掉的标签（含自动生成的 .md）刷新后不再回来；
 *  2. 关掉所有标签后刷新保持空标签栏（显示「新建文件」欢迎页）；
 *  3. 换一道没打开过的题仍会自动铺开它的 .cpp 与 .md；
 *  4. /ide：关闭的标签刷新后同样保持关闭。
 */

const base = process.env.BASE_URL || 'http://127.0.0.1:3096';
const browser = await chromium.launch({ headless: true });

/** 编辑器标签栏（排除侧栏里的「样例 / 文件」等模块标签）。 */
const editorTabs = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[aria-label="代码编辑器"] [role="tablist"] [role="tab"]')].map((el) =>
      el.textContent.trim(),
    ),
  );

const closeTab = async (page, text) => {
  const tab = page.locator('[aria-label="代码编辑器"] [role="tablist"] [role="tab"]', { hasText: text }).first();
  if (!(await tab.count())) return false;
  await tab.hover();
  await tab.locator('button[aria-label^="关闭"]').click();
  return true;
};

const waitEditor = (page) => page.waitForSelector('[aria-label="代码编辑器"] .monaco-editor', { timeout: 90_000 });

const issues = [];
try {
  // ---------- 1~3：题目页 ----------
  const problemCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await problemCtx.newPage();
  page.on('pageerror', (e) => issues.push(`problem: ${e.message}`));

  await page.goto(`${base}/problems/codeforces/2289B`, { waitUntil: 'networkidle' });
  await waitEditor(page);
  // 首次打开：题目工作区自动铺开 B.cpp + B.md
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[aria-label="代码编辑器"] [role="tablist"] [role="tab"]')].some((el) =>
        el.textContent.includes('.md'),
      ),
    null,
    { timeout: 90_000 },
  );
  assert.ok((await editorTabs(page)).some((t) => t.includes('B.cpp')), '首次打开应自动打开 B.cpp');

  assert.ok(await closeTab(page, '.md'), '应能关闭 B.md');
  assert.ok(await closeTab(page, 'main.cpp'), '应能关闭 main.cpp');
  const closed = await editorTabs(page);
  assert.equal(closed.length, 1, `关闭后应只剩一个标签：${JSON.stringify(closed)}`);
  assert.ok(closed[0].includes('B.cpp'), `关闭后应只剩 B.cpp：${JSON.stringify(closed)}`);

  await page.reload({ waitUntil: 'networkidle' });
  await waitEditor(page);
  await page.waitForTimeout(1500);
  const restored = await editorTabs(page);
  assert.equal(restored.length, 1, `刷新后应只恢复一个标签：${JSON.stringify(restored)}`);
  assert.ok(restored[0].includes('B.cpp'), '刷新后关掉的 .md / main.cpp 不应再出现');

  // 关掉所有标签 → 刷新后保持空标签栏
  assert.ok(await closeTab(page, 'B.cpp'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  assert.deepEqual(await editorTabs(page), [], '关掉所有标签后刷新应保持空标签栏');
  assert.ok(await page.getByText('新建文件', { exact: true }).isVisible(), '空标签栏应显示欢迎页');

  // 换一道没打开过的题：仍会自动铺开它的 .cpp / .md
  await page.goto(`${base}/problems/codeforces/2289C`, { waitUntil: 'networkidle' });
  await waitEditor(page);
  await page.waitForFunction(
    () => {
      const tabs = [...document.querySelectorAll('[aria-label="代码编辑器"] [role="tablist"] [role="tab"]')].map(
        (el) => el.textContent,
      );
      return tabs.some((t) => t.includes('C.cpp')) && tabs.some((t) => t.includes('.md'));
    },
    null,
    { timeout: 90_000 },
  );

  await problemCtx.close();

  // ---------- 4：/ide ----------
  const ideCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ide = await ideCtx.newPage();
  ide.on('pageerror', (e) => issues.push(`ide: ${e.message}`));
  await ide.goto(`${base}/ide`, { waitUntil: 'networkidle' });
  await waitEditor(ide);
  await ide.waitForTimeout(1500);
  assert.ok((await editorTabs(ide)).some((t) => t.includes('main.cpp')), '/ide 首次应打开 main.cpp');
  assert.ok(await closeTab(ide, 'main.cpp'));
  assert.deepEqual(await editorTabs(ide), []);
  await ide.reload({ waitUntil: 'networkidle' });
  await ide.waitForTimeout(2500);
  assert.deepEqual(await editorTabs(ide), [], '/ide 关闭的标签刷新后不应再出现');
  await ideCtx.close();

  assert.deepEqual(issues, [], `页面报错：${issues.join('; ')}`);
  console.log('IDE 标签栏持久化回归通过');
} finally {
  await browser.close();
}