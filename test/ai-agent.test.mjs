import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_MAX_ROUNDS,
  agentRoundExceeded,
  agentSystemPrompt,
  extractRunRequest,
  formatRunReport,
  normalizeAgentLanguage,
  normalizeAgentState,
  stripRunBlocks,
} from "../lib/ai-agent.mjs";

test("agent: 解析 <run> 块与语言", () => {
  const req = extractRunRequest('思路如下。\n<run language="cpp">\nint main(){return 0;}\n</run>');
  assert.equal(req.language, "cpp");
  assert.equal(req.source, "int main(){return 0;}");
  assert.equal(req.stdin, "");

  const py = extractRunRequest('<run language="python">\nprint(1)\n</run>');
  assert.equal(py.language, "python");
});

test("agent: 缺省语言按 C++，未知语言也回落 C++", () => {
  assert.equal(extractRunRequest("<run>\nint main(){}\n</run>").language, "cpp");
  assert.equal(extractRunRequest('<run language="rust">\nx\n</run>').language, "cpp");
  assert.equal(normalizeAgentLanguage("py"), "python");
  assert.equal(normalizeAgentLanguage("Python3"), "python");
});

test("agent: 只取最后一个 run 块", () => {
  const text = '<run language="cpp">\nfirst\n</run>\n中间解释\n<run language="python">\nsecond\n</run>';
  const req = extractRunRequest(text);
  assert.equal(req.language, "python");
  assert.equal(req.source, "second");
});

test("agent: 未闭合 / 空源码 / 无 run 块都返回 null", () => {
  assert.equal(extractRunRequest("<run language=\"cpp\">\nint main(){}"), null);
  assert.equal(extractRunRequest('<run language="cpp">\n\n</run>'), null);
  assert.equal(extractRunRequest("就是普通回答，没有代码块"), null);
});

test("agent: 解析 run 之后的 stdin 块", () => {
  const req = extractRunRequest('<run language="cpp">\nint main(){}\n</run>\n<stdin>\n1 2 3\n</stdin>');
  assert.equal(req.stdin, "1 2 3");
});

test("agent: stripRunBlocks 去掉代码与输入块", () => {
  const text = '先说明。\n<run language="cpp">\nint main(){}\n</run>\n<stdin>\n1\n</stdin>\n后记。';
  assert.equal(stripRunBlocks(text), "先说明。\n\n后记。");
});

test("agent: 运行报告含通过数与错误输出", () => {
  const ok = formatRunReport({
    language: "cpp",
    source: "int main(){}",
    results: [
      { index: 0, verdict: "AC", elapsedMs: 12 },
      { index: 1, verdict: "WA", expected: "2", actual: "3" },
    ],
  });
  assert.match(ok, /1\/2 个样例通过/);
  assert.match(ok, /样例 2：WA/);
  assert.match(ok, /期望输出/);

  const ce = formatRunReport({ language: "cpp", compileError: "error: expected ';'" });
  assert.match(ce, /编译失败/);
  assert.match(ce, /expected/);
});

test("agent: 报告截断超长输出，空样例给出提示", () => {
  const long = "x".repeat(5000);
  const r = formatRunReport(
    { language: "python", results: [{ index: 0, verdict: "WA", expected: long, actual: long }] },
    { maxOutput: 20 },
  );
  assert.match(r, /截断，共 5000 字符/);
  assert.match(formatRunReport({ language: "cpp", results: [], note: "没有样例" }), /没有可运行的样例（没有样例）/);
});

test("agent: 系统提示词包含协议与样例提示", () => {
  assert.match(agentSystemPrompt({ hasSamples: true }), /<run language="cpp">/);
  assert.match(agentSystemPrompt({ hasSamples: true }), /已附带样例/);
  assert.match(agentSystemPrompt({ hasSamples: false }), /<stdin>/);
});

test("agent: 轮数上限与状态归一化", () => {
  assert.equal(agentRoundExceeded(AGENT_MAX_ROUNDS), true);
  assert.equal(agentRoundExceeded(1), false);
  assert.deepEqual(normalizeAgentState({ mode: "agent", rounds: 2 }), { mode: "agent", rounds: 2 });
  assert.deepEqual(normalizeAgentState({ mode: "weird", rounds: 99 }), { mode: "chat", rounds: AGENT_MAX_ROUNDS });
  assert.deepEqual(normalizeAgentState(null), { mode: "chat", rounds: 0 });
});
