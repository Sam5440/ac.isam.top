/**
 * 整场题目导出（纯浏览器，服务端不要 import）。
 *
 * 两种出口共用同一套 ICPC 题面排版：
 *
 *   - PDF：lib/contest-pdf.mjs 按 A4 画布渲染，封面 + 每题独立分页，
 *     页眉/页脚/页码由 ICPC 版式绘制，直接下载，不经过打印窗口；
 *   - HTML：本文件生成自包含文档，公式用 KaTeX 的 MathML 输出，
 *     离线打开也能正常排版与打印。
 *
 * 三种语言版式：zh（中文）/ en（英文）/ both（中文、英文依次排版）。
 * 缺译文时回退另一种语言并在页面内标注，不输出空白题。
 */

import { EXPORT_CSS, renderMarkdownHtml } from './markdown-export.mjs';
import { meaningfulNote } from './sample-notes.js';
import {
  CONTEST_EXPORT_MODES,
  contestExportFileBase,
  normalizeExportMode,
  siteProblemUrl,
} from './contest-export-modes.mjs';
import {
  formatContestDate,
  limitLine,
  pointsLabel,
  problemTitles,
} from './contest-pdf-layout.mjs';

export { CONTEST_EXPORT_MODES, contestExportFileBase, normalizeExportMode, siteProblemUrl };

const PLATFORM_NAMES = { atcoder: 'AtCoder', codeforces: 'Codeforces', 'cf-gyms': 'Gym', nowcoder: '牛客' };

export function platformName(platform) {
  return PLATFORM_NAMES[platform] || platform || '';
}

/**
 * 题面正文样式。作用域固定在 .icpc-sheet 内：同一段 HTML 既用于离线文档，
 * 也会被塞进 SVG foreignObject 栅格化，不能依赖站内 Tailwind / 全局字体。
 */
export const ICPC_SHEET_CSS = `
  .icpc-sheet {
    box-sizing: border-box; background: #fff; color: #111827;
    font-family: "Times New Roman", Georgia, "Songti SC", "Noto Serif CJK SC", "SimSun", serif;
    font-size: 14px; line-height: 1.66; text-rendering: optimizeLegibility;
  }
  .icpc-sheet *, .icpc-sheet *::before, .icpc-sheet *::after { box-sizing: border-box; }
  .icpc-sheet p { margin: 7px 0; text-align: justify; }
  .icpc-sheet h1, .icpc-sheet h2, .icpc-sheet h3, .icpc-sheet h4 {
    margin: 18px 0 7px; line-height: 1.28; font-weight: 700; break-after: avoid;
  }
  .icpc-sheet h1 { font-size: 19px; }
  .icpc-sheet h2 { font-size: 15.5px; }
  .icpc-sheet h3 { font-size: 14px; }
  .icpc-sheet h4 { font-size: 13px; }
  .icpc-sheet ul, .icpc-sheet ol { margin: 7px 0; padding-left: 24px; }
  .icpc-sheet li { margin: 3px 0; }
  .icpc-sheet a { color: #1d4ed8; text-decoration: underline; text-underline-offset: 2px; }
  .icpc-sheet img { max-width: 100%; height: auto; }
  .icpc-sheet code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: .88em; background: #f3f4f6; border-radius: 3px; padding: 0 .24em;
  }
  .icpc-sheet pre {
    margin: 10px 0; padding: 10px 12px; background: #f7f8fa; border: 1px solid #e5e7eb;
    border-radius: 4px; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .icpc-sheet pre code { background: none; border: 0; padding: 0; font-size: inherit; }
  .icpc-sheet table {
    width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12.5px;
    table-layout: fixed;
  }
  .icpc-sheet th, .icpc-sheet td {
    border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; overflow-wrap: anywhere;
  }
  .icpc-sheet th { background: #f3f4f6; font-weight: 600; }
  .icpc-sheet blockquote {
    margin: 9px 0; padding: 2px 12px; border-left: 3px solid #d1d5db; color: #4b5563;
  }
  .icpc-sheet hr { border: 0; border-top: 1px solid #d1d5db; margin: 16px 0; }
  .icpc-sheet math { font-size: 1.06em; }
  .icpc-sheet .zs-math { white-space: nowrap; }
  .icpc-sheet .icpc-fallback {
    margin: 0 0 12px; padding: 8px 10px; border-left: 3px solid #f59e0b;
    background: #fffbeb; color: #92400e; font-size: 12px;
  }
  .icpc-sheet .missing { color: #4b5563; font-style: italic; }
  .icpc-sheet .lang-tag {
    display: inline-block; margin: 0 0 6px; padding: 1px 7px; border: 1px solid #d1d5db;
    border-radius: 999px; color: #4b5563; font-size: 10px; font-weight: 700;
    letter-spacing: .1em; text-transform: uppercase;
  }
  .icpc-sheet .lang-block + .lang-block {
    margin-top: 20px; padding-top: 16px; border-top: 1px dashed #d1d5db;
  }
  .icpc-sheet .samples { margin-top: 6px; }
  .icpc-sheet .sample-block { margin: 0 0 14px; }
  .icpc-sheet .sample-label { margin: 13px 0 5px; font-size: 13.5px; font-weight: 700; }
  .icpc-sheet .sample-box {
    margin: 0; padding: 9px 11px; background: #f7f8fa; border: 1px solid #dfe3e8;
    border-radius: 4px; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap;
    word-break: break-word;
  }
  .icpc-sheet .sample-note { margin: 6px 0 0; color: #374151; font-size: 12.5px; }
  .icpc-sheet .sample-note p { margin: 3px 0; }
  .icpc-sheet .sample-note + .sample-note { margin-top: 3px; }
  .icpc-sheet .sample-missing { margin: 4px 0 0; color: #6b7280; font-size: 11px; }
  .icpc-sheet .problem-source {
    margin-top: 20px; padding-top: 8px; border-top: 1px solid #e5e7eb;
    color: #6b7280; font-size: 10px; line-height: 1.5; overflow-wrap: anywhere;
  }
  .icpc-sheet .img-missing {
    display: inline-block; padding: 2px 8px; border: 1px dashed #cbd5e1;
    border-radius: 4px; color: #6b7280; font-size: .88em;
  }
`;

