/**
 * ICPC 版式 PDF 的纯排版参数（无 DOM / 无 canvas，可直接单测）。
 *
 * 页面按 96dpi 的 A4 画布设计：794 × 1123 px。PDF 里再按 595.28 × 841.89pt
 * 输出，所以 canvas 上的 px 与最终 PDF 的 pt 只差一个固定比例。
 */

export const PDF_PAGE = Object.freeze({
  width: 794,
  height: 1123,
  marginX: 56,
  contentWidth: 682,
  contentBottom: 1056,
  footerRuleY: 1070,
  continuationTop: 66,
  scale: 2,
});

export const MAX_TITLE_LINES = 2;

/** 首题页的标题区高度（标题最多两行；有副标题时再占一行）。 */
export function problemHeaderMetrics({ titleLines = 1, hasSecondary = false } = {}) {
  const lines = Math.min(MAX_TITLE_LINES, Math.max(1, Number(titleLines) || 1));
  const titleY = 88;
  const titleLineHeight = 28;
  const titleBottom = titleY + (lines - 1) * titleLineHeight;
  const secondaryY = hasSecondary ? titleBottom + 16 : 0;
  const limitY = (hasSecondary ? secondaryY : titleBottom) + 22;
  const ruleY = limitY + 12;
  const contentTop = ruleY + 17;
  return {
    titleY,
    titleLineHeight,
    titleBottom,
    secondaryY,
    limitY,
    ruleY,
    contentTop,
    firstHeight: PDF_PAGE.contentBottom - contentTop,
    height: PDF_PAGE.contentBottom - PDF_PAGE.continuationTop,
  };
}

/**
 * 把一段连续内容切成逐页高度。findBreak(target, start, end) 返回目标附近的
 * 空白行（只允许 ≤ target，避免内容高过页面可视区）；没有合适断点时用 target。
 * 也可以返回 { y, force: true }：原子块要求提前断页时，即使 y 很靠前也必须保留。
 */
export function planSlices(contentHeight, { firstHeight, height, findBreak } = {}) {
  const total = Math.max(0, Math.ceil(Number(contentHeight) || 0));
  if (total <= 0) return [{ y: 0, h: 0 }];
  const first = Math.max(1, Math.round(Number(firstHeight) || 0));
  const rest = Math.max(1, Math.round(Number(height) || 0));
  const slices = [];
  let y = 0;

  while (y < total && slices.length < 500) {
    const capacity = slices.length === 0 ? first : rest;
    const target = Math.min(total, y + capacity);
    if (target >= total) {
      slices.push({ y, h: total - y });
      y = total;
      break;
    }

    const found = findBreak ? findBreak(target, y, total) : target;
    const forced = typeof found === 'object' && found !== null && found.force === true;
    let cut = Number(typeof found === 'object' && found !== null ? found.y : found);
    if (!Number.isFinite(cut)) cut = target;
    cut = Math.round(cut);

    // 断点太靠前会浪费半页；普通空白行吸附宁可切在目标位置。
    // 但原子内容（表格/代码块）给出的提前量是强制断点，必须保留，
    // 否则会把表格或样例框从中间切开。
    const minCut = y + Math.max(120, Math.floor(capacity * 0.25));
    if ((!forced && cut < minCut) || cut >= total) cut = target;
    cut = Math.min(cut, target);
    if (cut <= y) cut = target;

    slices.push({ y, h: cut - y });
    y = cut;
  }

  if (y < total) slices.push({ y, h: total - y });
  return slices;
}

export function problemTitles(problem, mode = 'zh') {
  const en = String(problem?.title ?? '').trim();
  const zh = String(problem?.titleZh ?? '').trim();
  const id = String(problem?.id ?? '');
  if (mode === 'en') {
    const primary = en || zh || id;
    const secondary = en && zh && en !== zh ? zh : '';
    return { primary, secondary };
  }
  const primary = zh || en || id;
  const secondary = zh && en && zh !== en ? en : '';
  return { primary, secondary };
}

export function formatSecondsFromMs(ms) {
  const seconds = Number(ms) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return Number.isInteger(seconds) ? String(seconds) : String(Math.round(seconds * 10) / 10);
}

export function formatTimeLimit(ms, mode = 'zh') {
  const seconds = formatSecondsFromMs(ms);
  if (!seconds) return '';
  if (mode === 'zh') return `时间限制：${seconds} 秒`;
  return `Time limit: ${seconds} ${seconds === '1' ? 'second' : 'seconds'}`;
}

export function formatMemoryLimit(mb, mode = 'zh') {
  const value = Number(mb);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (mode === 'zh') return `内存限制：${value} MB`;
  return `Memory limit: ${value} ${value === 1 ? 'megabyte' : 'megabytes'}`;
}

/** 题头下方的限制行。both 模式用 ICPC 英文写法。 */
export function limitLine(problem, mode = 'zh') {
  const lang = mode === 'zh' ? 'zh' : 'en';
  const parts = [formatTimeLimit(problem?.timeLimitMs, lang), formatMemoryLimit(problem?.memoryLimitMb, lang)].filter(Boolean);
  return parts.join('　·　');
}

export function pointsLabel(points, mode = 'zh') {
  const value = Number(points);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (mode === 'zh') return `${value} 分`;
  return `${value} points`;
}

/** 每题起始页（封面不计页码，所以从 1 开始）。 */
export function problemStartPages(pageCounts) {
  let next = 1;
  return (pageCounts ?? []).map((count) => {
    const start = next;
    next += Math.max(1, Number(count) || 1);
    return start;
  });
}

export function coverColumnCount(problemCount) {
  const count = Math.max(0, Number(problemCount) || 0);
  if (count > 32) return 3;
  if (count > 14) return 2;
  return 1;
}

export function pageLabel(pageNumber, totalPages) {
  return `Page ${pageNumber} of ${totalPages}`;
}

/** PDF 页脚文字（矢量，不进图片）。 */
export function pageFooterLines({ pageNumber, totalPages, site = 'ac.yslsy.top' }) {
  const lines = [];
  if (site) {
    lines.push({ text: site, x: 42, y: 18, size: 7.5, color: [0.55, 0.58, 0.62] });
  }
  if (pageNumber > 0 && totalPages > 0) {
    lines.push({
      text: pageLabel(pageNumber, totalPages),
      align: 'center',
      y: 18,
      size: 8.5,
      color: [0.25, 0.28, 0.32],
    });
  }
  return lines;
}

export function formatContestDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
}
