/**
 * AI Agent 模式的纯逻辑（node --test 可测，不碰浏览器 API）。
 *
 * 为什么不用 provider 的 tool calling：站内要兼容 OpenAI 兼容网关、Anthropic
 * 以及各种自建代理，函数调用字段的支持面参差不齐。这里改用**文本协议**：
 * 模型想验证代码时输出
 *
 *   <run language="cpp">
 *   ...源码...
 *   </run>
 *   <stdin>
 *   ...标准输入（可选）...
 *   </stdin>
 *
 * 前端解析出来，在浏览器沙盒（CppClient / PyClient，wasm）里跑样例，再把结果
 * 作为下一轮的用户消息回灌。协议简单、任何模型都能遵守，也便于单测。
 */

export const AGENT_MAX_ROUNDS = 4;
export const AGENT_MAX_SOURCE = 60_000;
export const AGENT_MAX_STDIN = 20_000;

const RUN_OPEN = /<run(?:\s+language\s*=\s*"([^"]*)")?\s*>/i;
const RUN_CLOSE = "</run>";
const STDIN_OPEN = /<stdin\s*>/i;
const STDIN_CLOSE = "</stdin>";

/** 规范化语言标识：只接受 cpp / python（其余按 cpp 处理）。 */
export function normalizeAgentLanguage(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "python" || s === "py" || s === "python3") return "python";
  return "cpp";
}

/**
 * 从模型回复里解析沙盒运行请求。
 * 只取**最后一个** run 块（模型可能先解释再给最终版本）。
 * @returns {{language:'cpp'|'python', source:string, stdin:string}|null}
 */
export function extractRunRequest(text) {
  const s = String(text ?? "");
  const open = [...s.matchAll(new RegExp(RUN_OPEN.source, "gi"))].pop();
  if (!open) return null;
  const start = open.index + open[0].length;
  const end = s.indexOf(RUN_CLOSE, start);
  if (end < 0) return null;
  const source = s.slice(start, end).trim();
  if (!source || source.length > AGENT_MAX_SOURCE) return null;

  // stdin 块可能出现在 run 之后
  let stdin = "";
  const after = s.slice(end + RUN_CLOSE.length);
  const sOpen = after.match(STDIN_OPEN);
  if (sOpen) {
    const sStart = sOpen.index + sOpen[0].length;
    const sEnd = after.indexOf(STDIN_CLOSE, sStart);
    if (sEnd >= 0) stdin = after.slice(sStart, sEnd).replace(/^\n/, "").replace(/\n$/, "").slice(0, AGENT_MAX_STDIN);
  }
  return { language: normalizeAgentLanguage(open[1]), source, stdin };
}

/** 去掉 run/stdin 块后的可读文本（用于「已提交沙盒」的折叠展示）。 */
export function stripRunBlocks(text) {
  let s = String(text ?? "");
  s = s.replace(/<run(?:\s+language\s*=\s*"[^"]*")?\s*>[\s\S]*?<\/run>/gi, "");
  s = s.replace(/<stdin\s*>[\s\S]*?<\/stdin>/gi, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 沙盒执行结果 → 回灌给模型的文本。
 * results: [{ index, verdict, expected, actual, elapsedMs, note }]
 * compileError 存在时只报编译错误。
 */
export function formatRunReport({ language, source, compileError, results, note }, { maxOutput = 1200 } = {}) {
  const langLabel = language === "python" ? "Python" : "C++";
  const cut = (v) => {
    const s = String(v ?? "");
    return s.length <= maxOutput ? s : `${s.slice(0, maxOutput)}\n…（截断，共 ${s.length} 字符）`;
  };
  if (compileError) {
    return `【沙盒运行结果】${langLabel} 编译失败：\n\n\`\`\`\n${cut(compileError)}\n\`\`\``;
  }
  if (!results?.length) {
    return `【沙盒运行结果】没有可运行的样例${note ? `（${note}）` : ""}。`;
  }
  const lines = results.map((r, i) => {
    const idx = Number.isInteger(r.index) ? r.index + 1 : i + 1;
    const head = `样例 ${idx}：${r.verdict}${r.elapsedMs != null ? `（${r.elapsedMs}ms）` : ""}`;
    if (r.verdict === "AC") return head;
    const parts = [head];
    if (r.note) parts.push(`说明：${cut(r.note)}`);
    if (r.expected != null) parts.push(`期望输出：\n\`\`\`\n${cut(r.expected)}\n\`\`\``);
    if (r.actual != null) parts.push(`实际输出：\n\`\`\`\n${cut(r.actual)}\n\`\`\``);
    return parts.join("\n");
  });
  const ac = results.filter((r) => r.verdict === "AC").length;
  return [
    `【沙盒运行结果】${langLabel}，${ac}/${results.length} 个样例通过（源码 ${source ? source.split("\n").length : 0} 行）。`,
    "",
    ...lines,
    "",
    "请根据以上真实运行结果继续：若还有错误请给出修正后的完整代码（需要再验证就再给一个 <run> 块），全部通过则总结思路与复杂度。",
  ].join("\n");
}

/** Agent 模式的系统提示词（在通用教练提示词之后追加）。 */
export function agentSystemPrompt({ hasSamples = false } = {}) {
  const sampleHint = hasSamples
    ? "当前题目已附带样例，沙盒会用这些样例对拍。"
    : "当前没有附带样例；如需自定义输入，可在 <run> 块后用 <stdin> 指定。";
  return [
    "## Agent 模式",
    "你可以调用浏览器内的编译沙盒（C++20 / Python，wasm，不联网、不落盘）真实运行代码来验证正确性。",
    "需要验证时，在回复中输出**一个**如下格式的块（源码必须是可独立编译运行的完整程序）：",
    "",
    '<run language="cpp">',
    "...完整源码...",
    "</run>",
    "",
    "可选地紧跟一个标准输入块：",
    "",
    "<stdin>",
    "...输入...",
    "</stdin>",
    "",
    sampleHint,
    "系统会执行并把真实的编译错误 / 各样例输出回给你，你再据此修正。",
    "不要臆造运行结果；不确定就先跑。最终答复里不要包含 <run> 块，直接给结论与最终代码。",
  ].join("\n");
}

/** 是否已达轮数上限（供 UI 提示）。 */
export function agentRoundExceeded(round) {
  return Number(round) >= AGENT_MAX_ROUNDS;
}

/**
 * 归一化 Agent 会话状态（UI 持久化用）。
 * @returns {{mode:'chat'|'agent', rounds:number}}
 */
export function normalizeAgentState(raw) {
  const mode = raw?.mode === "agent" ? "agent" : "chat";
  const n = Number(raw?.rounds);
  return { mode, rounds: Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), AGENT_MAX_ROUNDS) : 0 };
}
