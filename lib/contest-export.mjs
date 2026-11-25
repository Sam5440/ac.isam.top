/**
 * 整场题目导出（纯浏览器，服务端不要 import）。
 *
 * 生成一份自包含的 HTML 文档，交给浏览器打印可「另存为 PDF」（文字可选中），
 * 也可以直接下载成 .html 离线保存。三种版式：
 *
 *   zh    纯中文（缺译文时回退英文并标注）
 *   en    纯英文（缺英文原文时回退官方中文并标注）
 *   both  左中文 / 右英文两栏，每题独立分页
 *
 * 每道题都带两个绝对链接：本站题目页与原站题目页。公式用 KaTeX 的 MathML
 * 输出（同 lib/markdown-export.mjs），打印时不需要站内 CSS/字体。
 */

import { EXPORT_CSS, renderMarkdownHtml } from './markdown-export.mjs';
import { CONTEST_EXPORT_MODES, contestExportFileBase, normalizeExportMode, siteProblemUrl } from './contest-export-modes.mjs';

export { CONTEST_EXPORT_MODES, contestExportFileBase, normalizeExportMode, siteProblemUrl };

const PLATFORM_NAMES = { atcoder: 'AtCoder', codeforces: 'Codeforces', 'cf-gyms': 'Gym', nowcoder: '牛客' };

const CONTEST_CSS = `
  body { font-size: 11.5pt; }
  .doc { padding: 0; }
  .cover { break-after: page; page-break-after: always; padding-bottom: 6mm; }
  .cover-kicker { font-size: 9.5pt; letter-spacing: .12em; color: #6b7280; text-transform: uppercase; }
  .cover h1 { font-size: 24pt; margin: .2em 0 .15em; }
  .cover .subtitle { font-size: 12pt; color: #374151; margin: 0 0 4mm; }
  .meta { color: #4b5563; font-size: 9.5pt; }
  .meta .dot { margin: 0 6px; color: #9ca3af; }
  .cover-links, .problem-links { font-size: 9.5pt; margin-top: 2mm; word-break: break-all; }
  .cover-links a, .problem-links a { color: #1d4ed8; }
  .toc { margin-top: 7mm; font-size: 10.5pt; }
  .toc li { margin: 1.6mm 0; }
  .toc .toc-label { display: inline-block; min-width: 2.2em; font-weight: 650; }
  .problem-sheet { break-before: page; page-break-before: always; }
  .cover + .problem-sheet { break-before: auto; page-break-before: auto; }
  .problem-head { border-bottom: 1.5px solid #d1d5db; padding-bottom: 3mm; margin-bottom: 4mm; }
  .problem-head h2 { border: 0; margin: 0 0 1.5mm; padding: 0; font-size: 16pt; }
  .problem-head .label { display: inline-block; min-width: 1.6em; margin-right: .4em; color: #1d4ed8; }
  .problem-head .title-en { display: block; font-size: 10.5pt; color: #4b5563; font-weight: 500; margin-top: 1mm; }
  .side-by-side { display: grid; grid-template-columns: 1fr 1fr; align-items: start; }
  .side { min-width: 0; padding-right: 6mm; }
  .side + .side { border-left: 1px solid #d8dee4; padding-right: 0; padding-left: 6mm; }
  .side-tag { font-size: 9pt; letter-spacing: .1em; color: #6b7280; margin: 0 0 2mm; }
  .md-body h2 { font-size: 1.2em; }
  .md-body h3 { font-size: 1.05em; }
  .stmt { font-size: 10.5pt; }
  .fallback { margin: 0 0 3mm; padding: 2mm 3mm; border-left: 3px solid #f59e0b; background: #fffbeb; color: #92400e; font-size: 9.5pt; }
  .samples { margin-top: 5mm; }
  .samples h3 { font-size: 11pt; margin: 0 0 2mm; }
  .sample { margin: 0 0 4mm; break-inside: avoid; page-break-inside: avoid; }
  .sample-label { font-size: 9pt; color: #6b7280; margin: 1.5mm 0 1mm; font-weight: 600; }
  .sample-box { margin: 0; padding: 2mm 3mm; background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 3px; font-size: 9pt; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .sample-note { font-size: 9pt; color: #4b5563; margin: 1.5mm 0 0; }
  .sample-note p { margin: .2em 0; }
  .sample-missing { font-size: 8.5pt; color: #6b7280; margin: 1mm 0 0; }
  .missing { color: #6b7280; font-style: italic; }
  .doc-footer { margin-top: 6mm; font-size: 9pt; color: #6b7280; }
  pre, table { max-width: 100%; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  table { table-layout: fixed; }
  th, td { overflow-wrap: anywhere; }
  @media print {
    body { font-size: 10.5pt; }
    .stmt { font-size: 10pt; }
    .cover h1 { font-size: 22pt; }
    a { color: #1d4ed8 !important; }
    .sample-box, .fallback, th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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

function samplesHtml(samples, lang) {
  const list = Array.isArray(samples) ? samples : [];
  if (!list.length) return '';
  const t = lang === 'zh'
    ? { title: '样例', input: '输入', output: '输出' }
    : { title: 'Samples', input: 'Input', output: 'Output' };
  const blocks = list.map((s, i) => {
    const zhNote = typeof s?.noteZh === 'string' ? s.noteZh.trim() : '';
    const enNote = typeof s?.note === 'string' ? s.note.trim() : '';
    const note = lang === 'zh' ? (zhNote || enNote) : enNote;
    const missingZh = lang === 'zh' && !zhNote && Boolean(enNote);
    return `<div class="sample">
  <div class="sample-label">${t.input} ${i + 1}</div>
  <pre class="sample-box">${escapeHtml(s?.input ?? '')}</pre>
  <div class="sample-label">${t.output} ${i + 1}</div>
  <pre class="sample-box">${escapeHtml(s?.output ?? '')}</pre>
  ${note ? `<div class="sample-note md-body">${renderMarkdownHtml(note)}</div>` : ''}
  ${missingZh ? '<p class="sample-missing">（样例说明暂无中文译文，以上为英文原文）</p>' : ''}
