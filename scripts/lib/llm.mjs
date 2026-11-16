import { log, sleep } from './util.mjs';

/**
 * OpenAI 兼容翻译客户端。
 * 端点/密钥/模型来自环境变量（本地 .env.local，CI 为 GitHub Secrets）：
 *   TRANSLATE_BASE_URL / TRANSLATE_API_KEY / TRANSLATE_MODEL
 */

export function llmConfig() {
  const baseUrl = process.env.TRANSLATE_BASE_URL;
  const apiKey = process.env.TRANSLATE_API_KEY;
  const model = process.env.TRANSLATE_MODEL || 'gpt-6.1-sol';
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model };
}

async function chatOnce(cfg, messages, { temperature = 0.2, timeout = 420000 }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: cfg.model, messages, temperature }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

async function chatWithRetry(cfg, messages, opts = {}) {
  const retries = opts.retries ?? 2;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const content = await chatOnce(cfg, messages, opts);
      if (!content || !content.trim()) throw new Error('empty completion');
      return content;
    } catch (e) {
      lastErr = e;
      // 401/403 = 密钥失效或被限额，重试无意义，立即抛出让上层快速失败
      if (/HTTP 40[13]/.test(e.message)) throw e;
      if (attempt < retries) {
        const wait = 8000 * (attempt + 1);
        log('llm', `retry ${attempt + 1}/${retries} — ${e.message}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

/** 端点探活：1-token 请求，401/403 时抛错（用于批量翻译前快速失败）。 */
export async function pingLLM(cfg) {
  await chatOnce(cfg, [{ role: 'user', content: 'hi' }], { temperature: 0, timeout: 30000 });
}

/** 从模型输出中尽力解析 JSON 对象。 */
/** 字符串感知的控制字符转义：LLM 偶发在 JSON 字符串值里输出原始换行/ESC，
    JSON.parse 直接失败 → 兜底路径曾把整段原始 JSON 文本当译文入库（存量
    483 题二次编码的根因）。扫描时跟踪 in-string 状态，把字符串内的原始
    控制字符换成合法转义后再解析。 */
function parseLenientJson(t) {
  try {
    return JSON.parse(t);
  } catch {}
  let out = '';
  let inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr && c === '\\') {
      out += c + (t[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '"') inStr = !inStr;
    if (inStr && c.charCodeAt(0) < 0x20) {
      out +=
        c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : '';
      continue;
    }
    out += c;
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function extractJson(text) {
  let t = String(text).trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  return parseLenientJson(t.slice(first, last + 1));
}

const STATEMENT_SYSTEM = `你是顶级算法竞赛选手兼技术翻译，负责把算法竞赛题面从英文（或日文）翻译成简体中文。

硬性规则：
1. 输出必须是严格的 JSON 对象：{"titleZh": "<中文题名>", "bodyZh": "<翻译后的完整 Markdown 题面>"}，不要输出任何 JSON 之外的文字。
2. 数学公式一律原样保留：$...$ 与 $$...$$ 中的内容一个字符都不能改（包括空格、反斜杠、下标上标）。
3. 代码块（\`\`\` 围栏）与行内代码（\`...\`）原样保留，不翻译其中的内容。
4. 保持 Markdown 结构与段落顺序：标题层级、列表、表格、图片链接均保持不变。
5. 小节标题按此对照翻译：Problem Statement→题目描述；Constraints→约束条件；Input→输入格式；Output→输出格式；Note→说明；Scoring→评分；Interaction→交互；Examples→样例。其它标题酌情翻译。
6. 变量名、算法名（如 DP、DFS）、化学/物理符号保留原文；术语采用国内 OJ 惯用译法（如 subsequence→子序列，vertex→顶点，edge→边）。
7. 语句要符合中文表达习惯，不要逐词直译，也不要遗漏或添加内容。输入格式说明中的占位变量（如 N M、A_1 A_2 ... A_N）保持原样。
8. titleZh 只给题名的中文翻译，不要带题号前缀。`;

/** 翻译单个题面。返回 { titleZh, bodyZh }；失败抛错。 */
export async function translateStatement(cfg, { title, statementMd }) {
  const user = `请翻译以下题面。\n\n题名：${title}\n\n<statement>\n${statementMd}\n</statement>`;
  const content = await chatWithRetry(cfg, [
    { role: 'system', content: STATEMENT_SYSTEM },
    { role: 'user', content: user },
  ]);
  const parsed = extractJson(content);
  if (parsed && typeof parsed.bodyZh === 'string' && parsed.bodyZh.trim()) {
    return {
      titleZh: typeof parsed.titleZh === 'string' && parsed.titleZh.trim() ? parsed.titleZh.trim() : title,
      bodyZh: parsed.bodyZh.trim(),
    };
  }
  // JSON 解析失败时的兜底收紧（审查 管线-8）：截断的 JSON、带围栏/解释文字
  // 的混合体直接入库就是持久化损坏译文（存量 483 题二次编码即此类产物）。
  // 明显非纯译文的输出计为失败,交下轮重试。
  const fallback = String(content).trim();
  const looksBroken =
    /```/.test(fallback) ||
    /\{"titleZh"/.test(fallback) ||
    /^[[{]/.test(fallback) ||
    /<statement>|^\s*(请翻译|题名|以下是)/m.test(fallback);
  if (fallback.length > 20 && !looksBroken) {
    return { titleZh: title, bodyZh: fallback };
  }
  throw new Error('translation unparsable');
}

/**
 * 样例说明（samples[].note）专用提示词：与整篇题面分开翻的原因——
 * 说明是若干条独立的短 Markdown 片段（含公式/行内代码/样本值），
 * 混进整篇题面会让模型改写结构；这里要求逐条一一对应输出。
 */
const NOTES_SYSTEM = `你是顶级算法竞赛选手兼技术翻译，负责把算法竞赛题面里的「样例说明」从英文（或日文）翻译成简体中文。

硬性规则：
1. 输出必须是严格的 JSON 对象：{"notes": ["<第 1 条中文说明>", "<第 2 条中文说明>"]}，不要输出任何 JSON 之外的文字。
2. notes 数组长度必须与输入条数完全相同、顺序一致：一条输入对应一条输出，不合并、不拆分、不新增、不省略。
3. 数学公式（$...$、$$...$$、\\(...\\)、\\[...\\]）与行内代码（\`...\`）逐字符原样保留，包括空格与反斜杠。
4. 变量名、编号、样例中的输入输出数值保持原样；术语用国内 OJ 惯用译法（如 vertex→顶点，sequence→序列）。
5. 语句通顺，不要逐词直译；不要补解释、不要加「题意是」之类的话，不要改动原说明的信息量。
6. 保留原文的换行结构：原文行尾的硬换行标记（反斜杠）与段落空行原样保留，不要合并成一行。`;

/** 翻译单题的样例说明。notes 为英文片段数组，返回同序中文数组；失败抛错。 */
export async function translateSampleNotes(cfg, { title, notes }) {
  const list = notes.map((n, i) => `[${i + 1}]\n${n}`).join('\n\n');
  const user = `题目：${title}\n\n请逐条翻译以下 ${notes.length} 条样例说明：\n\n<notes>\n${list}\n</notes>`;
  const content = await chatWithRetry(cfg, [
    { role: 'system', content: NOTES_SYSTEM },
    { role: 'user', content: user },
  ]);
  const parsed = extractJson(content);
  const arr = parsed && Array.isArray(parsed.notes) ? parsed.notes : null;
  // 条数不一致直接判失败（下轮重试）：错位写入比缺译文更难发现。
  if (!arr || arr.length !== notes.length) throw new Error('notes translation unparsable');
  return arr.map((x) => String(x ?? '').trim());
}

const TITLES_SYSTEM = `把用户给出的算法竞赛名称翻译为简体中文（保留品牌与编号，如 "AtCoder Beginner Contest 481" → "第 481 场 AtCoder Beginner Contest"，Codeforces Round 编号同样保留）。输出严格 JSON：{"t<序号>": "<中文译名>", ...}，不要输出其它内容。`;

/** 批量翻译比赛名。titles 为字符串数组，返回同序中文数组。 */
export async function translateTitles(cfg, titles) {
  const list = titles.map((t, i) => `${i}: ${t}`).join('\n');
  const content = await chatWithRetry(cfg, [
    { role: 'system', content: TITLES_SYSTEM },
    { role: 'user', content: list },
  ], { timeout: 180000 });
  const parsed = extractJson(content);
  if (!parsed) return titles.map((_, i) => null);
  return titles.map((_, i) => {
    const v = parsed[`t${i}`] ?? parsed[String(i)] ?? parsed[i];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  });
}
