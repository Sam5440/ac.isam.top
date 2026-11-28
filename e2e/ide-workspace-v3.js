import assert from "node:assert/strict";
import { chromium } from "playwright";

/**
 * IDE 工作区 v3 回归（需求 1–5）：
 *  1. 打开题目页 IDE：该题文件被打开、置顶，并且所在竞赛目录只有一份；
 *  2. 横排 / 竖排标签切换，标签右键菜单包含批量关闭项；
 *  3. 文件多选（⌘/Ctrl）与排序控件；
 *  4. 选中文件后右侧「详情」显示创建/编辑时间、大小与行数；
 *  5. 代码默认开启自动换行。
 *
 * 手动执行：先 `npm run build:fast && npx next start -p 3468`，再
 * `BASE_URL=http://127.0.0.1:3468 node e2e/ide-workspace-v3.js`。
 * 文件名不含 test 字样，避免被 `node --test` 的默认发现规则当成单测。
 */

const base = process.env.BASE_URL || "http://127.0.0.1:3468";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const issues = [];
page.on("pageerror", (e) => issues.push(e.message));

const pass = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  pass.push(cond);
};

try {
  await page.goto(`${base}/problems/codeforces/1582F1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const opener = page.getByTitle(/打开IDE工作区/).first();
  if (await opener.count()) {
    await opener.click();
    await page.waitForTimeout(3000);
  }
  await page.waitForSelector('[aria-label="代码编辑器"] [role="tablist"]', { timeout: 90_000 });
  await page.waitForTimeout(1500);

  // 1. 题目文件打开 + 置顶 + 竞赛目录唯一
  const tabs = await page
    .locator('[aria-label="代码编辑器"] [role="tab"]')
    .evaluateAll((els) =>
      els.map((e) => ({ text: e.innerText.trim(), pinned: Boolean(e.querySelector('[aria-label="已置顶"]')) })),
    );
  check("题目文件自动打开并置顶", tabs.some((t) => t.pinned && /F1\./.test(t.text)), JSON.stringify(tabs.slice(0, 4)));
  const contestDirs = await page.evaluate(async () => {
    const names = new Set();
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("ac-ide", 2);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!db.objectStoreNames.contains("files")) return [];
    const all = await new Promise((res, rej) => {
      const tx = db.transaction("files", "readonly");
      const req = tx.objectStore("files").getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    for (const r of all) if (r.type !== "dir" && r.path.includes("/")) names.add(r.path.split("/")[0]);
    return [...names];
  });
  check("一场比赛只有一个目录", contestDirs.filter((d) => /^1582/.test(d)).length === 1, JSON.stringify(contestDirs));

  // 2. 竖排标签 + 右键菜单
  const verticalBtn = page.getByTitle(/标签栏改为左侧竖排/).first();
  if (await verticalBtn.count()) {
    await verticalBtn.click();
    await page.waitForTimeout(500);
    const orientation = await page
      .locator('[aria-label="代码编辑器"] [role="tablist"]')
      .first()
      .getAttribute("aria-orientation");
    check("标签栏可切换为竖排", orientation === "vertical", `orientation=${orientation}`);
    await page.getByTitle(/标签栏改为顶部横排/).first().click();
    await page.waitForTimeout(400);
  } else {
    check("标签栏可切换为竖排", false, "找不到竖排按钮");
  }

  await page.locator('[aria-label="代码编辑器"] [role="tab"]').first().click({ button: "right" });
  await page.waitForTimeout(400);
  const menu = await page.locator('[role="menu"]').first().innerText().catch(() => "");
  check(
    "标签右键支持批量关闭",
    /关闭其他标签/.test(menu) && /关闭全部标签/.test(menu) && /关闭左/.test(menu) && /关闭右/.test(menu),
    menu.replace(/\n/g, " | "),
  );
  await page.keyboard.press("Escape");

  // 标签栏的填充条只能是 16px：它和 TabList 同时 flex-1 会把标签区压窄一半
  const barBox = await page.evaluate(() => {
    const bar = document.querySelector('section[aria-label="代码编辑器"] > div');
    const list = bar?.querySelector('[role="tablist"]');
    const filler = [...(bar?.children ?? [])].find((c) => c.tagName === "SPAN");
    const w = (el) => Math.round(el.getBoundingClientRect().width);
    if (!list || !filler) return null;
    return { bar: w(bar), list: w(list), filler: w(filler), scrollW: list.scrollWidth };
  });
  check(
    "标签栏填充条不抢标签宽度",
    barBox && barBox.filler <= 20 && barBox.list >= Math.min(barBox.scrollW, barBox.bar - 200),
    JSON.stringify(barBox),
  );

  // 3. 文件多选 + 排序
  if (!(await page.locator('aside[aria-label="左侧栏"]').count())) {
    await page.getByTitle(/切换左侧栏/).first().click();
    await page.waitForTimeout(600);
  }
  const aside = page.locator('aside[aria-label="左侧栏"]');
  await aside.locator('[role="tab"]', { hasText: "文件" }).first().click();
  await page.waitForTimeout(700);
  const dirRow = aside.locator('[role="treeitem"][aria-expanded] > div').first();
  if (await dirRow.count()) await dirRow.click();
  await page.waitForTimeout(600);
  const rows = aside.locator('[role="treeitem"] > div');
  if ((await rows.count()) >= 2) {
    await rows.nth(1).click();
    await rows.nth(2).click({ modifiers: [MOD] });
    await page.waitForTimeout(400);
    const banner = await aside.getByText(/已选择\s*\d+\s*项/).first().innerText().catch(() => "");
    check("文件支持多选", /已选择\s*2\s*项/.test(banner), banner);
  } else {
    check("文件支持多选", false, `rows=${await rows.count()}`);
  }
  const sort = aside.locator('select[aria-label="排序依据"]');
  check("文件可按名称/创建/编辑排序", (await sort.count()) === 1 && (await sort.locator("option").count()) === 3);

  // 4. 详情面板
  const detail = await page.locator('aside[aria-label="右侧栏"]').innerText().catch(() => "");
  check("详情显示时间/大小/行数", /创建时间/.test(detail) && /最后编辑/.test(detail) && /大小/.test(detail) && /行数/.test(detail));

  // 5. 代码默认自动换行
  const wrap = await page.evaluate(() => {
    const raw = localStorage.getItem("ysc-cp-settings-v1");
    return raw ? JSON.parse(raw).wordWrap : null;
  });
  check("代码默认自动换行", wrap === true || wrap === null, `wordWrap=${wrap}`);

  const fatal = issues.filter((m) => !/ERR_CONNECTION_CLOSED|404/.test(m));
  check("无运行时异常", fatal.length === 0, fatal.slice(0, 2).join(" / "));
  await page.screenshot({ path: "/tmp/ide-workspace-v3.png" });
} finally {
  await browser.close();
}

const failed = pass.filter((v) => !v).length;
console.log(`\n${pass.length - failed}/${pass.length} 通过`);
process.exit(failed ? 1 : 0);
