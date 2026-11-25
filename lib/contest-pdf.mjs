/**
 * ICPC 版式整场题目 PDF（浏览器专用，按需动态 import）。
 *
 * 流程：
 *   1. 每道题单独渲染成一张窄画布（A4 正文宽度），题头/页脚不参与分页；
 *   2. 按「首页可用高度 / 续页可用高度」切片，切片点优先吸附到空白行，
 *      因此不会把两题排进同一页，也尽量不把一行字切成两半；
 *   3. 每页重新合成 A4 画布：题头（首页大标题 / 续页运行页眉）+ 正文切片 + 页脚线；
 *   4. 页面编码成 JPEG，交给 lib/pdf-images.mjs 装进 PDF；页码是矢量文字，
 *      书签让每道题可以直接从阅读器侧栏跳转。
 *
 * 正文是图片（与站内 Markdown 导出 PDF 同一条技术路线），中文/公式不依赖
 * PDF 字体嵌入；HTML 出口仍然保留可复制文字。
 */

import { buildProblemBodyHtml, ICPC_SHEET_CSS, platformName } from './contest-export.mjs';
import { inlineImages } from './markdown-export.mjs';
import { buildImagePdf } from './pdf-images.mjs';
import {
  MAX_TITLE_LINES,
  PDF_PAGE,
  coverColumnCount,
  formatContestDate,
  limitLine,
  pageFooterLines,
  planSlices,
  pointsLabel,
  problemHeaderMetrics,
  problemStartPages,
  problemTitles,
} from './contest-pdf-layout.mjs';
import { contestExportFileBase, normalizeExportMode } from './contest-export-modes.mjs';

const SERIF = '"Times New Roman", Georgia, "Songti SC", "Noto Serif CJK SC", "SimSun", serif';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const PAGE_SCALE = PDF_PAGE.scale;
const JPEG_QUALITY = 0.92;
// 样例块本身（.sample-block）可能包含很长的说明，不能整体锁死；真正要
// 保护的是其中的输入/输出框（pre）和表格/图片。
const ATOMIC_SELECTOR = 'table, pre, img, figure';
const KEEP_HEADING_SELECTOR = 'h2, h3, h4';
const KEEP_HEADING_TAGS = new Set(['H2', 'H3', 'H4']);
const LEAD_IN_TEXT = /(?:如下|following|as follows|shown below)[^\n]{0,32}[：:]?\s*$/i;
const FORMAT_BLOCK_MAX_HEIGHT = 420;
// DOM 测量与 SVG foreignObject 实际栅格化之间可能有一行左右的行宽差，
// 断点提前一点，避免正好落在标题/表格的第一行上。
const BLOCK_KEEP_SLACK = 16;
// 标题只负责“别当页底孤儿”，跟随两行左右就够；预留太多会让整段内容
// 被推到下一页，连续标题还会互相重叠、把断点连锁推到更早的位置。
const HEADING_KEEP_NEXT = 56;
// 画布背景带已经对齐到真实像素，精确区间不需要再预留整行；留 2px 只防
// 半像素抗锯齿。预留太多会跨过相邻样例框，反而把断点推进上一个框里。
const EXACT_KEEP_GAP = 2;

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function wrapText(ctx, text, maxWidth, maxLines = MAX_TITLE_LINES) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return [''];
  const chars = Array.from(value);
  const lines = [];
  let index = 0;

  while (index < chars.length && lines.length < maxLines) {
    let line = '';
    let lastSpace = -1;
    while (index < chars.length) {
      const ch = chars[index];
      if (line && ctx.measureText(line + ch).width > maxWidth) break;
      line += ch;
      if (ch === ' ') lastSpace = line.length - 1;
      index += 1;
    }
    if (index < chars.length && lastSpace > 0 && lines.length + 1 < maxLines) {
      const carry = line.slice(lastSpace + 1);
      line = line.slice(0, lastSpace);
      index -= carry.length;
    }
    lines.push(line.trim());
  }

  if (index < chars.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines.length ? lines : [''];
}

