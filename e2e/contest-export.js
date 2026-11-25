import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

/**
 * 整场题目导出回归：正式赛 + 模拟赛，三种版式。
 * PDF 走直接下载（不经过打印窗口）；HTML 检查单栏 ICPC 结构、题目链接与语言。
 */

const base = process.env.BASE_URL || 'http://127.0.0.1:3096';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const issues = [];
page.on('pageerror', (e) => issues.push(e.message));

const downloadFile = async (label) => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByRole('button', { name: label }).click(),
  ]);
  const file = await download.path();
  return { name: download.suggestedFilename(), data: await readFile(file) };
};

const downloadHtml = async (label) => {
  const { name, data } = await downloadFile(label);
  return { name, html: data.toString('utf8') };
};

const pdfPageCount = (data) => (data.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
const pdfOutlineCount = (data) =>
  Number(data.toString('latin1').match(/\/Type \/Outlines [^\n]*\/Count (\d+)/)?.[1] ?? 0);

const openMenu = async () => {
  await page.getByRole('button', { name: '导出题目' }).click();
  await page.getByRole('dialog', { name: '导出整场题目' }).waitFor();
};

const assertOnScreen = async (locator, width, label) => {
  const box = await locator.boundingBox();
  assert.ok(box, `${label}未渲染`);
  assert.equal(await locator.isVisible(), true, `${label}不可见`);
  assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `${label}超出窄屏视口：${JSON.stringify(box)}`);
};

try {
  // ---------- 正式赛 ----------
  await page.goto(`${base}/contests/atcoder/arc234`, { waitUntil: 'networkidle' });
  await openMenu();

  const pdf = await downloadFile('下载 PDF');
  assert.equal(pdf.name, 'contest-arc234-both.pdf');
  assert.equal(pdf.data.subarray(0, 8).toString(), '%PDF-1.4');
  const pages = pdfPageCount(pdf.data);
  assert.ok(pages >= 5, `PDF 至少应有封面 + 4 题，实际 ${pages} 页`);
  assert.equal(pdfOutlineCount(pdf.data), 4, 'PDF 应为每道题写入书签');

  await openMenu();
  const both = await downloadHtml('下载 HTML');
  assert.equal(both.name, 'contest-arc234-both.html');
  assert.doesNotMatch(both.html, /class="side-by-side"/);
  assert.match(both.html, /class="cover-problems"/);
  assert.match(both.html, /class="lang-block"/);
  assert.match(both.html, /Problem A/);
  assert.match(both.html, new RegExp(`${base}/problems/atcoder/arc234_a`));
  assert.match(both.html, /https:\/\/atcoder\.jp\/contests\/arc234\/tasks\/arc234_a/);
  assert.match(both.html, new RegExp(`${base}/contests/atcoder/arc234`));
  assert.match(both.html, /https:\/\/atcoder\.jp\/contests\/arc234/);
  assert.ok(both.html.length > 20_000, '导出的题目内容过短');

  await openMenu();
  await page.getByRole('radio', { name: /纯中文/ }).click();
  const zh = await downloadHtml('下载 HTML');
  assert.equal(zh.name, 'contest-arc234-zh.html');
  assert.doesNotMatch(zh.html, /class="side-by-side"/);
  assert.doesNotMatch(zh.html, /class="lang-block"/);
  assert.match(zh.html, /中文<\/span>|中文题面|题目描述|给定一个/);

  await openMenu();
  await page.getByRole('radio', { name: /纯英文/ }).click();
  const en = await downloadHtml('下载 HTML');
  assert.equal(en.name, 'contest-arc234-en.html');
  assert.match(en.html, /You are given a permutation/);

  // ---------- 模拟赛 ----------
  await page.goto(`${base}/simulator`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const contest = {
      id: 'e2e-export',
      name: '导出测试赛',
      minutes: 60,
      problems: [
        { platform: 'atcoder', id: 'arc234_b', points: 100, alias: '' },
        { platform: 'atcoder', id: 'abc034_b', points: 200, alias: '别名B' },
      ],
      sort: { by: 'original', dir: 'asc' },
      createdAt: Date.now(),
      elapsedMs: 0,
      runningSince: null,
      activeProblem: null,
      activeProblemSince: null,
      problemTimes: {},
      completed: {},
    };
    localStorage.setItem('ac-simulator-contests-v1', JSON.stringify([contest]));
  });
  await page.goto(`${base}/contests/sim/e2e-export`, { waitUntil: 'networkidle' });
  await page.getByText('导出测试赛', { exact: true }).first().waitFor({ timeout: 60_000 });
  await openMenu();
  const simPdf = await downloadFile('下载 PDF');
  assert.equal(simPdf.name, 'contest-e2e-export-both.pdf');
  assert.equal(simPdf.data.subarray(0, 8).toString(), '%PDF-1.4');
  assert.ok(pdfPageCount(simPdf.data) >= 3, '模拟赛 PDF 至少应有封面 + 2 题');
  assert.equal(pdfOutlineCount(simPdf.data), 2, '模拟赛 PDF 应为每道题写入书签');

  await openMenu();
  const sim = await downloadHtml('下载 HTML');
  assert.equal(sim.name, 'contest-e2e-export-both.html');
  assert.match(sim.html, /1A/);
  assert.match(sim.html, /2B/);
  assert.match(sim.html, /class="lang-block"/);
  assert.match(sim.html, new RegExp(`${base}/problems/atcoder/abc034_b`));
  assert.match(sim.html, /https:\/\/atcoder\.jp\/contests\/abc034\/tasks\/abc034_b/);
  assert.match(sim.html, new RegExp(`${base}/contests/sim/e2e-export"`));
  assert.doesNotMatch(sim.html, /#data=/, '模拟赛导出不应把整份分享载荷塞进文档');
  assert.match(sim.html, /导出测试赛/);

  assert.deepEqual(issues, [], `页面报错：${issues.join('; ')}`);

  // ---------- 窄屏：正式赛 / 模拟赛都必须有导出入口，面板不撑破视口 ----------
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${base}/contests/atcoder/arc234`, { waitUntil: 'networkidle' });
    await assertOnScreen(page.getByRole('button', { name: '导出题目' }), width, '正式赛“导出题目”按钮');
    await openMenu();
    await assertOnScreen(page.getByRole('button', { name: '下载 PDF' }), width, '正式赛“下载 PDF”按钮');
    await assertOnScreen(page.getByRole('button', { name: '下载 HTML' }), width, '正式赛“下载 HTML”按钮');
    const box = await page.getByRole('dialog', { name: '导出整场题目' }).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `${width}px 导出面板溢出：${JSON.stringify(box)}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${width}px 出现横向滚动：${overflow}px`);

    await page.goto(`${base}/contests/sim/e2e-export`, { waitUntil: 'networkidle' });
    await page.getByText('导出测试赛', { exact: true }).first().waitFor({ timeout: 60_000 });
    await assertOnScreen(page.getByRole('button', { name: '导出题目' }), width, '模拟赛“导出题目”按钮');
    await openMenu();
    await assertOnScreen(page.getByRole('button', { name: '下载 PDF' }), width, '模拟赛“下载 PDF”按钮');
    await assertOnScreen(page.getByRole('button', { name: '下载 HTML' }), width, '模拟赛“下载 HTML”按钮');
  }

  console.log('整场题目导出回归通过');
} finally {
  await browser.close();
}