/** 离线 HTML 的外壳（封面 / 题页 / 打印分页）。 */
const ICPC_DOC_CSS = `
  body { background: #fff; color: #111827; }
  .icpc-doc { max-width: 780px; margin: 0 auto; padding: 28px 22px 64px; }
  .icpc-cover { padding: 12px 0 34px; break-after: page; page-break-after: always; }
  .icpc-cover .cover-kicker {
    color: #6b7280; font-size: 10px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase;
  }
  .icpc-cover h1 { margin: 8px 0 4px; font-size: 30px; line-height: 1.18; }
  .icpc-cover .cover-subtitle { margin: 0 0 18px; color: #4b5563; font-size: 14px; }
  .icpc-cover .cover-meta { color: #4b5563; font-size: 12px; }
  .icpc-cover .cover-meta .dot { margin: 0 7px; color: #9ca3af; }
  .icpc-cover .cover-links { margin-top: 8px; color: #374151; font-size: 11px; overflow-wrap: anywhere; }
  .icpc-cover .cover-links a { color: #1d4ed8; }
  .icpc-cover .cover-rule { border: 0; border-top: 1.5px solid #111827; margin: 22px 0 18px; }
  .icpc-cover .cover-list-title {
    color: #374151; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
  }
  .icpc-cover .cover-problems { list-style: none; margin: 10px 0 0; padding: 0; }
  .icpc-cover .cover-problems li {
    display: flex; gap: 12px; padding: 5px 0; border-bottom: 1px dotted #e5e7eb; font-size: 13px;
  }
  .icpc-cover .cover-problems .lab { width: 3.2em; flex: none; font-weight: 700; color: #111827; }
  .icpc-cover .cover-problems .title { min-width: 0; }
  .problem-sheet { break-before: page; page-break-before: always; padding: 0 0 28px; }
  .icpc-cover + .problem-sheet { break-before: auto; page-break-before: auto; }
  .problem-sheet .icpc-problem-head {
    margin: 0 0 18px; padding-bottom: 10px; border-bottom: 1.5px solid #111827;
  }
  .problem-sheet .kicker {
    color: #4b5563; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
  }
  .problem-sheet h1 { margin: 5px 0 0; padding: 0; border: 0; font-size: 25px; line-height: 1.2; }
  .problem-sheet .title-en { margin-top: 3px; color: #6b7280; font-size: 12.5px; }
  .problem-sheet .limits { margin-top: 8px; color: #374151; font-size: 12px; }
  .problem-sheet .points { float: right; color: #374151; font-size: 12px; }
  .problem-sheet .problem-source { margin-top: 22px; }
  @media screen and (max-width: 760px) {
    .icpc-doc { padding: 20px 16px 48px; }
    .icpc-cover h1 { font-size: 25px; }
  }
  @page { size: A4; margin: 15mm 15mm 18mm; }
  @media print {
    body { font-size: 10.5pt; }
    .icpc-doc { max-width: none; padding: 0; }
    .problem-sheet { padding-bottom: 0; }
    a { color: #1d4ed8 !important; }
  }
`;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plain(s) {
  return escapeHtml(String(s ?? '').replace(/\s+/g, ' ').trim());
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** 题面自带的一级小节标题（AtCoder / 牛客）在 ICPC 版式里是多余的。 */
export function stripProblemStatementHeading(md) {
  return String(md ?? '').replace(
    /^\s*#{1,6}\s*(?:problem\s+statement|题目描述|问题描述|题目大意|description)\s*\r?\n+/i,
    '',
  );
}

function statementHtml(problem, lang) {
  const en = trimText(problem?.statementMd);
  const zh = trimText(problem?.statementZhMd);
  if (lang === 'zh') {
    if (zh) return { html: renderMarkdownHtml(stripProblemStatementHeading(zh)), note: '' };
    if (en) {
      return {
        html: renderMarkdownHtml(stripProblemStatementHeading(en)),
        note: '本题暂无中文翻译，以下为英文原文。',
      };
    }
    return { html: '<p class="missing">本题题面尚未抓取。</p>', note: '' };
  }
  if (en) return { html: renderMarkdownHtml(stripProblemStatementHeading(en)), note: '' };
  if (zh) {
    return {
      html: renderMarkdownHtml(stripProblemStatementHeading(zh)),
      note: '本站暂无英文原文，以下为官方中文题面。',
    };
  }
  return { html: '<p class="missing">本题题面尚未抓取。</p>', note: '' };
}

function sampleLabels(lang, index) {
  return lang === 'zh'
    ? { input: `样例输入 ${index}`, output: `样例输出 ${index}` }
    : { input: `Sample Input ${index}`, output: `Sample Output ${index}` };
}

/**
 * 样例区：Input / Output 成对，说明按语言模式选择。
 * CF 的 "InputCopy / OutputCopy" 样板说明会被 meaningfulNote 过滤掉。
 */
export function buildSamplesHtml(samples, mode = 'zh') {
  const list = Array.isArray(samples) ? samples : [];
  if (!list.length) return '';
  const blocks = [];
  let index = 0;

  for (const sample of list) {
    if (!sample || typeof sample !== 'object') continue;
    const enNote = meaningfulNote(sample.note);
    const zhNote = trimText(sample.noteZh);
    const hasInput = sample.input != null;
    const hasOutput = sample.output != null;
    if (!hasInput && !hasOutput && !enNote && !zhNote) continue;

    index += 1;
    const lang = mode === 'zh' ? 'zh' : 'en';
    const labels = sampleLabels(lang, index);
    const parts = [];
    if (hasInput) {
      parts.push(`<h2 class="sample-label">${labels.input}</h2>`);
      parts.push(`<pre class="sample-box">${escapeHtml(sample.input)}</pre>`);
    }
    if (hasOutput) {
      parts.push(`<h2 class="sample-label">${labels.output}</h2>`);
      parts.push(`<pre class="sample-box">${escapeHtml(sample.output)}</pre>`);
    }

    if (mode === 'zh') {
      if (zhNote) parts.push(`<div class="sample-note md-body">${renderMarkdownHtml(zhNote)}</div>`);
      else if (enNote) {
        parts.push(`<div class="sample-note md-body">${renderMarkdownHtml(enNote)}</div>`);
        parts.push('<p class="sample-missing">（样例说明暂无中文译文，以上为英文原文）</p>');
      }
    } else if (mode === 'en') {
      if (enNote) parts.push(`<div class="sample-note md-body" data-note-lang="en">${renderMarkdownHtml(enNote)}</div>`);
    } else {
      if (enNote) parts.push(`<div class="sample-note md-body" data-note-lang="en">${renderMarkdownHtml(enNote)}</div>`);
      if (zhNote) parts.push(`<div class="sample-note md-body" data-note-lang="zh">${renderMarkdownHtml(zhNote)}</div>`);
    }

    blocks.push(`<div class="sample-block">${parts.join('')}</div>`);
  }

  return blocks.length ? `<section class="samples">${blocks.join('')}</section>` : '';
}

function rawStatement(problem, lang) {
  const md = lang === 'zh' ? trimText(problem?.statementZhMd) : trimText(problem?.statementMd);
  return md ? renderMarkdownHtml(stripProblemStatementHeading(md)) : '';
}

function sourceLine(problem) {
  const platform = platformName(problem?.platform);
  const id = String(problem?.id ?? '').trim();
  const bits = [platform, id].filter(Boolean);
  return bits.length ? `<p class="problem-source">来源：${escapeHtml(bits.join(' · '))}</p>` : '';
}

function linksFooter({ origin, problem }) {
  const site = siteProblemUrl(origin, problem?.platform, problem?.id);
  const original = problem?.url || problem?.originalUrl || '';
  return `<p class="problem-source">本站题目：<a href="${escapeHtml(site)}">${escapeHtml(site)}</a>` +
    (original ? `<br>原题：<a href="${escapeHtml(original)}">${escapeHtml(original)}</a>` : '') +
    '</p>';
}

/**
 * 单题正文（不含题头）。PDF 渲染器和 HTML 导出共用。
 * includeLinks=false 用于 PDF：正文里只留平台/题号，不放长链接。
 */
export function buildProblemBodyHtml({ problem, mode = 'zh', origin = '', includeLinks = true }) {
  if (problem?.found === false) {
    const original = problem?.url || problem?.originalUrl || '';
    return `<p class="missing">本站未收录本题，题面请通过${original ? ` <a href="${escapeHtml(original)}">原题链接</a>` : '原题链接'}查看。</p>` +
      (includeLinks ? linksFooter({ origin, problem }) : sourceLine(problem));
  }

  const hasEn = Boolean(trimText(problem?.statementMd));
  const hasZh = Boolean(trimText(problem?.statementZhMd));
  let body = '';
  let fallback = '';

  if (mode === 'both') {
    if (hasZh && hasEn) {
      body =
        `<section class="lang-block"><span class="lang-tag">中文</span>${rawStatement(problem, 'zh')}</section>` +
        `<section class="lang-block"><span class="lang-tag">English</span>${rawStatement(problem, 'en')}</section>`;
    } else if (hasZh) {
      fallback = '本站暂无英文原文，以下为中文题面。';
      body = rawStatement(problem, 'zh');
    } else if (hasEn) {
      fallback = '本题暂无中文翻译，以下为英文原文。';
      body = rawStatement(problem, 'en');
    } else {
      body = '<p class="missing">本题题面尚未抓取。</p>';
    }
  } else {
    const statement = statementHtml(problem, mode);
    fallback = statement.note;
    body = statement.html;
  }

  const samples = buildSamplesHtml(problem?.samples, mode);
  const html = `${fallback ? `<p class="icpc-fallback">${escapeHtml(fallback)}</p>` : ''}${body}${samples}` +
    (includeLinks ? linksFooter({ origin, problem }) : sourceLine(problem));
  // marked 会在块级内容之间留下空段落；空 <p> 在 DOM 与 SVG foreignObject 里的
  // 外边距折叠不一致，会让分页坐标漂移，导出前直接去掉。
  return html.replace(/<p(?:\s[^>]*)?>\s*<\/p>/gi, '');
}

/** 单题题头（HTML 版；PDF 的题头由 canvas 直接绘制）。 */
export function buildProblemHeaderHtml({ problem, label, mode = 'zh' }) {
  const titles = problemTitles(problem, mode);
  const limits = limitLine(problem, mode);
  const points = pointsLabel(problem?.points, mode);
  const platform = platformName(problem?.platform);
  const originalIndex = problem?.index ? `原题号 ${problem.index}` : '';
  const meta = [platform, originalIndex].filter(Boolean).map(escapeHtml).join('<span class="dot"> · </span>');
  return `<header class="icpc-problem-head">
  <div class="kicker">Problem ${plain(label ?? problem?.index ?? '')}</div>
  <h1>${plain(titles.primary)}</h1>
  ${titles.secondary ? `<div class="title-en">${plain(titles.secondary)}</div>` : ''}
  <div class="limits">${meta}${limits ? `${meta ? '<span class="dot"> · </span>' : ''}${escapeHtml(limits)}` : ''}${points ? `<span class="points">${escapeHtml(points)}</span>` : ''}</div>
</header>`;
}

export function buildProblemSheetHtml({ problem, label, mode = 'zh', origin = '' }) {
  return `<section class="problem-sheet icpc-sheet">
${buildProblemHeaderHtml({ problem, label, mode })}
${buildProblemBodyHtml({ problem, mode, origin, includeLinks: true })}
</section>`;
}

function contestTitle(contest, mode) {
  const en = trimText(contest?.title);
  const zh = trimText(contest?.titleZh);
  if (mode === 'en') {
    return { primary: en || zh || 'Untitled Contest', secondary: en && zh && en !== zh ? zh : '' };
  }
  return { primary: zh || en || '未命名比赛', secondary: zh && en && zh !== en ? en : '' };
}

function contestMetaBits(contest, count) {
  const bits = [];
  const platform = platformName(contest?.platform);
  if (platform) bits.push(platform);
  if (contest?.id) bits.push(`比赛 ${contest.id}`);
  const date = formatContestDate(contest?.startTime);
  if (date) bits.push(date);
  const seconds = Number(contest?.durationSeconds) || (Number(contest?.minutes) || 0) * 60;
  if (seconds > 0) bits.push(`${Math.round(seconds / 60)} 分钟`);
  bits.push(`${count} 题`);
  return bits;
}

/**
 * 生成整场导出的完整 HTML 文档（ICPC 版式，每题强制新页）。
 *
 * @param {object}   opts
 * @param {object}   opts.contest
 * @param {Array}    opts.problems
 * @param {'zh'|'en'|'both'} opts.mode
 * @param {string}   opts.origin
 * @param {string}   [opts.siteUrl]
 * @param {string}   [opts.exportedAt]
 */
export function buildContestExportHtml({ contest, problems, mode, origin, siteUrl, exportedAt }) {
  const format = normalizeExportMode(mode);
  const list = Array.isArray(problems) ? problems : [];
  const titles = contestTitle(contest, format);
  const platform = platformName(contest?.platform);
  const site = siteUrl || `${String(origin || '').replace(/\/+$/, '')}/contests/${encodeURIComponent(contest?.platform ?? '')}/${encodeURIComponent(String(contest?.id ?? ''))}`;
  const original = contest?.url || '';
  const metaBits = contestMetaBits(contest, list.length).map(escapeHtml).join('<span class="dot">·</span>');
  const coverList = list.map((problem, i) => {
    const label = problem?.label ?? problem?.index ?? String(i + 1);
    return `<li><span class="lab">${plain(label)}</span><span class="title">${plain(problemTitles(problem, format).primary)}</span></li>`;
  }).join('\n');
  const sheets = list.map((problem, i) => buildProblemSheetHtml({
    problem,
    label: problem?.label ?? problem?.index ?? String(i + 1),
    mode: format,
    origin,
  })).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${plain(titles.primary)} · Problems</title>
<style>${EXPORT_CSS}
${ICPC_SHEET_CSS}
${ICPC_DOC_CSS}</style>
</head>
<body>
<main class="icpc-doc">
<section class="icpc-cover icpc-sheet">
  <div class="cover-kicker">ICPC-Style Problem Set</div>
  <h1>${plain(titles.primary)}</h1>
  ${titles.secondary ? `<p class="cover-subtitle">${plain(titles.secondary)}</p>` : ''}
  <div class="cover-meta">${metaBits}</div>
  <div class="cover-links">本站比赛：<a href="${escapeHtml(site)}">${escapeHtml(site)}</a>${original ? `<br>原站比赛：<a href="${escapeHtml(original)}">${escapeHtml(original)}</a>` : ''}</div>
  <hr class="cover-rule">
  <div class="cover-list-title">Problems</div>
  <ol class="cover-problems">${coverList}</ol>
</section>
${sheets}
${exportedAt ? `<p class="problem-source">由 AC 题库（ac.yslsy.top）导出 · ${escapeHtml(exportedAt)} · 题目版权归原站所有</p>` : ''}
</main>
</body>
</html>`;
}