function fitText(ctx, text, maxWidth) {
  let value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!value || ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value.trimEnd()}…`;
}

/**
 * 读取一次画布像素，同时得到：
 *   - yScale：最后一个非白像素行 / DOM 高度（修正累计行高差）；
 *   - bands：#f7f8fa 背景块（pre / 样例框）在画布上的真实上下界。
 */
function analyzeRenderedCanvas(ctx, canvas) {
  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return { yScale: 1, bands: [] };
  }
  const rowBytes = canvas.width * 4;
  const step = 4;
  const samples = Math.ceil(canvas.width / step);
  const minBackground = Math.max(6, Math.floor(samples * 0.5));
  const bands = [];
  let bandStart = -1;
  let lastContent = 0;

  for (let y = 0; y < canvas.height; y += 1) {
    const offset = y * rowBytes;
    let background = 0;
    let content = false;
    for (let x = 0; x < canvas.width; x += step) {
      const i = offset + x * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      if (r < 250 || g < 250 || b < 250) content = true;
      if (r >= 245 && r <= 250 && g >= 246 && g <= 251 && b >= 248 && b <= 253) background += 1;
    }
    if (content) lastContent = y + 1;
    if (background >= minBackground) {
      if (bandStart < 0) bandStart = y;
    } else if (bandStart >= 0) {
      if (y - bandStart >= 8) bands.push({ top: bandStart, bottom: y - 1 });
      bandStart = -1;
    }
  }
  if (bandStart >= 0 && canvas.height - bandStart >= 8) {
    bands.push({ top: bandStart, bottom: canvas.height - 1 });
  }

  return {
    yScale: lastContent ? Math.min(1, Math.max(0.5, lastContent / canvas.height)) : 1,
    bands,
  };
}

/**
 * 把 DOM 里的 pre 与画布上检测到的背景块按顺序配对，得到不受行高差影响的
 * 真实范围；前置标题/引导句通过相对偏移一起带入。
 */
function alignPreRanges(atomic, root, scale, yScale, bands) {
  if (!bands.length) return atomic;
  const rootTop = root.getBoundingClientRect().top;
  const pres = [...root.querySelectorAll('pre')].filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.height > 2;
  });
  if (!pres.length) return atomic;

  const used = new Set();
  const exact = new Map();
  const takeBand = (index) => {
    if (bands.length === pres.length && !used.has(index)) {
      used.add(index);
      return bands[index];
    }
    let best = -1;
    let bestDistance = Infinity;
    const rect = pres[index].getBoundingClientRect();
    const expected = ((rect.top + rect.bottom) / 2 - rootTop) * scale * yScale;
    bands.forEach((band, bandIndex) => {
      if (used.has(bandIndex)) return;
      const distance = Math.abs((band.top + band.bottom) / 2 - expected);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = bandIndex;
      }
    });
    if (best < 0 || bestDistance > 320 * scale) return null;
    used.add(best);
    return bands[best];
  };

  pres.forEach((element, index) => {
    const band = takeBand(index);
    if (!band) return;
    const range = atomic.find((item) => item.element === element);
    if (!range) return;
    const rect = element.getBoundingClientRect();
    const preTop = rect.top - rootTop;
    const offset = Math.max(0, preTop - range.top) * scale * yScale;
    exact.set(element, {
      top: (band.top - offset - EXACT_KEEP_GAP * scale) / scale,
      bottom: (band.bottom + Math.round(3 * scale)) / scale,
      exact: true,
      kind: 'atomic',
    });
  });

  if (!exact.size) return atomic;
  return atomic.map((range) => exact.get(range.element) || range);
}

function drawRule(ctx, y, color = '#d1d5db', width = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(PDF_PAGE.marginX, y);
  ctx.lineTo(PDF_PAGE.width - PDF_PAGE.marginX, y);
  ctx.stroke();
  ctx.restore();
}

function contestPrimaryTitle(contest, mode) {
  const en = String(contest?.title ?? '').trim();
  const zh = String(contest?.titleZh ?? '').trim();
  if (mode === 'en') return en || zh || 'Untitled Contest';
  return zh || en || '未命名比赛';
}

function contestSecondaryTitle(contest, mode) {
  const en = String(contest?.title ?? '').trim();
  const zh = String(contest?.titleZh ?? '').trim();
  if (!en || !zh || en === zh) return '';
  return mode === 'en' ? zh : en;
}

function contestShortName(contest, mode) {
  const primary = contestPrimaryTitle(contest, mode);
  return primary.length > 34 ? `${primary.slice(0, 33)}…` : primary;
}

function problemLabel(problem, index) {
  return String(problem?.label ?? problem?.index ?? index + 1);
}

function problemOriginalId(problem) {
  const platform = platformName(problem?.platform);
  const id = String(problem?.id ?? '').trim();
  return [platform, id].filter(Boolean).join(' · ');
}

function drawText(ctx, text, x, y, { size = 12, weight = 400, color = '#111827', family = SERIF, align = 'left' } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawFittedText(ctx, text, x, y, maxWidth, options = {}) {
  const { size = 12, weight = 400, color = '#111827', family = SERIF, align = 'left' } = options;
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(fitText(ctx, text, maxWidth), x, y);
  ctx.restore();
}

/** HTML → canvas（foreignObject），返回画布与实际像素比例。 */
async function renderHtmlToCanvas(html, { width = PDF_PAGE.contentWidth, scale: requestedScale = PAGE_SCALE } = {}) {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-200000px;top:0;width:${width}px;background:#fff;pointer-events:none;z-index:-1;`;
  host.innerHTML = `<div class="icpc-sheet" style="width:${width}px"><style>${ICPC_SHEET_CSS}</style>${html}</div>`;
  document.body.appendChild(host);
  try {
    const root = host.firstElementChild;
    await inlineImages(root, { proxy: true });
    if (document.fonts?.ready) {
      await Promise.race([document.fonts.ready, delay(2500)]);
    }
    await nextFrame();
    const rootRect = root.getBoundingClientRect();
    const height = Math.max(1, Math.ceil(rootRect.height));
    const atomic = collectKeepRanges(root, rootRect);
    root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const xhtml = new XMLSerializer().serializeToString(root);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;

    // data URL（而不是 blob:）在 Chrome 里不会把 foreignObject 画布标记为污染；
    // 现网 Markdown 导出 PDF 用的是同一条路径。
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const image = new Image();
    image.decoding = 'sync';
    await Promise.race([new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('题面渲染失败（内容过大或图片无法载入）'));
      image.src = url;
    }), delay(20000).then(() => { throw new Error('题面渲染超时'); })]);
    const areaCap = 24_000_000;
    const dimCap = 30_000;
    const realScale = Math.max(
      0.75,
      Math.min(requestedScale, dimCap / height, Math.sqrt(areaCap / Math.max(1, width * height))),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * realScale));
    canvas.height = Math.max(1, Math.round(height * realScale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const renderScale = canvas.width / width;
    const analysis = analyzeRenderedCanvas(ctx, canvas);
    return {
      canvas,
      scale: renderScale,
      yScale: analysis.yScale,
      height,
      atomic: alignPreRanges(atomic, root, renderScale, analysis.yScale, analysis.bands),
    };
  } finally {
    host.remove();
  }
}

