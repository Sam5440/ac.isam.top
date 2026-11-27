import { chromium } from "playwright";

/**
 * AI 面板「对话 / Agent」模式回归：
 *  1. 面板内可切换模式，且模型下拉列出设置里该服务商的模型、选中后写回 aiAssign.chat.model；
 *  2. Agent 模式会把模型输出的 <run> 块真正放进浏览器沙盒（wasm C++）运行，
 *     并把真实结果回灌给模型 —— 这里用拦截 /api/ai/proxy 的假模型验证整条链路，
 *     不依赖任何真实 API Key。
 *
 * 手动执行：先构建并 `npx next start -p 3468`，再
 * `BASE_URL=http://127.0.0.1:3468 node e2e/ai-agent-mode.js`
 */

const base = process.env.BASE_URL || "http://127.0.0.1:3468";
const SETTINGS_KEY = "stmt-settings-v1";
const MODEL = "fake-sandbox-model";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const results = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  results.push(cond);
};

// 假模型：第一轮返回一个 <run> 块（故意 WA：输出 0 而不是样例答案），
// 收到「沙盒运行结果」后返回最终结论。记录它实际看到的回灌文本。
const seen = [];
await context.route("**/api/ai/proxy", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  const msgs = body?.body?.messages || [];
  const lastUser = [...msgs].reverse().find((m) => m.role === "user");
  const report = lastUser?.content?.startsWith("【沙盒运行结果】") ? lastUser.content : null;
  seen.push({ report, system: msgs[0]?.content || "" });

  const content = report
    ? "根据沙盒结果：样例 1 输出与期望不符。修正后应输出样例答案。"
    : '先验证一下当前写法：\n<run language="cpp">\n#include <bits/stdc++.h>\nint main(){ std::cout << 0 << "\\n"; }\n</run>';

  await route.fulfill({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
  });
});

try {
  await page.goto(`${base}/problems/codeforces/1582F1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // 注入服务商 + chat 绑定（等价于在设置页添加服务商与模型）
  await page.evaluate(
    ({ key, model }) => {
      const raw = JSON.parse(localStorage.getItem(key) || "{}");
      raw.aiProviders = {
        list: [
          {
            id: "prov_test",
            name: "测试服务商",
            apiFormat: "openai",
            baseUrl: "https://example.invalid/v1",
            apiKey: "test-key",
            models: [model, "second-model"],
          },
        ],
        activeId: "prov_test",
      };
      raw.aiAssign = { ...(raw.aiAssign || {}), chat: { providerId: "auto", model: "", proxy: true } };
      localStorage.setItem(key, JSON.stringify(raw));
    },
    { key: SETTINGS_KEY, model: MODEL },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  await page.getByTitle(/AI 对话（基于本题与当前代码）/).first().click();
  await page.waitForTimeout(1500);

  const panel = page.getByRole("dialog", { name: "AI 对话" }).first();
  check("AI 面板打开", (await panel.count()) === 1);

  const modeGroup = panel.getByRole("group", { name: "对话模式" });
  check("存在对话/Agent 模式切换", (await modeGroup.count()) === 1);

  // 模型下拉
  await panel.getByTitle(/选择本轮使用的模型/).first().click();
  await page.waitForTimeout(400);
  const listbox = page.getByRole("listbox", { name: "选择模型" });
  const opts = await listbox.getByRole("option").evaluateAll((els) => els.map((e) => e.innerText.trim()));
  check("模型下拉列出设置中的模型", opts.includes(MODEL) && opts.includes("second-model"), JSON.stringify(opts));
  await listbox.getByRole("option", { name: MODEL }).click();
  await page.waitForTimeout(400);
  const savedModel = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}").aiAssign?.chat?.model, SETTINGS_KEY);
  check("选择模型写回设置", savedModel === MODEL, `model=${savedModel}`);

  // 切到 Agent 模式
  await modeGroup.getByRole("button", { name: /Agent/ }).click();
  await page.waitForTimeout(300);
  const pressed = await modeGroup.getByRole("button", { name: /Agent/ }).getAttribute("aria-pressed");
  check("可切换到 Agent 模式", pressed === "true", `aria-pressed=${pressed}`);

  // 发消息，触发 模型 → 沙盒 → 回灌
  const input = panel.locator("textarea").first();
  await input.fill("帮我验证这段代码能不能过样例。");
  await input.press("Enter");

  // 等沙盒真跑完（首次可能要加载 wasm 运行时）
  let report = null;
  for (let i = 0; i < 90; i += 1) {
    await page.waitForTimeout(2000);
    report = seen.find((s) => s.report)?.report || null;
    if (report) break;
  }
  check("Agent 调用了浏览器沙盒", Boolean(report), report ? report.split("\n")[0] : "未收到回灌");
  check("沙盒结果含真实判题", /样例 1：(AC|WA|RE|TE)/.test(report || ""), (report || "").split("\n").slice(0, 3).join(" | "));
  check("系统提示词含 Agent 协议", /Agent 模式/.test(seen[0]?.system || "") && /<run/.test(seen[0]?.system || ""));

  // 会话里能看到折叠的沙盒结果块
  const details = panel.locator("details", { hasText: "沙盒运行结果" });
  check("会话内展示沙盒结果", (await details.count()) >= 1);

  await page.screenshot({ path: "/tmp/ai-agent-mode.png" });
} finally {
  await browser.close();
}

const failed = results.filter((v) => !v).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