</div>`;
  }).join('\n');
  return `<section class="samples"><h3>${t.title}</h3>${blocks}</section>`;
}

function statementHtml(problem, lang) {
  const en = typeof problem?.statementMd === 'string' ? problem.statementMd.trim() : '';
  const zh = typeof problem?.statementZhMd === 'string' ? problem.statementZhMd.trim() : '';
  if (lang === 'zh') {
    if (zh) return { html: renderMarkdownHtml(zh), note: '' };
    if (en) return { html: renderMarkdownHtml(en), note: '本题暂无中文翻译，以下为英文原文。' };
    return { html: '<p class="missing">本题题面尚未抓取。</p>', note: '' };
  }
  if (en) return { html: renderMarkdownHtml(en), note: '' };
  if (zh) return { html: renderMarkdownHtml(zh), note: '本站暂无英文原文，以下为官方中文题面。' };
  return { html: '<p class="missing">本题题面尚未抓取。</p>', note: '' };
}

function problemTitle(problem, lang) {
  const en = String(problem?.title ?? '').trim();
  const zh = String(problem?.titleZh ?? '').trim();
  if (lang === 'zh') return zh || en || String(problem?.id ?? '');
  return en || zh || String(problem?.id ?? '');
}

function secondaryTitle(problem, lang) {
  const en = String(problem?.title ?? '').trim();
  const zh = String(problem?.titleZh ?? '').trim();
  const other = lang === 'zh' ? en : zh;
  const primary = lang === 'zh' ? zh || en : en || zh;
  return other && other !== primary ? other : '';
}

function linksHtml(origin, problem) {
  const site = siteProblemUrl(origin, problem?.platform, problem?.id);
  const original = problem?.url || problem?.originalUrl || '';
  return `<div class="problem-links">本站：<a href="${escapeHtml(site)}">${escapeHtml(site)}</a>` +
    (original ? `<br>原题：<a href="${escapeHtml(original)}">${escapeHtml(original)}</a>` : '') +
    '</div>';
}

function problemMeta(problem) {
  const bits = [];
  const platform = PLATFORM_NAMES[problem?.platform] || problem?.platform || '';
  if (platform) bits.push(platform);
  if (Number.isFinite(Number(problem?.timeLimitMs)) && Number(problem.timeLimitMs) > 0) {
    bits.push(`时间 ${Math.round(Number(problem.timeLimitMs) / 100) / 10}s`);
  }
  if (Number.isFinite(Number(problem?.memoryLimitMb)) && Number(problem.memoryLimitMb) > 0) {
    bits.push(`内存 ${Number(problem.memoryLimitMb)}MB`);
  }
  if (Number.isFinite(Number(problem?.difficulty))) bits.push(`难度 ${Number(problem.difficulty)}`);
  if (Number.isFinite(Number(problem?.points))) bits.push(`${Number(problem.points)} 分`);
  if (problem?.index) bits.push(`原题号 ${problem.index}`);
  return bits.map((b) => escapeHtml(b)).join('<span class="dot">·</span>');
}

function statementBlock(problem, lang) {
  if (problem?.found === false) {
    return `<p class="missing">本站未收录本题，题面请通过上面的原题链接查看。</p>`;
  }
  const { html, note } = statementHtml(problem, lang);
  return `${note ? `<p class="fallback">${escapeHtml(note)}</p>` : ''}<div class="md-body stmt">${html}</div>${samplesHtml(problem?.samples, lang)}`;
}

function problemSheet({ origin, problem, label, mode }) {
  const lang = mode === 'en' ? 'en' : 'zh';
  const head = (titleLang, showSecondary) => {
    const title = problemTitle(problem, titleLang);
    const sub = showSecondary ? secondaryTitle(problem, titleLang) : '';
    return `<header class="problem-head">
  <h2><span class="label">${plain(label ?? problem?.index ?? '')}</span>${plain(title)}</h2>
  ${sub ? `<div class="title-en">${plain(sub)}</div>` : ''}
  <div class="meta">${problemMeta(problem)}</div>
  ${linksHtml(origin, problem)}
