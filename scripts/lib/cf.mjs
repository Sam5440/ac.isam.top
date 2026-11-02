import { httpGet } from './http.mjs';
import { loadHtml, nodesToMd, preText, inlineMd } from './html2md.mjs';

const CF = 'https://codeforces.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** contest.list → 已结束的正式赛（type=CF 常规赛 / type=ICPC 的 Div.3、Div.4、Educational 等），新→旧。 */
export async function fetchCfContests() {
  const data = await httpGet(`${CF}/api/contest.list`, { json: true, timeout: 20000 });
  if (data.status !== 'OK') throw new Error('contest.list failed');
  return data.result
    .filter((c) => c.phase === 'FINISHED' && (c.type === 'CF' || c.type === 'ICPC'))
    .sort((a, b) => b.id - a.id);
}

/** problemset.problems → { byProblem: {'2277A': {name,rating,tags,points}}, byContest: {id: [...]} } */
export async function fetchCfProblemset() {
  const data = await httpGet(`${CF}/api/problemset.problems`, { json: true, timeout: 30000 });
  if (data.status !== 'OK') throw new Error('problemset.problems failed');
  const byProblem = {};
  const byContest = {};
  for (const p of data.result.problems) {
    if (!p.contestId) continue;
    const entry = {
      name: p.name,
      rating: p.rating ?? null,
      tags: p.tags ?? [],
      ...(p.points != null ? { points: p.points } : {}),
    };
    byProblem[`${p.contestId}${p.index}`] = entry;
    (byContest[p.contestId] ??= []).push({ index: p.index, ...entry });
  }
  for (const list of Object.values(byContest)) {
    list.sort((a, b) => a.index.localeCompare(b.index, undefined, { numeric: true }));
  }
  return { byProblem, byContest };
}

export function cfContestUrl(contestId) {
  return `${CF}/contest/${contestId}`;
}

export function cfProblemUrl(contestId, index) {
  return `${CF}/contest/${contestId}/problem/${index}`;
}

/**
 * Codeforces 数学标记归一：题面源码用 $$$…$$$（行内）与 $$$$$$…$$$$$$（块级），
 * 部分新版页面直接以字面量出现在 HTML 文本里。统一转成 $…$ / $$…$$。
 * 必须先替换 6 美元再替换 3 美元，避免块级公式被行内规则拆碎。
 */
export function normalizeCfMath(md) {
  if (!md) return md;
  return String(md)
    .replace(/\$\$\$\$\$\$([\s\S]+?)\$\$\$\$\$\$/g, (_, t) => `$$${t}$$`)
    .replace(/\$\$\$([\s\S]+?)\$\$\$/g, (_, t) => `$${t}$`);
}

/* ---------------- Playwright 会话 ---------------- */

let browserHandle = null;

/** 懒启动共享浏览器（真实 Chromium 过 Cloudflare）。 */
export async function getCfPage() {
  if (!browserHandle) {
    const { chromium } = await import('playwright');
    const headless = process.env.CF_HEADLESS !== '0';
    browserHandle = await chromium.launch({ headless });
  }
  const ctx = await browserHandle.newContext({
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  return { page, ctx };
}

export async function closeCfBrowser() {
  if (browserHandle) {
    await browserHandle.close().catch(() => {});
    browserHandle = null;
  }
}

/** 抓取比赛整页题面（一次导航拿全部题目）。失败抛错由调用方记录。 */
export async function fetchCfContestHtml(contestId, page) {
  const url = `${CF}/contest/${contestId}/problems`;
  await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });
  // Cloudflare 质询页在真实 Chromium 下数秒内自动通过
  const deadline = Date.now() + 75000;
  for (;;) {
    const html = await page.content();
    const ok = html.includes('problem-statement');
    const challenged = /Just a moment|cf-challenge/i.test(html);
    if (ok && !challenged) return html;
    if (Date.now() > deadline) {
      throw new Error(challenged ? 'cloudflare challenge not resolved' : 'no problem statements on page');
    }
    await page.waitForTimeout(2500);
  }
}

