import { httpGet } from './http.mjs';
import { loadHtml, nodesToMd, preText, inlineMd } from './html2md.mjs';
import { normalizeMathMarks, sanitizeText } from '../../lib/render.js';

const KENKOO = 'https://kenkoooo.com/atcoder/resources';
const ATCODER = 'https://atcoder.jp';

/** kenkoooo 比赛列表 → 已结束的 ABC/ARC/AGC，新→旧。 */
export async function fetchAtCoderContests() {
  const contests = await httpGet(`${KENKOO}/contests.json`, { json: true, timeout: 20000 });
  const now = Math.floor(Date.now() / 1000);
  return contests
    .filter((c) => /^(abc|arc|agc)\d+$/.test(c.id))
    .filter((c) => c.start_epoch_second + c.duration_second < now)
    .sort((a, b) => b.start_epoch_second - a.start_epoch_second);
}

/** 全量题目清单（problem_id / contest_id / index / name）。 */
export async function fetchAtCoderProblems() {
  return httpGet(`${KENKOO}/problems.json`, { json: true, timeout: 30000 });
}

/** 难度模型（实验值）：problem_id → difficulty。 */
export async function fetchAtCoderModels() {
  const models = await httpGet(`${KENKOO}/problem-models.json`, { json: true, timeout: 20000 });
  const map = {};
  for (const [pid, m] of Object.entries(models)) {
    if (m && typeof m.difficulty === 'number') map[pid] = Math.round(m.difficulty);
  }
  return map;
}

function sectionHeading(h) {
  const t = h.trim();
  if (/^problem statement$/i.test(t)) return '## Problem Statement';
  if (/^constraints?$/i.test(t)) return '## Constraints';
  if (/^input$/i.test(t) || /^input format$/i.test(t)) return '## Input';
  if (/^output$/i.test(t) || /^output format$/i.test(t)) return '## Output';
  if (/^(notes?|hints?|note\.)$/i.test(t)) return '## Note';
  if (/^scoring$/i.test(t)) return '## Scoring';
  if (/^問題文$/.test(t)) return '## Problem Statement';
  if (/^制約$/.test(t)) return '## Constraints';
  if (/^入力$/.test(t)) return '## Input';
  if (/^出力$/.test(t)) return '## Output';
  if (/^配点$/.test(t)) return '## Scoring';
  return `## ${t}`;
}

/**
 * 抓取单个题面页（英文优先，缺失时回退日文）。
 * 返回 { statementMd, samples, timeLimitMs, memoryLimitMb, points, language }
 */
export async function fetchAtCoderStatement(contestId, problemId) {
  const pageUrl = `${ATCODER}/contests/${contestId}/tasks/${problemId}`;
  const html = await httpGet(`${pageUrl}?lang=en`, { timeout: 25000, retries: 2 });
  return parseAtCoderStatementHtml(html, pageUrl);
}

/**
 * 解析题面页 HTML（纯函数：无网络，便于 node:test 直接回归）。
 * @param {string} html 题面页 HTML
 * @param {string} pageUrl 题面页绝对地址（相对链接/图片的基准）
 */