</header>`;
  };

  if (mode === 'both') {
    return `<section class="problem-sheet">
${head('zh', true)}
<div class="side-by-side">
  <div class="side"><div class="side-tag">中文</div>${statementBlock(problem, 'zh')}</div>
  <div class="side"><div class="side-tag">ENGLISH</div>${statementBlock(problem, 'en')}</div>
</div>
</section>`;
  }

  return `<section class="problem-sheet">
${head(lang, false)}
${statementBlock(problem, lang)}
</section>`;
}

function contestTitle(contest) {
  const en = String(contest?.title ?? '').trim();
  const zh = String(contest?.titleZh ?? '').trim();
  return { en, zh, primary: zh || en || '未命名比赛', secondary: en && zh && en !== zh ? en : '' };
}

/**
 * 生成整场导出的完整 HTML 文档。
 *
 * @param {object}   opts
 * @param {object}   opts.contest    { id, platform, title, titleZh, url, startTime, durationSeconds }
 * @param {Array}    opts.problems   题目数组；每项可带 statementMd/statementZhMd/samples/url/id/index/title/titleZh
 * @param {'zh'|'en'|'both'} opts.mode
 * @param {string}   opts.origin     本站 origin（如 https://ac.yslsy.top）
 * @param {string}   [opts.siteUrl]  本站比赛页绝对链接（模拟赛带 #data= 时用）
 * @param {string}   [opts.exportedAt] 页脚时间文案
 */
export function buildContestExportHtml({ contest, problems, mode, origin, siteUrl, exportedAt }) {
  const format = normalizeExportMode(mode);
  const list = Array.isArray(problems) ? problems : [];
  const { primary, secondary } = contestTitle(contest);
  const platform = PLATFORM_NAMES[contest?.platform] || contest?.platform || '';
  const site = siteUrl || `${String(origin || '').replace(/\/+$/, '')}/contests/${encodeURIComponent(contest?.platform ?? '')}/${encodeURIComponent(String(contest?.id ?? ''))}`;
  const original = contest?.url || '';

  const metaBits = [platform, contest?.id ? `比赛 ${contest.id}` : ''].filter(Boolean).map(escapeHtml).join('<span class="dot">·</span>');
  const toc = list.map((p, i) => {
    const label = p?.label ?? p?.index ?? String(i + 1);
    return `<li><span class="toc-label">${plain(label)}</span>${plain(problemTitle(p, format === 'en' ? 'en' : 'zh'))}</li>`;
  }).join('\n');

  const sheets = list.map((p, i) => problemSheet({
    origin,
    problem: p,
    label: p?.label ?? p?.index ?? String(i + 1),
    mode: format,
  })).join('\n');

  const cover = `<section class="cover">
  <div class="cover-kicker">${escapeHtml(platform || 'AC 题库')} · 整场题目导出</div>
  <h1>${plain(primary)}</h1>
  ${secondary ? `<p class="subtitle">${plain(secondary)}</p>` : ''}
  <div class="meta">${metaBits}<span class="dot">·</span>${list.length} 题</div>
  <div class="cover-links">本站比赛：<a href="${escapeHtml(site)}">${escapeHtml(site)}</a>${original ? `<br>原站比赛：<a href="${escapeHtml(original)}">${escapeHtml(original)}</a>` : ''}</div>
  <ol class="toc">${toc}</ol>
</section>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${plain(primary)} · 题目</title>
<style>${EXPORT_CSS}
${CONTEST_CSS}</style>
</head>
<body>
<main class="doc md-body">
${cover}
${sheets}
<footer class="doc-footer">由 AC 题库（ac.yslsy.top）导出${exportedAt ? ` · ${escapeHtml(exportedAt)}` : ''} · 题目版权归原站所有</footer>
</main>
</body>
</html>`;
}