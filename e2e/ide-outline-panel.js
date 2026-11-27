import assert from "node:assert/strict";
import { chromium } from "playwright";

/**
 * 结构（Outline）面板回归：右侧「结构」标签列出当前 C++ 文件的函数/变量，
 * 点击条目会把 Monaco 光标移到对应行。
 *
 * 手动执行：`BASE_URL=http://127.0.0.1:3468 node e2e/ide-outline-panel.js`
 */

const base = process.env.BASE_URL || "http://127.0.0.1:3468";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const issues = [];
page.on("pageerror", (e) => issues.push(e.message));

const results = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  results.push(cond);
};

try {
  await page.goto(`${base}/problems/codeforces/1582F1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const opener = page.getByTitle(/打开IDE工作区/).first();
  if (await opener.count()) await opener.click();
  await page.waitForSelector("#compiler-panel .monaco-editor", { timeout: 90_000 });
  await page.waitForTimeout(2500);

  const right = page.locator('aside[aria-label="右侧栏"]');
  if (!(await right.count())) {
    await page.getByTitle(/切换右侧栏/).first().click();
    await page.waitForTimeout(600);
  }
  const outlineTab = page.locator('aside[aria-label="右侧栏"] [role="tab"]', { hasText: "结构" }).first();
  check("右侧存在「结构」标签", (await outlineTab.count()) === 1);
  await outlineTab.click();
  await page.waitForTimeout(800);

  const panel = page.locator('section[aria-label="结构"]');
  check("结构面板渲染", (await panel.count()) === 1);
  const items = panel.locator("button");
  const count = await items.count();
  const names = await items.evaluateAll((els) => els.map((e) => e.innerText.trim()));
  check("列出函数/变量等符号", count >= 2, `${count} 项: ${names.slice(0, 6).join(", ")}`);
  check("识别到 main 函数", names.some((n) => /\bmain\b/.test(n)), names.join(" | ").slice(0, 80));

  // 点击符号跳到对应行
  const target = items.filter({ hasText: "main" }).first();
  if (await target.count()) {
    await target.click();
    await page.waitForTimeout(600);
    const pos = await page.evaluate(() => window.__ysMonaco?.editor?.getPosition() ?? null);
    check("点击符号可跳转到对应行", pos?.lineNumber > 1, `line=${pos?.lineNumber} col=${pos?.column}`);
  } else {
    check("点击符号可跳转", false, "找不到 main");
  }

  const fatal = issues.filter((m) => !/ERR_CONNECTION_CLOSED|404/.test(m));
  check("无运行时异常", fatal.length === 0, fatal.slice(0, 2).join(" / "));
  await page.screenshot({ path: "/tmp/ide-outline-panel.png" });
} finally {
  await browser.close();
}

const failed = results.filter((v) => !v).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