/** 解析 /problems 页 → [{index, title, statementMd, samples, timeLimitMs, memoryLimitMb, points}] */
export function parseCfProblemsPage(html, contestId) {
  const $ = loadHtml(html);
  const out = [];
  $('div.problem-statement').each((_, stmtNode) => {
    const stmt = $(stmtNode);
    const opts = { base: `${CF}/contest/${contestId}/problems` };

    const titleRaw = stmt.find('.header .title').first().text().trim();
    const tm = titleRaw.match(/^([A-Z][0-9]?)\.\s*(.+)$/s);
    const index = tm ? tm[1] : titleRaw.split('.')[0];
    const title = tm ? tm[2].trim() : titleRaw;

    let timeLimitMs = null;
    let memoryLimitMb = null;
    const tl = stmt.find('.header .time-limit').first().text().match(/([\d.]+)\s*(second|s|ms|millisecond)/i);
    if (tl) {
      timeLimitMs = /ms|millisecond/i.test(tl[2])
        ? Math.round(parseFloat(tl[1]))
        : Math.round(parseFloat(tl[1]) * 1000);
    }
    const ml = stmt.find('.header .memory-limit').first().text().match(/(\d+)\s*(mega|mb)/i);
    if (ml) memoryLimitMb = parseInt(ml[1], 10);

    const blocks = [];
    const samples = [];

    // 样例：.sample-test 内 input/output 顺序配对
    const sampleTests = stmt.find('div.sample-tests');
    const inputs = sampleTests.find('.sample-test > .input').toArray().map((n) => $(n));
    const outputs = sampleTests.find('.sample-test > .output').toArray().map((n) => $(n));
    for (let i = 0; i < Math.max(inputs.length, outputs.length); i++) {
      const sample = { input: '', output: '' };
      let note = '';
      const inp = inputs[i];
      const outp = outputs[i];
      if (inp) {
        const pre = inp.find('pre').first();
        if (pre.length) sample.input = preText(pre);
        pre?.remove();
        const rest = nodesToMd($, inp.children().toArray(), opts);
        if (rest) note += (note ? '\n\n' : '') + rest;
      }
      if (outp) {
        const pre = outp.find('pre').first();
        if (pre.length) sample.output = preText(pre);
        pre?.remove();
        const rest = nodesToMd($, outp.children().toArray(), opts);
        if (rest) note += (note ? '\n\n' : '') + rest;
      }
      if (note) sample.note = note;
      samples.push(sample);
    }

    // 主体：header 与样例之外的直接子节点
    stmt.children().each((_, node) => {
      const el = $(node);
      const tag = node.tagName;
      const cls = el.attr('class') || '';
      if (tag === 'div' && /(^|\s)header(\s|$)/.test(cls)) return; // 头部已处理
      if (tag === 'div' && /\bsample-tests\b/.test(cls)) return; // 样例已处理
      if (tag === 'div' && /(^|\s)(input|output)-specification(\s|$)/.test(cls)) {
        const name = /input/.test(cls) ? 'Input' : 'Output';
        el.find('.section-title').first().remove();
        const body = nodesToMd($, el.contents().toArray(), opts);
        blocks.push(`## ${name}\n\n${body}`);
        return;
      }
      if (tag === 'div' && /\bnote\b/.test(cls)) {
        el.find('.section-title').first().remove();
        const body = nodesToMd($, el.contents().toArray(), opts);
        blocks.push(`## Note\n\n${body}`);
        return;
      }
      if (tag === 'div' && /section-title/.test(cls)) {
        const t = el.clone().children().remove().end().text().trim();
        if (t) blocks.push(`## ${t}`);
        return;
      }
      // 交互题等其它小节容器 / 普通 <p>
      if (tag === 'p') {
        const md = inlineMd($, el, opts);
        if (md) blocks.push(md);
        return;
      }
      if (tag === 'div') {
        const hasSectionTitle = el.find('.section-title').length > 0;
        if (hasSectionTitle) {
          const t = el.find('.section-title').first().clone().children().remove().end().text().trim();
          el.find('.section-title').first().remove();
          const body = nodesToMd($, el.contents().toArray(), opts);
          blocks.push(`## ${t || 'Interaction'}\n\n${body}`);
          return;
        }
        const md = nodesToMd($, el.contents().toArray(), opts);
        if (md) blocks.push(md);
        return;
      }
      const md = nodesToMd($, [node], opts);
      if (md) blocks.push(md);
    });

    const statementMd = normalizeCfMath(blocks.join('\n\n').trim());
    if (index && title) out.push({ index, title, statementMd, samples, timeLimitMs, memoryLimitMb });
  });
  return out;
}
