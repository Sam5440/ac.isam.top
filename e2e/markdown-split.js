import assert from 'node:assert/strict';
import { chromium } from 'playwright';

/**
 * Markdown 分屏回归（题目页内嵌 IDE）：
 *  1. 左侧原文 Monaco 开启自动换行（长行不横向溢出）；
 *  2. 切到「所见即所得」再切回「分屏」，左栏仍是完整的 Monaco（旧实现会残留
 *     contentEditable 的渲染节点，把编辑器挤成一行/挪到内容下方）；
 *  3. 中间分隔条可拖拽改变左右宽度，双击恢复 50%。
 */

const base = process.env.BASE_URL || 'http://127.0.0.1:3096';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const issues = [];
page.on('pageerror', (e) => issues.push(e.message));

const splitMetrics = () =>
  page.evaluate(() => {
    const section = document.querySelector('[aria-label="Markdown 工作台"]');
    const sep = section?.querySelector('[role="separator"]');
    const source = sep?.previousElementSibling;
    const row = source?.parentElement;
    const editor = source?.querySelector('.monaco-editor');
    const viewLines = source?.querySelector('.view-lines');
    const host = source?.querySelector('.compiler-editor-host');
    return {
      hasSection: !!section,
      sourcePct: source && row ? (source.getBoundingClientRect().width / row.getBoundingClientRect().width) * 100 : null,
      ariaNow: sep ? Number(sep.getAttribute('aria-valuenow')) : null,
      editorH: editor ? editor.getBoundingClientRect().height : null,
      rowH: row ? row.getBoundingClientRect().height : null,
      viewLineCount: source ? source.querySelectorAll('.view-line').length : 0,
      viewLinesW: viewLines ? viewLines.getBoundingClientRect().width : null,
      editorW: editor ? editor.getBoundingClientRect().width : null,
      stalePreviewNodes: source ? source.querySelectorAll('.md-body, blockquote').length : -1,
      hostH: host ? host.getBoundingClientRect().height : null,
    };
  });

try {
  await page.goto(`${base}/problems/atcoder/arc234_b`, { waitUntil: 'networkidle' });
  await page.getByText('B.md', { exact: true }).first().click({ timeout: 60_000 });
  await page.waitForSelector('[aria-label="Markdown 工作台"] .monaco-editor', { timeout: 60_000 });
  await page.waitForTimeout(1200);

  // 1) 自动换行：view-lines 不超过编辑器宽度（未换行时内容宽度会远大于可视宽度）
  const initial = await splitMetrics();
  assert.ok(initial.hasSection, '未找到 Markdown 工作台');
  assert.ok(initial.viewLinesW <= initial.editorW + 1, `原文未自动换行 ${JSON.stringify(initial)}`);
  assert.ok(Math.abs(initial.sourcePct - 50) <= 1, `默认分栏应各占一半 ${JSON.stringify(initial)}`);

  // 2) 所见即所得 → 分屏：左栏必须是完整 Monaco，不能残留预览节点
  await page.getByRole('button', { name: '所见即所得' }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('textbox', { name: 'Markdown 所见即所得编辑' }).count(), 1);
  await page.getByRole('button', { name: '分屏' }).click();
  await page.waitForTimeout(1200);
  const back = await splitMetrics();
  assert.equal(back.stalePreviewNodes, 0, `左栏残留了旧渲染节点 ${JSON.stringify(back)}`);
  assert.ok(back.viewLineCount > 5, `切回分屏后 Monaco 没有正常渲染 ${JSON.stringify(back)}`);
  assert.ok(Math.abs(back.hostH - back.rowH) <= 2, `Monaco 高度没有撑满分栏 ${JSON.stringify(back)}`);
  assert.ok(back.viewLinesW <= back.editorW + 1, `切回分屏后换行失效 ${JSON.stringify(back)}`);

  // 3) 拖拽分隔条 + 双击复位
  const sep = page.locator('[aria-label="Markdown 工作台"] [role="separator"]');
  const box = await sep.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + 200, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const dragged = await splitMetrics();
  assert.ok(dragged.sourcePct < 48, `拖拽后左栏没有变窄 ${JSON.stringify(dragged)}`);
  assert.equal(dragged.ariaNow, Math.round(dragged.sourcePct));

  await sep.dblclick();
  await page.waitForTimeout(400);
  const reset = await splitMetrics();
  assert.ok(Math.abs(reset.sourcePct - 50) <= 1, `双击没有恢复 50% ${JSON.stringify(reset)}`);

  assert.deepEqual(issues, [], `页面报错：${issues.join('; ')}`);
  console.log('markdown 分屏回归通过');
} finally {
  await browser.close();
}