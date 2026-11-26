/**
 * 「题册 HTML」→ 私有化平台载荷（纯模块，可直接单测）。
 *
 * 输入是那种自包含的整场题册页面（每道题一个 <article class="problem">，
 * 内含 .pane-zh / .pane-en 两份题面 + .sample 样例块 + 内联 data: 图片）。
 * 这类页面常见于比赛官方放出的题册、以及把 PDF 题册转成网页后的存档。
 *
 * 输出是 lib/private-vault.mjs 的载荷结构（加密前的明文）：
 *   { format, version, id, label, title, titleZh, source, startTime,
 *     problems: [{ id, index, title, titleZh, statementMd, statementZhMd,
 *                  samples, timeLimitMs, memoryLimitMb, tags, url }] }
 *
 * 转换口径（与站内题面渲染链对齐）：
 *  - 数学：`<i>x</i>` → `$x$`，内部 `<sub>`/`<sup>` → `_{}`/`^{}`；
 *    裸 `<sup>`/`<sub>`（10<sup>18</sup>）并入前一个数学片段或数字串；
 *  - 样例：`.sample` 抽成 samples[]，不再留在题面里（与抓取管线一致）；
 *  - 图片：`data-fig` 由页面脚本注入，故必须从页面里的 FIG 表取；
 *    统一压到 ≤1100px 宽的 webp 再内联（体积可控，且 sanitizeRichHtml 只
 *    放行 png/gif/jpeg/webp/avif 的 base64 data URI）；
 *  - 表格：`.table-wrap` → GFM 表格。
 */

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

/* ------------------------- parse5 树访问小工具 -------------------------
   parse5 的节点形状：{ nodeName, tagName, attrs: [{name,value}], childNodes,
   value }（文本节点用 nodeName === '#text' + value）。不要照 cheerio/hast
   的 { name, attribs, children, data } 写 —— 那样每个字段都是 undefined，
   题面会被静默转成空串（真实踩过一次）。 */

const isText = (node) => node?.nodeName === '#text';
const tagOf = (node) => String(node?.tagName ?? '').toLowerCase();
const kids = (node) => node?.childNodes ?? [];
const attrOf = (node, name) => {
  const hit = (node?.attrs ?? []).find((a) => a.name === name);
  return hit ? hit.value : undefined;
};
const classOf = (node) => String(attrOf(node, 'class') ?? '').split(/\s+/).filter(Boolean);
const isClass = (node, name) => classOf(node).includes(name);
const textOf = (node) => (isText(node) ? String(node.value ?? '') : '');

/** 深度优先收集满足条件的后代（含自身）。 */
export function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const child of kids(node)) findAll(child, pred, out);
  return out;
}

/**
 * 文本节点 → markdown 安全文本。
 *
 *  - `<` `>` `&`：parse5 已把 `&lt;` 解码成 `<`，这里重新实体化，否则
 *    `i < j` 会被 marked 当成原始 HTML 起点、再被 sanitizeRichHtml 拆掉；
 *  - `[` `]` 用数字实体而不是反斜杠：renderRich 的定界符归一化会把
 *    `\[…\]` 当成历史遗留的块级公式（lib/render.js normalizeMathDelimiters），
 *    于是 `$a$\[$x$\]` 这种数组下标写法会被整段吞成公式，下标文字直接消失
 *    （2026-11-27 实测算出「1 ≤|| ≤ 2 ×」）。
 *  - `*` `_` `` ` `` `|`：反斜杠转义即可（`|` 只在表格里要紧，统一转义更稳）。
 */