/**
 * 收集「不能被分页切开」的纵向区间。
 *
 * 表格、代码块、图片、样例块本身是原子的；此外把紧邻的引导句（“状态如下：”）
 * 和前置标题一起并进区间，避免标题/引导句孤零零留在页底、内容整体跑到下一页。
 * 对于后面接普通段落/列表的标题，也至少保留一小段跟随内容。
 */
function collectKeepRanges(root, rootRect) {
  const rangeOf = (element) => {
    const rect = element.getBoundingClientRect();
    const top = rect.top - rootRect.top;
    const bottom = rect.bottom - rootRect.top;
    return bottom - top > 2 ? { top, bottom } : null;
  };
  const ranges = [];

  const extendTop = (element, top) => {
    let nextTop = top;
    let prev = element.previousElementSibling;
    if (prev?.tagName === 'P') {
      const text = (prev.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length <= 240 && LEAD_IN_TEXT.test(text)) {
        const leadIn = rangeOf(prev);
        if (leadIn) {
          nextTop = Math.min(nextTop, leadIn.top);
          prev = prev.previousElementSibling;
        }
      }
    }
    while (prev && KEEP_HEADING_TAGS.has(prev.tagName)) {
      const heading = rangeOf(prev);
      if (heading) nextTop = Math.min(nextTop, heading.top);
      prev = prev.previousElementSibling;
    }
    return nextTop;
  };

  for (const element of root.querySelectorAll(ATOMIC_SELECTOR)) {
    const own = rangeOf(element);
    if (!own) continue;
    const top = extendTop(element, own.top);
    ranges.push({ top, bottom: own.bottom, element, kind: 'atomic' });
  }

  // AtCoder 的输入格式常用「一个段落 + 多个 <br>」而不是代码块；这种块一旦
  // 被页尾切开，最后一行（常见是 x_Q）会单独留在下一页。高度可控时整块跟随。
  for (const paragraph of root.querySelectorAll('p')) {
    if (paragraph.querySelectorAll('br').length < 2) continue;
    const own = rangeOf(paragraph);
    if (!own || own.bottom - own.top > FORMAT_BLOCK_MAX_HEIGHT) continue;
    let bottom = own.bottom;
    let next = paragraph.nextElementSibling;
    // 抓取时最后一行偶尔会被空行单独拆成一个短段落（例如 x_Q）；
    // 它没有 <br>，但视觉上仍属于同一个输入格式块。
    while (next?.tagName === 'P') {
      const text = (next.textContent || '').replace(/\s+/g, ' ').trim();
      const nextRange = rangeOf(next);
      if (!nextRange || next.querySelectorAll('br').length > 0 || text.length > 80) break;
      if (/[。！？；：.!?;:]$/.test(text)) break;
      bottom = nextRange.bottom;
      next = next.nextElementSibling;
    }
    ranges.push({
      top: extendTop(paragraph, own.top),
      bottom,
      element: paragraph,
      kind: 'atomic',
    });
  }

  for (const heading of root.querySelectorAll(KEEP_HEADING_SELECTOR)) {
    const own = rangeOf(heading);
    if (!own) continue;
    const next = heading.nextElementSibling;
    // 后面直接跟代码块/表格/图片时，上一轮已经把这个标题并进了原子区间；
    // 再单独加一条标题区间会与精确像素区间重叠，反而把断点推得过早。
    if (next?.matches(ATOMIC_SELECTOR)) continue;
    const nextRange = next ? rangeOf(next) : null;
    if (!nextRange) continue;
    ranges.push({
      top: own.top,
      bottom: Math.min(own.bottom + HEADING_KEEP_NEXT, nextRange.bottom + 4),
      kind: 'heading',
    });
  }

  return ranges;
}

