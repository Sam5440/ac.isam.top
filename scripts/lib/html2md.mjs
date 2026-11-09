import * as cheerio from 'cheerio';

/**
 * 站内 HTML（AtCoder / Codeforces 题面）→ Markdown。
 *
 * 数学约定：统一输出 $…$ 行内 / $$…$$ 块级公式（站点端 KaTeX 渲染）。
 *  - AtCoder：<var> 内容即原始 TeX；<script type="math/tex"> 旧式 TeX 节点。
 *  - Codeforces：.tex-span 内容即 TeX；现代题面多为 Unicode 数学文本，
 *    原样保留；.tex-font-style-bf 与 .tex-font-style-it 转为粗体、斜体。
 */

function classesOf($, el) {
  return el.attr('class') || '';
}

function absUrl(href, base) {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/** 折叠纯文本空白（HTML 换行在行内语义中等价于空格）。 */
function cleanText(s) {
  // 文本节点里的实体解码产物（源站 &lt;script&gt; 还原出的字面 <>）必须重新
  // 转义后写入 markdown，否则字面 HTML 会经 marked 原样透传进渲染端，构成
  // 注入面（审查 2026-11-09 管线侧）。只转义 < >，保留 & 的既有语义；
  // 管线自产且有意保留的 <sub>/<sup> 不经过本函数（由标签分支直接输出）。
  return String(s)
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** <pre> 内容 → 纯文本（<var> 等数学标记拍平为文本，br/div 行转换行）。 */
export function preText(el) {
  const lines = [];
  const walk = (node, push) => {
    if (node.type === 'text') {
      push(node.data.replace(/\r/g, ''));
      return;
    }
    if (node.type !== 'tag') return;
    const tag = node.tagName;
    if (tag === 'br') {
      push('\n');
      return;
    }
    const isLineDiv = /(^|\s)test-example-line(\s|$)/.test(node.attribs.class || '');
    if (isLineDiv) {
      const buf = [];
      for (const c of node.children ?? []) walk(c, (t) => buf.push(t));
      push('\n' + buf.join('').replace(/[ \t]+$/,''));
      return;
    }
    if (tag === 'p' || tag === 'div' || tag === 'pre' || tag === 'li') {
      push('\n');
      for (const c of node.children ?? []) walk(c, push);
      push('\n');
      return;
    }
    for (const c of node.children ?? []) walk(c, push);
  };
  for (const c of (el.get(0)?.children ?? [])) walk(c, (t) => lines.push(t));
  const raw = lines.join('');
  // 规整：去掉首尾空行、合并 3+ 连续空行、去行尾空白
  return raw
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '') + '\n';
}

/** <img> → markdown。牛客公式图（equation?tex= 服务端 SVG）还原为行内公式。 */
function imgMd($, el, opts) {
  const src = el.attr('src') || '';
  // alt 通常即原始 TeX；部分页面 alt 为空，TeX 只在 URL 参数里
  if (/equation\?tex=/.test(src)) {
    let tex = (el.attr('alt') || '').trim();
    if (!tex) {
      try {
        tex = decodeURIComponent(src.split('tex=')[1] || '').trim();
      } catch {
        tex = '';
      }
    }
    return tex ? `$${tex}$` : '';
  }
  return `![${(el.attr('alt') || 'image').replace(/[\[\]]/g, '')}](${absUrl(src, opts.base)})`;
}

/** 行内转换。texMode=true 时 sub/sup 输出 _{} ^{}（用于 var/tex-span 内部）。 */
function inlineChildren($, nodes, opts, texMode = false) {
  const out = [];
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      out.push(cleanText(node.data));
      continue;
    }
    if (node.type !== 'tag') continue;
    const el = $(node);
    const tag = node.tagName;
    const inner = (tex = texMode) => inlineChildren($, node.children ?? [], opts, tex);
    switch (tag) {
      case 'var':
        out.push(`$${inner(true).trim()}$`);
        break;
      case 'script': {
        const type = node.attribs.type || '';
        if (type.includes('math/tex')) {
          const tex = el.text();
          if (type.includes('mode=display')) out.push(`\n\n$$${tex}$$\n\n`);
          else out.push(`$${tex}$`);
        }
        break;
      }
      case 'span': {
        const cls = classesOf($, el);
        if (/\btex-span\b/.test(cls)) out.push(`$${inner(true).trim()}$`);
        else if (/\btex-font-style-bf\b/.test(cls)) out.push(`**${inner()}**`);
        else if (/\btex-font-style-it\b/.test(cls)) out.push(`*${inner()}*`);
        else if (/\btex-font-style-tt\b/.test(cls)) out.push('`' + el.text() + '`');
        else if (/\bmath\b/.test(cls) && !/\bmathjax\b/.test(cls)) out.push(inner());
        else out.push(inner());
        break;
      }
      case 'sub':
      case 'sup':
        if (texMode) out.push((tag === 'sub' ? '_' : '^') + `{${inner(true)}}`);
        else out.push(`<${tag}>${inner()}</${tag}>`);
        break;
      case 'br':
        out.push('\n');
        break;
      case 'a':
        out.push(`[${inner().trim() || 'link'}](${absUrl(el.attr('href'), opts.base)})`);
        break;
      case 'img':
        out.push(imgMd($, el, opts));
        break;
      case 'code':
      case 'tt':
        out.push('`' + el.text().replace(/`/g, '’') + '`');
        break;
      case 'strong':
      case 'b':
        out.push(`**${inner()}**`);
        break;
      case 'em':
      case 'i':
        out.push(`*${inner()}*`);
        break;
      case 'u':
        out.push(inner());
        break;
      default:
        out.push(inner());
    }
  }
  return out.join('');
}

export function inlineMd($, el, opts) {
  return inlineChildren($, el.get(0)?.children ?? [], opts).replace(/\s+/g, ' ').trim();
}

/** 行内内容 → 段落文本：保留 <br> 换行但合并为单块（用于列表项）。 */
export function inlineMdBr($, el, opts) {
  return inlineChildren($, el.get(0)?.children ?? [], opts)
    .replace(/[ \t]*\n[ \t]*/g, '\\\n')
    .trim();
}

/**
 * 行内内容 → 段落块数组：单个换行是源 <br>（输出 GFM 硬换行 `\\`+换行，
 * 站点 marked gfm 模式渲染为 <br>）；两个以上连续换行（<br><br> 或
 * display 公式边界）视作分段，拆成独立块。
 */
function inlineBlocksOf($, el, opts) {
  return splitInlineBlocks(inlineChildren($, el.get(0)?.children ?? [], opts));
}

export function splitInlineBlocks(raw) {
  return String(raw)
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((s) => s.replace(/\n/g, '\\\n').trim())
    .filter(Boolean);
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'ul', 'ol', 'table', 'pre', 'blockquote', 'hr',
  'center', 'section', 'article', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

function hasBlockChild($, el) {
  return el.children().toArray().some((n) => n.type === 'tag' && BLOCK_TAGS.has(n.tagName));
}

const isBlockNode = (node) =>
  node.type === 'tag' && (BLOCK_TAGS.has(node.tagName) || node.tagName === 'center');

/**
 * 块级下钻：连续的行内兄弟节点（文本/行内公式图/<br>…）归组为一个行内
 * run 再转块 —— 牛客题面在 <div> 段落之间夹裸文本+行内公式图，逐节点
 * 处理会把一句话拆成多段。
 */
function drillBlocks($, nodes, opts, blocks) {
  let run = [];
  const flush = () => {
    if (!run.length) return;
    for (const md of splitInlineBlocks(inlineChildren($, run, opts))) blocks.push(md);
    run = [];
  };
  for (const node of nodes ?? []) {
    if (isBlockNode(node)) {
      flush();
      blockNode($, node, opts, blocks);
    } else {
      run.push(node);
    }
  }
  flush();
}

/** 单个块级节点 → markdown 段落数组（每项一个空行分隔的块）。 */
function blockNode($, node, opts, blocks) {
  if (node.type === 'text') {
    const t = cleanText(node.data).trim();
    if (t) blocks.push(t);
    return;
  }
  if (node.type !== 'tag') return;
  const el = $(node);
  const tag = node.tagName;
  switch (tag) {
    case 'p': {
      for (const md of inlineBlocksOf($, el, opts)) blocks.push(md);
      break;
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4': {
      const md = inlineMd($, el, opts);
      if (md) blocks.push(`${'#'.repeat(Number(tag[1]) + 1)} ${md}`);
      break;
    }
    case 'pre': {
      // 牛客的「输入描述/输出描述」内容装在 pre 里且内嵌公式图 —— 不是代码块，
      // 展开为段落让行内转换还原公式；纯文本 pre 才输出代码围栏。
      if ($(node).find('img[src*="equation?tex="]').length) {
        for (const md of inlineBlocksOf($, el, opts)) blocks.push(md);
        break;
      }
      const text = preText(el).replace(/\n$/, '');
      blocks.push('```\n' + text + '\n```');
      break;
    }
    case 'ul':
    case 'ol': {
      const items = [];
      el.children('li').each((_, li) => {
        const liEl = $(li);
        // li 内可能是行内内容或嵌套块；拍平为行内（嵌套列表缩进两格）
        let nested = '';
        liEl.children('ul,ol').each((__, sub) => {
          nested += '\n' + listToMd($, $(sub), opts, '  ');
        });
        liEl.children('ul,ol').remove();
        const body = inlineMdBr($, liEl, opts);
        items.push({ body, nested });
      });
      const list = items
        .map((it, i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${it.body}${it.nested}`)
        .join('\n');
      if (list) blocks.push(list);
      break;
    }
    case 'table': {
      const rows = [];
      el.find('tr').each((_, tr) => {
        const cells = [];
        $(tr).find('th,td').each((__, cell) => {
          cells.push(inlineMd($, $(cell), opts).replace(/\|/g, '\\|') || ' ');
        });
        if (cells.length) rows.push(cells);
      });
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const norm = rows.map((r) => [...r, ...Array(width - r.length).fill(' ')]);
        const md = [
          `| ${norm[0].join(' | ')} |`,
          `| ${norm[0].map(() => '---').join(' | ')} |`,
          ...norm.slice(1).map((r) => `| ${r.join(' | ')} |`),
        ].join('\n');
        blocks.push(md);
      }
      break;
    }
    case 'blockquote': {
      const inner = [];
      drillBlocks($, el.contents().toArray(), opts, inner);
      const md = inner.join('\n\n').split('\n').map((l) => `> ${l}`).join('\n');
      if (md.trim()) blocks.push(md);
      break;
    }
    case 'hr':
      blocks.push('---');
      break;
    case 'img':
      blocks.push(imgMd($, el, opts));
      break;
    case 'script': {
      const type = node.attribs.type || '';
      if (type.includes('math/tex') && type.includes('mode=display')) {
        blocks.push(`$$${el.text()}$$`);
      }
      break;
    }
    case 'div': {
      const cls = classesOf($, el);
      // CF 小节标题（Input/Output/Note 的标题行）
      if (/\bsection-title\b/.test(cls)) {
        const t = el.clone().children().remove().end().text().trim();
        if (t) blocks.push(`## ${t}`);
        break;
      }
      if (/\bpart\b/.test(cls) || /\bio-style\b/.test(cls) || /\bsample-tests\b/.test(cls)) {
        // AtCoder 的包裹层：下钻其子节点
        drillBlocks($, el.contents().toArray(), opts, blocks);
        break;
      }
      if (hasBlockChild($, el)) {
        // 包裹层内嵌块级结构：下钻，避免把段落/列表拍平成一行
        drillBlocks($, el.contents().toArray(), opts, blocks);
        break;
      }
      // 纯行内 div（牛客题面段）：源 <br> 转硬换行
      for (const md of inlineBlocksOf($, el, opts)) blocks.push(md);
      break;
    }
    case 'center': {
      for (const md of inlineBlocksOf($, el, opts)) blocks.push(md);
      break;
    }
    default: {
      if (hasBlockChild($, el)) {
        drillBlocks($, el.contents().toArray(), opts, blocks);
        break;
      }
      const md = inlineMd($, el, opts);
      if (md) blocks.push(md);
    }
  }
}

function listToMd($, el, opts, indent) {
  const items = [];
  el.children('li').each((_, li) => {
    const liEl = $(li);
    let nested = '';
    liEl.children('ul,ol').each((__, sub) => {
      nested += '\n' + indent + listToMd($, $(sub), opts, indent + '  ');
    });
    liEl.children('ul,ol').remove();
    items.push(`- ${inlineMdBr($, liEl, opts)}${nested}`);
  });
  return items.join(`\n${indent}`);
}

/** 一组节点 → markdown 文本（块间空行）。 */
export function nodesToMd($, nodes, opts) {
  const blocks = [];
  drillBlocks($, nodes, opts, blocks);
  return blocks.filter((b) => String(b).trim()).join('\n\n');
}

export function loadHtml(html) {
  return cheerio.load(html);
}