export function parseAtCoderStatementHtml(html, pageUrl) {
  const $ = loadHtml(html);
  const opts = { base: pageUrl };

  // 时限/内存："Time Limit: 2 sec / Memory Limit: 1024 MiB"
  let timeLimitMs = null;
  let memoryLimitMb = null;
  const m = html.match(/Time Limit:\s*([\d.]+)\s*(?:sec|s)\s*\/\s*Memory Limit:\s*(\d+)\s*(MB|MiB)/i);
  if (m) {
    timeLimitMs = Math.round(parseFloat(m[1]) * 1000);
    memoryLimitMb = parseInt(m[2], 10);
  }

  // 英文块优先，缺失回退日文块；早期 ABC（~2013）为单语言结构 span.lang > span
  let container = $('#task-statement span.lang-en').first();
  let language = 'en';
  if (!container.length) {
    container = $('#task-statement span.lang-ja').first();
    language = 'ja';
  }
  if (!container.length) {
    const single = $('#task-statement span.lang > span').first();
    if (single.length) {
      container = single;
      language = /問題|制約|入力|出力/.test(single.text().slice(0, 2000)) ? 'ja' : 'en';
    }
  }
  if (!container.length) container = $('#task-statement').first();
  if (!container.length) throw new Error('statement container not found');

  // 配点："Score : 100 points" / "配点 : 100 点"
  let points = null;
  container.children('p').each((_, p) => {
    const t = $(p).text();
    const pm = t.match(/Score\s*:\s*(\d+)/i) || t.match(/配点\s*:\s*(\d+)/);
    if (pm) {
      points = parseInt(pm[1], 10);
      $(p).remove();
    }
  });

  const sections = [];
  const sampleIn = {};
  const sampleOut = {};
  const sampleNote = {};

  // 小节切分：容器内的 h3 是唯一分隔符。AtCoder 历史上至少有四种版式——
  // ① 现代 div.part > section > h3；② 2015 年平铺 section > h3（abc034 /
  // abc036 / abc041 / arc046 / arc050 / arc052 / arc053 / arc055 实测）；
  // ③ 2012 年 h3 与 section 平级（arc001 等）；④ div.part 内 h3 + section
  // 平级（abc001 / arc002 等）。「深度遍历 + 遇 h3 切段」对四种统一成立，
  // 不要再按 div.part / section 的嵌套关系判断分支（历史 bug：按 div.part
  // 判断，②③④ 全解析成空，CI 每小时报一批 empty statement）。
  const flat = [];
  const flatten = (node) => {
    for (const child of node.children ?? []) {
      const tag = String(child.tagName || '').toLowerCase();
      if (tag === 'h3') flat.push({ heading: $(child).text().trim() });
      else if (tag === 'hr') continue; // 分隔线在 markdown 里会变成噪声 '---'
      else if (tag === 'div' || tag === 'section') flatten(child);
      else flat.push({ node: child });
    }
  };
  flatten(container.get(0));

  const flushGroup = (heading, nodes) => {
    const holder = $('<div>').append(nodes);
    const pres = holder.find('pre');
    const si = heading.match(/^Sample Input\s*(\d+)/i) || heading.match(/^入力例\s*(\d+)/);
    const so = heading.match(/^Sample Output\s*(\d+)/i) || heading.match(/^出力例\s*(\d+)/);
    if (si || so) {
      const n = si ? si[1] : so[1];
      if (pres.length) {
        const text = preText(pres.first());
        if (si) sampleIn[n] = text;
        else sampleOut[n] = text;
      }
      pres.remove();
      // 用 contents()（含裸文本节点）：旧页面 section 内是纯文本 + <var>，
      // children() 只取元素节点，会把正文句子整段丢掉。
      const note = nodesToMd($, holder.contents().toArray(), opts);
      if (note) sampleNote[n] = (sampleNote[n] ? sampleNote[n] + '\n\n' : '') + note;
      return;
    }
    const body = nodesToMd($, holder.contents().toArray(), opts);
    if (heading && body) sections.push(`${sectionHeading(heading)}\n\n${body}`);
    else if (body) sections.push(body);
  };

  let curHeading = null;
  let curNodes = [];
  for (const item of flat) {
    if (item.heading !== undefined) {
      if (curHeading !== null) flushGroup(curHeading, curNodes);
      curHeading = item.heading;
      curNodes = [];
    } else if (curHeading !== null) {
      curNodes.push(item.node);
    }
    // 首个 h3 之前的杂项（旧页的 h4「注意」提示等）丢弃，与旧实现一致
  }
  if (curHeading !== null) flushGroup(curHeading, curNodes);

  const samples = [];
  for (const n of Object.keys(sampleIn)) {
    samples.push({
      input: sampleIn[n] ?? '',
      output: sampleOut[n] ?? '',
      ...(sampleNote[n] ? { note: sampleNote[n] } : {}),
    });
  }

  // 旧页面按字面量输出 \(…\) / \[…\] TeX 定界符，HTML 实体解析偶发控制字符
  // 与 nbsp，入库前与站内渲染同口径清洗归一（lib/render.js）。
  const statementMd = normalizeMathMarks(sanitizeText(sections.join('\n\n').trim()));
  if (!statementMd && samples.length === 0) throw new Error('empty statement');

  return { statementMd, samples, timeLimitMs, memoryLimitMb, points, language };
}

export function atcoderProblemUrl(contestId, problemId) {
  return `${ATCODER}/contests/${contestId}/tasks/${problemId}`;
}

export function atcoderContestUrl(contestId) {
  return `${ATCODER}/contests/${contestId}`;
}

/** kenkoooo rate_change（如 " ~ 1999"）→ 展示用 rated 区间。 */
export function ratedRange(rateChange) {
  if (!rateChange) return null;
  if (rateChange.trim() === '-') return null;
  return rateChange.trim();
}