/** 在目标位置附近寻找整行空白；只向前找，保证切片不会高于页面可用高度。 */
function makeBreakFinder(canvas, scale, atomic = [], yScale = 1) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const windowPx = Math.max(16, Math.round(48 * scale));
  const ranges = atomic
    .map((range) => ({
      top: range.top * scale * (range.exact ? 1 : yScale),
      bottom: range.bottom * scale * (range.exact ? 1 : yScale),
      exact: Boolean(range.exact),
      kind: range.kind || 'atomic',
    }))
    .filter((range) => range.bottom > range.top);

  return (target, start, end) => {
    // 表格 / 代码块 / 样例框是原子内容：目标落在里面时，把断点提到块前。
    // 相邻样例框的保护区间可能首尾重叠（前一个框的底部与后一个标题的顶部），
    // 因此必须循环回退，直到断点不再落在任何原子区间里；只退一次会把断点
    // 推进上一个样例框内部。块本身高于整页时只能退回硬切。
    let adjusted = target;
    let forced = false;
    for (let guard = 0; guard <= ranges.length + 2; guard += 1) {
      let hit = null;
      for (const range of ranges) {
        if (range.top < adjusted && adjusted < range.bottom) {
          if (!hit || range.top < hit.top) hit = range;
        }
      }
      if (!hit) break;
      const gap = Math.round(
        (hit.exact ? EXACT_KEEP_GAP : hit.kind === 'heading' ? 8 : BLOCK_KEEP_SLACK) * scale,
      );
      const before = Math.floor(hit.top) - Math.max(2, gap);
      forced = true;
      if (before <= start) {
        adjusted = start;
        break;
      }
      if (before >= adjusted) break;
      adjusted = before;
    }

    const from = Math.max(start + 1, adjusted - windowPx);
    const to = Math.min(end - 1, adjusted);
    if (to <= from) return { y: adjusted, force: forced };
    let band;
    try {
      band = ctx.getImageData(0, from, canvas.width, to - from + 1).data;
    } catch {
      return { y: adjusted, force: forced };
    }
    const rowBytes = canvas.width * 4;
    for (let y = to; y >= from; y -= 1) {
      // 即使断点目标已经在块之后，也不能倒退着切进表格/代码块里。
      if (ranges.some((range) => y > range.top && y < range.bottom)) continue;
      const offset = (y - from) * rowBytes;
      let blank = true;
      for (let x = 0; x < rowBytes; x += 4) {
        if (band[offset + x] < 250 || band[offset + x + 1] < 250 || band[offset + x + 2] < 250) {
          blank = false;
          break;
        }
      }
      if (blank) return { y, force: forced };
    }
    return { y: adjusted, force: forced };
  };
}

function createPageCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = PDF_PAGE.width * PAGE_SCALE;
  canvas.height = PDF_PAGE.height * PAGE_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(PAGE_SCALE, PAGE_SCALE);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PDF_PAGE.width, PDF_PAGE.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function drawHeaderMeta(ctx, contest, problem, mode) {
  drawFittedText(ctx, contestShortName(contest, mode), PDF_PAGE.marginX, 32, 430, {
    size: 9.5,
    color: '#6b7280',
    family: SANS,
  });
  const right = problemOriginalId(problem);
  if (right) {
    drawFittedText(ctx, right, PDF_PAGE.width - PDF_PAGE.marginX, 32, 210, {
      size: 9.5,
      color: '#6b7280',
      family: SANS,
      align: 'right',
    });
  }
}

function drawFirstPageHeader(ctx, { contest, problem, label, mode, metrics, titleLines, titles }) {
  drawHeaderMeta(ctx, contest, problem, mode);
  drawRule(ctx, 42, '#111827', 1.2);

  drawText(ctx, `PROBLEM ${label}`, PDF_PAGE.marginX, 64, {
    size: 10,
    weight: 700,
    color: '#4b5563',
    family: SANS,
  });

  ctx.save();
  ctx.font = `700 26px ${SERIF}`;
  ctx.fillStyle = '#111827';
  titleLines.forEach((line, i) => {
    ctx.fillText(line, PDF_PAGE.marginX, metrics.titleY + i * metrics.titleLineHeight);
  });
  ctx.restore();

  if (titles.secondary) {
    drawFittedText(ctx, titles.secondary, PDF_PAGE.marginX, metrics.secondaryY, PDF_PAGE.contentWidth, {
      size: 12,
      color: '#6b7280',
      family: SERIF,
    });
  }

  const limits = limitLine(problem, mode);
  if (limits) {
    drawFittedText(ctx, limits, PDF_PAGE.marginX, metrics.limitY, 470, {
      size: 11.5,
      color: '#374151',
      family: SERIF,
    });
  }
  const points = pointsLabel(problem?.points, mode);
  if (points) {
    drawText(ctx, points, PDF_PAGE.width - PDF_PAGE.marginX, metrics.limitY, {
      size: 11,
      color: '#374151',
      family: SANS,
      align: 'right',
    });
  }
  drawRule(ctx, metrics.ruleY, '#111827', 1.2);
}