export function escapeText(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/([*_`|])/g, '\\$1');
}

/** 行内元素 → 数学正文（sub/sup 用 LaTeX 记法，实体解码）。 */
export function mathOf(node) {
  let out = '';
  for (const child of kids(node)) {
    if (isText(child)) {
      out += String(child.value ?? '').replace(/\u00a0/g, ' ');
      continue;
    }
    const tag = tagOf(child);
    if (tag === 'sub') out += `_{${mathOf(child).trim()}}`;
    else if (tag === 'sup') out += `^{${mathOf(child).trim()}}`;
    else if (tag === 'br') out += ' ';
    else out += mathOf(child);
  }
  return out;
}

/** 数学片段里不能出现的 markdown 记号（`$` 与换行）。 */
function cleanMath(tex) {
  return String(tex)
    .replace(/\$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 可并入公式的间隔字符（数字、下标括号、关系符、逗号句点…）。 */
const GAP_CHARS = /^[\d\s,.;:+\-=<>≤≥×·\[\]()/|′…]+/;

/** 间隔里可能带着实体化的方括号（escapeText 为避开 markdown 链接语法写的）。 */
function decodeGap(gap) {
  return String(gap).replace(/&#91;/g, '[').replace(/&#93;/g, ']');
}

/**
 * 允许并进同一个公式的「连接片段」白名单。
 *
 * 只放这几类确定属于数学内部的形态，避免把 `$n$ = 3 $m$` 这种正文误并成
 * `$n = 3m$`（语义都变了）：
 *   `[` / `[1`     数组下标开口
 *   `]` `),` `,`   闭合与分隔（不含空格）
 *   `3]` `12)`    下标闭合
 *   `] =` `] = `   下标赋值（题册写作 `a[x] = y`）
 *   `, `           参数列表
 *   `..` `...`     范围
 */
const ALLOWED_GAPS = [
  /^\[\d{0,3}$/,
  /^\d{1,3}[\]\)][,.;:]?$/,
  /^[\]\)][,.;:]?$/,
  /^,\s?$/,
  /^\.{2,3}$/,
  /^[\]\)]\s?=\s?$/,
  /^\s?[=<>]\s?$/,
];
const isAllowedGap = (gap) => ALLOWED_GAPS.some((re) => re.test(gap));

/**
 * 把「公式 + 短连接文本 + 公式」的连续片段并成一个公式（作用于拼接后的文本）。
 *
 * 题册常把一段数学写成 `<i>s</i>[1<i>..</i>3]`：转成 markdown 是
 * `$s$[1$..$3]`，中间夹着方括号与数字。这类片段不合并会渲染成
 * 「s[1..3]」断成两半、甚至被当成块级定界符残标清掉。
 */
export function mergeMathClusters(text) {
  // 方括号在 escapeText 里被实体化（躲 markdown 链接语法），这里先还原成字符，
  // 否则 `&#91;1` 匹配不上 GAP_CHARS，`$s$[1$..$3]` 就永远并不到一起。
  const src = decodeGap(String(text ?? ''));
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '$') {
      const end = src.indexOf('$', i + 1);
      if (end > i + 1) {
        tokens.push({ math: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    let j = i;
    while (j < src.length && src[j] !== '$') j += 1;
    tokens.push({ text: src.slice(i, j) });
    i = j;
  }
  const bracketOpen = (body) =>
    (body.match(/\[/g) ?? []).length > (body.match(/\]/g) ?? []).length;
  const out = [];
  for (let k = 0; k < tokens.length; k += 1) {
    const tok = tokens[k];
    if (!('math' in tok)) {
      out.push(tok);
      continue;
    }
    if (/^[,.;:]+$/.test(tok.math)) {
      // 纯标点的「公式」（`<i>,</i>`）就是正文标点，别做成 KaTeX 片段
      out.push({ text: tok.math });
      continue;
    }
    let body = tok.math;
    let cursor = k + 1;
    for (;;) {
      const next = tokens[cursor];
      if (!next) break;
      if ('math' in next) {
        // 紧邻公式：直接接上，避免拼出 `$$`（renderRich 会当残标清掉）
        body += next.math;
        cursor += 1;
        continue;
      }
      // ① 未闭合的 `[` 先找闭合：`3]` / `)`（可带 ` = ` 与尾随逗号句点）
      if (bracketOpen(body)) {
        const close = /^[\d\]\)]{1,4}[,.;:]?/.exec(next.text);
        if (close) {
          body += close[0];
          if (close[0].length < next.text.length) tokens[cursor] = { text: next.text.slice(close[0].length) };
          else cursor += 1;
          continue;
        }
      }
      // ② 连接片段 + 后面还有公式：只并白名单形态，否则 `$n$ = 3 $m$` 会被误并
      const after = tokens[cursor + 1];
      if (after && 'math' in after) {
        const m = GAP_CHARS.exec(next.text);
        const gap = m ? m[0].replace(/\s+$/, '') : '';
        if (!gap || !isAllowedGap(gap)) break;
        // 连接片段必须**独占**这个文本节点：`a[x] = $y$` 里是 ` =`，
        // 而 `s[1..3] = aba、$s$…` 里是 ` = aba、`（后面还有正文），
        // 后者不能并，否则相邻两个下标会粘成一个公式。
        if (next.text.trim() !== gap.trim()) break;
        if (/^[\]\),]/.test(gap) && !bracketOpen(body)) break;
        body += gap + after.math;
        cursor += 2;
        continue;
      }
      break;
    }
    out.push({ math: body });
    k = cursor - 1;
  }
  return out.map((t) => ('math' in t ? `$${t.math}$` : t.text)).join('');
}

