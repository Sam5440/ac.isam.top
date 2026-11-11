/* /ide v2 重设计可视化验证（Playwright, headless chromium, 1440x900）
 * 手动执行：先 `npm run dev`，再 `node e2e/ide-v2-visual.js`
 * 文件名刻意不含 test 字样 —— 否则 `node --test` 的默认发现规则（*-test.js）
 * 会把它当单测执行，没有 dev server 时整条 CI 直接失败。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000/ide";
const OUT = path.join(__dirname, "..", "gui-test-screenshots", "2026-11-11");
const PREF_KEY = "ysc-ide-shell-v1";

const results = [];
const consoleErrors = [];
let shot = (n) => path.join(OUT, n);

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail || ""}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[console.error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));

  // 清掉旧几何偏好，保证从默认几何开始
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate((k) => localStorage.removeItem(k), PREF_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  /* ---------- 1. 全局铺满 ---------- */
  const geom = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  record(
    "1a 无纵向溢出",
    geom.scrollHeight <= geom.innerHeight + 5,
    `scrollHeight=${geom.scrollHeight} innerHeight=${geom.innerHeight}`
  );

  const activityBtns = await page.locator('nav[aria-label="IDE 视图"] button[title]').evaluateAll((els) =>
    els.map((e) => e.getAttribute("title"))
  );
  const expected = ["测试面板", "终端", "CI 日志", "文件管理器", "AI 对话"];
  const found = expected.filter((t) => activityBtns.includes(t));
  record(
    "1b 活动栏按钮",
    activityBtns.length >= 4 && activityBtns.length <= 5 && found.length === expected.length,
    `titles=[${activityBtns.join(", ")}]`
  );

  const root = page.locator(".ide-fullbleed").first();
  const rootBox = await root.boundingBox();
  record(
    "1c 外壳铺满视口",
    Math.abs(rootBox.height - (900 - 56)) <= 10,
    `root height=${rootBox.height} (期望≈844)`
  );
  await page.screenshot({ path: shot("ide-v2-full.png"), fullPage: true });

  /* ---------- 2. 底部面板 Tab 切换 ---------- */
  await page.locator('nav[aria-label="IDE 视图"] button[title="CI 日志"]').click();
  await page.waitForTimeout(800);
  const ciVisible = await page
    .locator("text=暂无 CI 运行记录")
    .or(page.getByText("摘要").first())
    .or(page.getByText("未完成任务").first())
    .or(page.getByText("历史运行").first())
    .first()
    .isVisible()
    .catch(() => false);
  record("2a CI 日志面板出现", ciVisible, "查找 摘要/未完成任务/历史运行/暂无记录");
  await page.screenshot({ path: shot("ide-v2-ci-tab.png"), fullPage: true });

  await page.locator('nav[aria-label="IDE 视图"] button[title="终端"]').click();
  await page.waitForTimeout(500);
  const termVisible = await page
    .getByText("输出会显示在这里")
    .or(page.locator('button:has-text("运行")').first())
    .first()
    .isVisible()
    .catch(() => false);
  record("2b 切回终端面板", termVisible, "查找 输出会显示在这里 / 运行 按钮");

  /* ---------- 3. 测试面板搜题 ---------- */
  const search = page.locator('input[aria-label="搜索题目"]');
  await search.click();
  await search.fill("abc428");
  await page.waitForTimeout(1500);
  const resultList = page.locator("div.bg-popover button");
  const n = await resultList.count();
  if (n > 0) {
    await resultList.first().click();
    await page.waitForTimeout(2500);
  }
  const sampleVisible = await page.getByText("样例 1").first().isVisible().catch(() => false);
  const problemLoaded = await page.locator('button:has-text("换一题")').isVisible().catch(() => false);
  record(
    "3 搜题并载入样例",
    sampleVisible && problemLoaded,
    `results=${n}, 样例1可见=${sampleVisible}, 题目已载入=${problemLoaded}`
  );
  await page.screenshot({ path: shot("ide-v2-problem-loaded.png"), fullPage: true });

  /* ---------- 4. 编辑器 ---------- */
  const tabMain = page.locator('section[aria-label="代码编辑器"] button:has-text("main.cpp")');
  const tabMainVisible = await tabMain.isVisible().catch(() => false);
  const monacoInfo = await page.evaluate(() => {
    const m = window.__ysMonaco;
    if (!m || !m.editor) return { ok: false };
    const model = m.editor.getModel();
    if (!model) return { ok: false };
    return { ok: true, before: model.getValue().slice(0, 80) };
  });
  let typed = false;
  let after = "";
  if (monacoInfo.ok) {
    after = await page.evaluate(() => {
      const m = window.__ysMonaco;
      const model = m.editor.getModel();
      const pos = model.getFullModelRange();
      m.editor.executeEdits("test", [{ range: pos, text: "// ide-v2 verify " + Date.now() + "\nint main() { return 0; }" }]);
      m.editor.setPosition({ lineNumber: model.getLineCount(), column: model.getLineMaxColumn(model.getLineCount()) });
      return model.getValue().slice(0, 120);
    });
    typed = after.includes("ide-v2 verify");
    await page.waitForTimeout(300);
  }
  record(
    "4 编辑器 tab + Monaco",
    tabMainVisible && monacoInfo.ok && typed,
    `tab=${tabMainVisible}, monaco=${monacoInfo.ok}, typed=${typed}`
  );

  /* ---------- 5. 文件管理器新建文件 ---------- */
  const newName = page.locator('input[aria-label="新文件名"]');
  await newName.fill("sol.py");
  await newName.press("Enter");
  await page.waitForTimeout(1500);
  const tabSol = page.locator('section[aria-label="代码编辑器"] button:has-text("sol.py")');
  const tabSolVisible = await tabSol.isVisible().catch(() => false);
  const tabCount = await page
    .locator('section[aria-label="代码编辑器"]')
    .locator("div.group")
    .count();
  record("5 新建 sol.py 出现第二标签", tabSolVisible, `sol.py tab=${tabSolVisible}, 标签数=${tabCount}`);
  await page.screenshot({ path: shot("ide-v2-files.png"), fullPage: true });

  /* ---------- 6. 拖拽 + 持久化 ---------- */
  const readPrefs = () =>
    page.evaluate((k) => {
      try {
        return JSON.parse(localStorage.getItem(k) || "{}");
      } catch {
        return {};
      }
    }, PREF_KEY);

  // 底部：向上拖 80px → bottomH +80
  const bottomSep = page.locator('[role="separator"][aria-orientation="horizontal"]').first();
  let bb = await bottomSep.boundingBox();
  const prefsBefore = await readPrefs();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 - 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const prefsAfterBottom = await readPrefs();
  const dh = (prefsAfterBottom.bottomH ?? 0) - (prefsBefore.bottomH ?? 0);
  record("6a 底部拖拽 +80px", Math.abs(dh - 80) <= 12, `bottomH ${prefsBefore.bottomH}→${prefsAfterBottom.bottomH} (Δ=${dh})`);

  // 左侧：向右拖 60px → leftW +60
  const leftSep = page.locator('[role="separator"][aria-orientation="vertical"]').first();
  let lb = await leftSep.boundingBox();
  const prefsBeforeLeft = await readPrefs();
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width / 2 + 60, lb.y + lb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const prefsAfterLeft = await readPrefs();
  const dw = (prefsAfterLeft.leftW ?? 0) - (prefsBeforeLeft.leftW ?? 0);
  record("6b 左侧拖拽 +60px", Math.abs(dw - 60) <= 12, `leftW ${prefsBeforeLeft.leftW}→${prefsAfterLeft.leftW} (Δ=${dw})`);

  // 刷新后持久化
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const prefsReload = await readPrefs();
  const persisted =
    Math.abs((prefsReload.bottomH ?? 0) - prefsAfterBottom.bottomH) <= 2 &&
    Math.abs((prefsReload.leftW ?? 0) - prefsAfterLeft.leftW) <= 2;
  record(
    "6c 几何持久化（刷新后）",
    persisted,
    `reload: leftW=${prefsReload.leftW}, bottomH=${prefsReload.bottomH}`
  );

  /* ---------- 7. 折叠 / 展开 ---------- */
  // 面板宽为 0 时内容被 overflow-hidden 裁剪，isVisible 仍为 true → 用容器 clientWidth 判断
  const panelWidths = () =>
    page.evaluate(() => {
      const w = (sel) => {
        const el = document.querySelector(sel);
        const holder = el?.closest('div[style*="--ide-right"], div[style*="--ide-left"]');
        return holder ? holder.clientWidth : -1;
      };
      return { right: w('section[aria-label="文件管理器"]'), left: w('input[aria-label="搜索题目"]') };
    });

  // 文件管理器（右侧）
  await page.locator('nav[aria-label="IDE 视图"] button[title="文件管理器"]').click();
  await page.waitForTimeout(600);
  let w1 = await panelWidths();
  const fmGone = w1.right === 0;
  await page.locator('nav[aria-label="IDE 视图"] button[title="文件管理器"]').click();
  await page.waitForTimeout(600);
  w1 = await panelWidths();
  const fmBack = w1.right > 0;
  record("7a 文件管理器折叠/展开", fmGone && fmBack, `折叠后宽=${w1.right}, 再展开宽=${w1.right}`);

  // 测试面板（左侧）
  await page.locator('nav[aria-label="IDE 视图"] button[title="测试面板"]').click();
  await page.waitForTimeout(600);
  w1 = await panelWidths();
  const tpGone = w1.left === 0;
  await page.locator('nav[aria-label="IDE 视图"] button[title="测试面板"]').click();
  await page.waitForTimeout(600);
  w1 = await panelWidths();
  const tpBack = w1.left > 0;
  record("7b 测试面板折叠/展开", tpGone && tpBack, `折叠后宽=${w1.left}, 再展开宽=${w1.left}`);

  /* ---------- 8. AI 对话浮窗 ---------- */
  // Next.js dev overlay portal 会盖住底部活动栏按钮 → 用 JS 直接触发 click
  await page.evaluate(() => document.querySelector('nav[aria-label="IDE 视图"] button[title="AI 对话"]')?.click());
  await page.waitForTimeout(1000);
  const closeBtn = page.locator('button[aria-label="关闭"]');
  const chatOpen = await closeBtn.isVisible().catch(() => false);
  record("8a AI 对话浮窗打开", chatOpen, "关闭按钮可见");
  await page.screenshot({ path: shot("ide-v2-chat.png"), fullPage: true });
  if (chatOpen) {
    await page.evaluate(() => document.querySelector('button[aria-label="关闭"]')?.click());
    await page.waitForTimeout(500);
    const chatClosed = !(await page.evaluate(() => !!document.querySelector('button[aria-label="关闭"]')));
    record("8b AI 对话浮窗关闭", chatClosed, "");
  }

  /* ---------- 10. 移动端 ---------- */
  const mpage = await context.newPage();
  await mpage.setViewportSize({ width: 390, height: 844 });
  await mpage.goto(BASE, { waitUntil: "domcontentloaded" });
  await mpage.waitForTimeout(4000);
  const mgeom = await mpage.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  record(
    "10 移动端无横向溢出",
    mgeom.scrollWidth <= mgeom.innerWidth + 5,
    `scrollWidth=${mgeom.scrollWidth} innerWidth=${mgeom.innerWidth}`
  );
  await mpage.screenshot({ path: shot("ide-v2-mobile.png"), fullPage: true });
  await mpage.close();

  /* ---------- 9. 汇总 ---------- */
  const pass = results.filter((r) => r.ok).length;
  const summary = {
    timestamp: new Date().toISOString(),
    url: BASE,
    viewport: "1440x900 (+390x844 mobile)",
    total: results.length,
    pass,
    fail: results.length - pass,
    results,
    consoleErrors,
  };
  fs.writeFileSync(path.join(OUT, "ide-v2-results.json"), JSON.stringify(summary, null, 2));

  console.log("\n===== 汇总 =====");
  console.log(`通过 ${pass}/${results.length}`);
  for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.name} — ${r.detail}`);
  if (consoleErrors.length) {
    console.log(`\n控制台错误 (${consoleErrors.length}):`);
    for (const e of consoleErrors.slice(0, 20)) console.log("  " + e);
  } else {
    console.log("\n控制台错误: 无");
  }

  await browser.close();
  process.exit(pass === results.length && consoleErrors.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error("SCRIPT ERROR:", err);
  process.exit(2);
});