function drawContinuationHeader(ctx, { contest, problem, label, mode, titles }) {
  drawFittedText(ctx, contestShortName(contest, mode), PDF_PAGE.marginX, 34, 300, {
    size: 9,
    color: '#6b7280',
    family: SANS,
  });
  drawFittedText(
    ctx,
    `Problem ${label} · ${titles.primary}`,
    PDF_PAGE.width - PDF_PAGE.marginX,
    34,
    360,
    { size: 9, color: '#6b7280', family: SANS, align: 'right' },
  );
  drawRule(ctx, 48, '#d1d5db', 1);
}

async function canvasToJpeg(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('生成 PDF 页面图片失败'))), 'image/jpeg', JPEG_QUALITY);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function composeProblemPage({ content, slice, contest, problem, label, mode, metrics, titles, titleLines, isFirst }) {
  const { canvas, ctx } = createPageCanvas();
  if (isFirst) {
    drawFirstPageHeader(ctx, { contest, problem, label, mode, metrics, titleLines, titles });
  } else {
    drawContinuationHeader(ctx, { contest, problem, label, mode, titles });
  }

  if (slice.h > 0) {
    const top = isFirst ? metrics.contentTop : PDF_PAGE.continuationTop;
    const drawHeight = slice.h / content.scale;
    ctx.drawImage(
      content.canvas,
      0,
      slice.y,
      content.canvas.width,
      slice.h,
      PDF_PAGE.marginX,
      top,
      PDF_PAGE.contentWidth,
      drawHeight,
    );
  }

  drawRule(ctx, PDF_PAGE.footerRuleY, '#d1d5db', 1);
  const data = await canvasToJpeg(canvas);
  return { data, width: canvas.width, height: canvas.height };
}

