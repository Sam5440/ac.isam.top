import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://127.0.0.1:3468';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const unique = `file-ops-${Date.now().toString(36)}`;
const fileA = `${unique}-a.txt`;
const fileB = `${unique}-b.txt`;
const folder = `${unique}-target`;
const fileACopy = `${unique}-a copy.txt`;
const fileBCopy = `${unique}-b copy.txt`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

async function recordsInWorkspace() {
  return page.evaluate(async () => {
    const request = indexedDB.open('ac-ide', 2);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readonly');
      const all = transaction.objectStore('files').getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
    });
  });
}

async function selectRows(fileManager, paths) {
  const rows = paths.map((path) => fileManager.locator(`[data-path="${path}"]`));
  await rows[0].click();
  for (const row of rows.slice(1)) await row.click({ modifiers: [modifier] });
  await assert.doesNotReject(() => fileManager.getByText(new RegExp(`已选择\\s*${paths.length}\\s*项`)).waitFor());
}

try {
  await page.goto(`${base}/ide`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[aria-label="文件管理"]', { timeout: 90_000 });
  const files = page.locator('[aria-label="文件管理"]');
  await page.locator('aside[aria-label="左侧栏"] [role="tab"]', { hasText: '文件' }).first().click();
  await page.waitForTimeout(500);

  for (const name of [fileA, fileB]) {
    await files.getByTitle('新建文件…').click();
    const input = files.getByRole('textbox', { name: '文件名' });
    await input.fill(name);
    await input.press('Enter');
    await page.waitForTimeout(150);
  }
  await selectRows(files, [fileA, fileB]);
  await files.locator(`[data-path="${fileA}"]`).click({ modifiers: [modifier] });
  assert.equal(await files.getByRole('button', { name: '复制所选项目' }).count(), 0, '取消最后一个多选项时清除批量操作');
  await files.locator(`[data-path="${fileA}"]`).click();

  await files.getByTitle('新建文件夹…').click();
  const folderInput = files.getByRole('textbox', { name: '文件夹名' });
  await folderInput.fill(folder);
  await folderInput.press('Enter');
  await page.waitForTimeout(400);

  await files.getByTitle('新建文件夹…').click();
  const sourceFolderInput = files.getByRole('textbox', { name: '文件夹名' });
  await sourceFolderInput.fill(`${unique}-source`);
  await sourceFolderInput.press('Enter');
  await page.waitForTimeout(300);
  await files.locator(`[data-path="${unique}-source"]`).click();
  await files.getByTitle('新建文件…').click();
  const sourceInput = files.getByRole('textbox', { name: '文件名' });
  await sourceInput.fill('inside.txt');
  await sourceInput.press('Enter');
  await page.waitForTimeout(300);

  await files.locator(`[data-path="${folder}"]`).click();
  await files.getByTitle('新建文件…').click();
  const nestedInput = files.getByRole('textbox', { name: '文件名' });
  await nestedInput.fill('nested.txt');
  await nestedInput.press('Enter');
  await page.waitForTimeout(300);

  await selectRows(files, [fileA, fileB]);
  await files.getByRole('button', { name: '复制所选项目' }).click();
  await files.getByTitle(/粘贴 2 项到当前文件夹/).click();
  await page.waitForTimeout(500);
  let records = await recordsInWorkspace();
  let paths = records.map((record) => record.path);
  assert.ok(paths.includes(fileACopy), '复制后的文件自动避免覆盖同名文件');
  assert.ok(paths.includes(fileBCopy), '多选复制保留全部项目');

  await selectRows(files, [fileA, `${unique}-source`]);
  await files.getByRole('button', { name: '复制所选项目' }).click();
  await files.getByRole('button', { name: '清除选择' }).click();
  await files.getByTitle(/粘贴 2 项到当前文件夹/).click();
  await page.waitForTimeout(400);
  records = await recordsInWorkspace();
  paths = records.map((record) => record.path);
  assert.ok(paths.includes(`${unique}-source copy/inside.txt`), '复制文件夹保留其内部文件');
  assert.equal(records.find((record) => record.path === `${unique}-source copy/inside.txt`).content, '');

  await selectRows(files, [fileA, fileB]);
  await files.getByRole('button', { name: '剪切所选项目' }).click();
  await files.locator(`[data-path="${folder}"]`).click({ button: 'right' });
  await files.getByRole('menuitem', { name: /粘贴 2 项/ }).click();
  await page.waitForTimeout(500);
  records = await recordsInWorkspace();
  paths = records.map((record) => record.path);
  assert.ok(paths.includes(`${folder}/${fileA}`));
  assert.ok(paths.includes(`${folder}/${fileB}`));
  assert.ok(!paths.includes(fileA), '剪切会移除原路径');

  await selectRows(files, [fileACopy, fileBCopy]);
  page.once('dialog', (dialog) => dialog.accept());
  await files.getByRole('button', { name: '删除所选项目' }).click();
  await page.waitForTimeout(350);
  records = await recordsInWorkspace();
  paths = records.map((record) => record.path);
  assert.ok(!paths.includes(fileACopy));
  assert.ok(!paths.includes(fileBCopy));
  assert.equal(await files.getByRole('button', { name: '删除所选项目' }).count(), 0, '批量删除后清除已删除的选择');
  assert.deepEqual(errors, []);
  console.log('ide-file-operations: copy, cut, paste and delete ok');
} finally {
  await context.close();
  await browser.close();
}