/**
 * 行内序列 → markdown 片段数组。
 * 单独处理 sup/sub：并入紧邻的数学片段或数字串（10<sup>18</sup> → $10^{18}$）。
 */
function inlineParts(nodes, ctx) {
  const parts = [];
  const push = (text) => {
    if (text) parts.push(text);
  };
  for (const child of nodes) {
    if (isText(child)) {
      push(escapeText(child.value));
      continue;
    }
    const tag = tagOf(child);
    if (tag === 'i' || tag === 'em') {
      const tex = cleanMath(mathOf(child));
      if (tex) push(`$${tex}$`);
      continue;
    }
    if (tag === 'sup' || tag === 'sub') {
      const tex = cleanMath(mathOf(child));
      if (!tex) continue;
      const marker = tag === 'sup' ? '^' : '_';
      const last = parts.length - 1;
      const tail = parts[last];
      if (tail && /^\$[^$]+\$$/.test(tail)) {
        parts[last] = `$${tail.slice(1, -1)}${marker}{${tex}}$`;
        continue;
      }
      if (tail) {
        const m = /([A-Za-z0-9.]+)$/.exec(tail);
        if (m) {
          parts[last] = `${tail.slice(0, m.index)}$${m[1]}${marker}{${tex}}$`;
          continue;
        }
      }
      push(`$${marker}{${tex}}$`);
      continue;
    }
    if (tag === 'b' || tag === 'strong') {
      const inner = inlineParts(kids(child), ctx).join('');
      if (inner.trim()) push(`**${inner.trim()}**`);
      continue;
    }
    if (tag === 'code') {
      const text = mathOf(child);
      push('`' + text.replace(/`/g, "'") + '`');
      continue;
    }
    if (tag === 'img') {
      const src = ctx.image?.(child) ?? '';
      if (src) push(`![](${src})`);
      continue;
    }
    if (tag === 'br') {
      push(' ');
      continue;
    }
    // 其它行内标签（span 等）：递归
    push(inlineParts(kids(child), ctx).join(''));
  }
  return parts;
}

function inlineMd(node, ctx) {
  const text = mergeMathClusters(inlineParts(kids(node), ctx).join(''));
  // 「|$s$|」这类绝对值写法：把竖线收进公式，避免被当成表格分隔符
  return text.replace(/\|\$([^$|]+)\$\|/g, (_, tex) => `$|${tex}|$`).replace(/[ \t]{2,}/g, ' ');
}

/** 表格 → GFM 表格（首行当表头）。 */
function tableMd(wrap, ctx) {
  const rows = [];
  const walk = (node) => {
    for (const child of kids(node)) {
      const tag = tagOf(child);
      if (tag === 'tr') {
        rows.push(kids(child)
          .filter((c) => ['th', 'td'].includes(tagOf(c)))
          .map((c) => inlineMd(c, ctx).replace(/\|/g, '\\|')));
      } else walk(child);
    }
  };
  walk(wrap);
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  const lines = [
    `| ${pad(rows[0]).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`),
  ];
  return lines.join('\n');
}

/** 样例块 → { input, output }。 */
function sampleOf(div) {
  const pres = findAll(div, (n) => tagOf(n) === 'pre');
  const first = pres[0];
  const second = pres.find((p) => p !== first);
  const textOfPre = (p) => (p ? String(kids(p).map(textOf).join('')) : '');
  return {
    input: textOfPre(first).replace(/\s+$/, ''),
    output: textOfPre(second).replace(/\s+$/, ''),
  };
}

/** 单份题面（.pane）→ { md, samples }。 */
export function paneToMarkdown(pane, ctx) {
  const blocks = [];
  const samples = [];
  for (const child of kids(pane)) {
    if (isText(child)) {
      const t = String(child.value ?? '').trim();
      if (t) blocks.push(escapeText(t));
      continue;
    }
    const tag = tagOf(child);
    if (isClass(child, 'pane-tag')) continue;
    if (tag === 'p') {
      const md = inlineMd(child, ctx).trim();
      if (md) blocks.push(md);
    } else if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
      const md = inlineMd(child, ctx).trim();
      if (md) blocks.push(`${'#'.repeat(Math.min(4, Number(tag[1]) + 1))} ${md}`);
    } else if (tag === 'ul' || tag === 'ol') {
      const items = kids(child)
        .filter((c) => tagOf(c) === 'li')
        .map((li, i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${inlineMd(li, ctx).trim()}`);
      if (items.length) blocks.push(items.join('\n'));
    } else if (isClass(child, 'sample')) {
      samples.push(sampleOf(child));
    } else if (isClass(child, 'table-wrap')) {
      const md = tableMd(child, ctx);
      if (md) blocks.push(md);
    } else if (isClass(child, 'fig-row') || tag === 'figure') {
      const imgs = [];
      const collect = (n) => {
        for (const c of kids(n)) {
          if (tagOf(c) === 'img') {
            const src = ctx.image?.(c);
            if (src) imgs.push(`![](${src})`);
          } else collect(c);
        }
      };
      collect(child);
      if (imgs.length) blocks.push(imgs.join('\n\n'));
    } else {
      const md = inlineMd(child, ctx).trim();
      if (md) blocks.push(md);
    }
  }
  return { md: blocks.join('\n\n'), samples };
}

/** "2 秒" / "2 s" → 2000；"1 GiB" → 1024（MB）。 */
export function parseTimeLimit(text) {
  const m = /([\d.]+)\s*(ms|毫秒|s|秒)/i.exec(String(text ?? ''));
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return Math.round(/^(ms|毫秒)$/i.test(m[2]) ? value : value * 1000);
}

export function parseMemoryLimit(text) {
  const m = /([\d.]+)\s*(GiB|MiB|GB|MB)/i.exec(String(text ?? ''));
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return Math.round(/^(GiB|GB)$/i.test(m[2]) ? value * 1024 : value);
}

/** 题册页面 → 载荷。figureTable: { key: dataURI }（页面脚本里的 FIG 表）。 */
export function problemSetToPayload(document, options) {
  const {
    id, label, title, titleZh = null, source = null, startTime = null,
    durationSeconds = null, note = null, figureTable = {}, image = null,
    defaultTags = [],
  } = options;
  const problems = [];
  for (const article of document) {
    const letter = String(attrOf(article, 'data-letter') ?? '').trim();
    const titleEn = String(attrOf(article, 'data-title-en') ?? '').trim();
    const titleZhText = String(attrOf(article, 'data-title-zh') ?? '').trim();
    // 题面在 <div class="pbody"> 里，不是 article 的直接子节点
    const panes = findAll(article, (n) => isClass(n, 'pane'));
    const zhPane = panes.find((p) => isClass(p, 'pane-zh')) ?? null;
    const enPane = panes.find((p) => isClass(p, 'pane-en')) ?? null;
    if (!zhPane && !enPane) continue;
    const seenImages = new Set();
    const imageCtx = {
      image: (img) => {
        const key = attrOf(img, 'data-fig');
        const src = (key && figureTable[key]) || attrOf(img, 'src') || '';
        if (!src || !src.startsWith('data:')) return '';
        if (seenImages.has(src)) return '';
        seenImages.add(src);
        return image ? image(src) : src;
      },
    };
    const zh = zhPane ? paneToMarkdown(zhPane, imageCtx) : { md: '', samples: [] };
    const en = enPane ? paneToMarkdown(enPane, imageCtx) : { md: '', samples: [] };
    const samples = (zh.samples.length ? zh.samples : en.samples).map((s) => ({ ...s }));
    const index = letter || String.fromCharCode(65 + problems.length);
    problems.push({
      id: `${id}-${index.toLowerCase()}`,
      index,
      title: titleEn || titleZhText || `${title} ${index}`,
      titleZh: titleZhText || null,
      statementMd: en.md || zh.md,
      statementZhMd: zh.md || null,
      samples,
      timeLimitMs: parseTimeLimit(attrOf(article, 'data-time-en') ?? attrOf(article, 'data-time-zh')),
      memoryLimitMb: parseMemoryLimit(attrOf(article, 'data-memory')),
      difficulty: null,
      tags: defaultTags,
      url: null,
    });
  }
  return {
    format: 'ac-private-contest',
    version: 1,
    id,
    label,
    title,
    titleZh,
    source,
    startTime,
    durationSeconds,
    note,
    problems,
  };
}

/** 判断一份题面里是否还有明显没转换干净的 HTML 标签（自检用）。 */
export function leftoverHtml(md) {
  return /<(?:i|sup|sub|p|ul|li|table|figure|img|div)\b/i.test(String(md ?? ''));
}

export { CJK };