function drawCoverPage({ contest, problems, pageStarts, mode, exportedAt }) {
  const { canvas, ctx } = createPageCanvas();
  const margin = 64;
  const title = contestPrimaryTitle(contest, mode);
  const subtitle = contestSecondaryTitle(contest, mode);
  const width = PDF_PAGE.width - margin * 2;

  drawText(ctx, 'ICPC-STYLE PROBLEM SET', margin, 86, {
    size: 9.5,
    weight: 700,
    color: '#6b7280',
    family: SANS,
  });

  ctx.save();
  ctx.font = `700 32px ${SERIF}`;
  ctx.fillStyle = '#111827';
  const titleLines = wrapText(ctx, title, width, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, margin, 132 + i * 38));
  ctx.restore();

  let y = 132 + (titleLines.length - 1) * 38 + 28;
  if (subtitle) {
    drawFittedText(ctx, subtitle, margin, y, width, { size: 14, color: '#4b5563', family: SERIF });
    y += 24;
  }

  const meta = [];
  const platform = platformName(contest?.platform);
  if (platform) meta.push(platform);
  if (contest?.id) meta.push(`比赛 ${contest.id}`);
  const date = formatContestDate(contest?.startTime);
  if (date) meta.push(date);
  const seconds = Number(contest?.durationSeconds) || (Number(contest?.minutes) || 0) * 60;
  if (seconds > 0) meta.push(`${Math.round(seconds / 60)} 分钟`);
  meta.push(`${problems.length} 题`);
  drawFittedText(ctx, meta.join('   ·   '), margin, y, width, {
    size: 11.5,
    color: '#4b5563',
    family: SANS,
  });

  y += 22;
  ctx.save();
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(margin, y);
  ctx.lineTo(PDF_PAGE.width - margin, y);
  ctx.stroke();
  ctx.restore();

  y += 28;
  drawText(ctx, 'PROBLEMS', margin, y, { size: 10, weight: 700, color: '#374151', family: SANS });
  y += 14;

  const columns = coverColumnCount(problems.length);
  const gap = 26;
  const colWidth = (width - gap * (columns - 1)) / columns;
  const rows = Math.max(1, Math.ceil(problems.length / columns));
  const available = PDF_PAGE.footerRuleY - 54 - y;
  const rowHeight = Math.max(15, Math.min(27, Math.floor(available / rows)));
  const fontSize = rowHeight < 19 ? 10.5 : 12;

  problems.forEach((problem, index) => {
    const col = Math.floor(index / rows);
    const row = index % rows;
    const x = margin + col * (colWidth + gap);
    const baseline = y + row * rowHeight + fontSize;
    const label = problemLabel(problem, index);
    const titles = problemTitles(problem, mode);
    const page = pageStarts[index];

    drawText(ctx, label, x, baseline, {
      size: fontSize - 0.5,
      weight: 700,
      color: '#111827',
      family: SANS,
    });
    const titleX = x + 34;
    const pageText = String(page ?? '');
    ctx.save();
    ctx.font = `400 ${fontSize - 1}px ${SANS}`;
    const pageWidth = ctx.measureText(pageText).width + 4;
    const titleMax = Math.max(40, colWidth - 34 - pageWidth - 14);
    ctx.font = `400 ${fontSize}px ${SERIF}`;
    const line = fitText(ctx, titles.primary, titleMax);
    ctx.fillStyle = '#111827';
    ctx.fillText(line, titleX, baseline);
    const lineEnd = titleX + ctx.measureText(line).width + 6;
    ctx.restore();

    drawText(ctx, pageText, x + colWidth, baseline, {
      size: fontSize - 1,
      color: '#6b7280',
      family: SANS,
      align: 'right',
    });

    const pageStart = x + colWidth - pageWidth - 4;
    if (lineEnd < pageStart) {
      ctx.save();
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 0.7;
      ctx.setLineDash([1, 3]);
      ctx.beginPath();
      ctx.moveTo(lineEnd, baseline - 3);
      ctx.lineTo(pageStart - 2, baseline - 3);
      ctx.stroke();
      ctx.restore();
    }
  });

  drawRule(ctx, PDF_PAGE.footerRuleY, '#d1d5db', 1);
  drawText(ctx, 'Generated by AC 题库 · ac.yslsy.top', margin, PDF_PAGE.footerRuleY + 24, {
    size: 9,
    color: '#9ca3af',
    family: SANS,
  });
  if (exportedAt) {
    drawText(ctx, exportedAt, PDF_PAGE.width - margin, PDF_PAGE.footerRuleY + 24, {
      size: 9,
      color: '#9ca3af',
      family: SANS,
      align: 'right',
    });
  }
  return canvas;
}

/**
 * 生成 ICPC 版式 PDF。
 *
 * @param {object} opts
 * @param {object} opts.contest
 * @param {Array} opts.problems
 * @param {'zh'|'en'|'both'} opts.mode
 * @param {string} opts.origin
 * @param {string} [opts.exportedAt]
 * @param {(progress: object) => void} [opts.onProgress]
 * @returns {Promise<{blob: Blob, bytes: Uint8Array, pageCount: number, problemPages: number, filename: string}>}
 */
export async function buildContestPdf({ contest, problems, mode, origin, exportedAt, onProgress }) {
  if (typeof document === 'undefined') throw new Error('PDF 导出只能在浏览器中进行');
  const format = normalizeExportMode(mode);
  const list = (Array.isArray(problems) ? problems : []).filter((problem) => problem);
  if (!list.length) throw new Error('本场暂无题目可导出');

  const measure = document.createElement('canvas').getContext('2d');
  const rendered = [];
  let totalProblemPages = 0;

  for (let i = 0; i < list.length; i += 1) {
    const problem = list[i];
    const label = problemLabel(problem, i);
    const titles = problemTitles(problem, format);
    onProgress?.({ stage: 'render', done: i, total: list.length, label, title: titles.primary });
    await delay();

    measure.font = `700 26px ${SERIF}`;
    const titleLines = wrapText(measure, titles.primary, PDF_PAGE.contentWidth, MAX_TITLE_LINES);
    const metrics = problemHeaderMetrics({
      titleLines: titleLines.length,
      hasSecondary: Boolean(titles.secondary),
    });

    const html = buildProblemBodyHtml({ problem, mode: format, origin, includeLinks: false });
    const content = await renderHtmlToCanvas(html);
    const findBreak = makeBreakFinder(content.canvas, content.scale, content.atomic, content.yScale);
    // 切片坐标必须统一用画布设备像素（content.scale），否则会在半页处断页。
    const slices = planSlices(content.canvas.height, {
      firstHeight: metrics.firstHeight * content.scale,
      height: metrics.height * content.scale,
      findBreak,
    });
    const pages = [];
    for (let pageIndex = 0; pageIndex < slices.length; pageIndex += 1) {
      onProgress?.({
        stage: 'page',
        done: i,
        total: list.length,
        page: pageIndex + 1,
        pages: slices.length,
        label,
        title: titles.primary,
      });
      pages.push(await composeProblemPage({
        content,
        slice: slices[pageIndex],
        contest,
        problem,
        label,
        mode: format,
        metrics,
        titles,
        titleLines,
        isFirst: pageIndex === 0,
      }));
      await delay();
    }

    content.canvas.width = 0;
    content.canvas.height = 0;
    const startPage = totalProblemPages + 1;
    totalProblemPages += pages.length;
    rendered.push({
      problem,
      label,
      titles,
      pageCount: pages.length,
      startPage,
      pages,
    });
  }

  onProgress?.({ stage: 'cover' });
  await delay();
  const pageStarts = problemStartPages(rendered.map((item) => item.pageCount));
  const cover = drawCoverPage({
    contest,
    problems: rendered.map((item) => item.problem),
    pageStarts,
    mode: format,
    exportedAt: exportedAt || new Date().toLocaleDateString('zh-CN'),
  });
  const coverPage = {
    data: await canvasToJpeg(cover),
    width: cover.width,
    height: cover.height,
  };

  const pages = [coverPage, ...rendered.flatMap((item) => item.pages)];
  const bookmarks = [];
  let pageIndex = 1;
  for (const item of rendered) {
    bookmarks.push({
      title: `Problem ${item.label}. ${item.titles.primary}`,
      pageIndex,
    });
    pageIndex += item.pageCount;
  }

  onProgress?.({ stage: 'write' });
  const bytes = buildImagePdf(pages, {
    pageWidth: 595.28,
    pageHeight: 841.89,
    title: `${contestPrimaryTitle(contest, format)} — Problems`,
    producer: 'AC Library',
    bookmarks,
    footer: (index, count) => {
      if (index === 0) return [];
      return pageFooterLines({ pageNumber: index, totalPages: count - 1 });
    },
  });

  return {
    blob: new Blob([bytes], { type: 'application/pdf' }),
    bytes,
    pageCount: pages.length,
    problemPages: totalProblemPages,
    filename: `${contestExportFileBase(contest, format)}.pdf`,
  };
}

export default { buildContestPdf };
