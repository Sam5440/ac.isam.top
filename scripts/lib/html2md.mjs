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
  return String(s).replace(/[ \t\r\n]+/g, ' ');
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
        out.push(`![${(el.attr('alt') || 'image').replace(/[\[\]]/g, '')}](${absUrl(el.attr('src'), opts.base)})`);
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
      const md = inlineChildren($, node.children ?? [], opts).replace(/[ \t]*\n[ \t]*/g, '\n').trim();
      if (md) blocks.push(md);
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
        const body = inlineMd($, liEl, opts);
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
      el.contents().each((_, c) => blockNode($, c, opts, inner));
      const md = inner.join('\n\n').split('\n').map((l) => `> ${l}`).join('\n');
      if (md.trim()) blocks.push(md);
      break;
    }
    case 'hr':
      blocks.push('---');
      break;
    case 'img':
      blocks.push(`![${(el.attr('alt') || 'image').replace(/[\[\]]/g, '')}](${absUrl(el.attr('src'), opts.base)})`);
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
        el.contents().each((_, c) => blockNode($, c, opts, blocks));
        break;
      }
      const md = inlineMd($, el, opts);
      if (md) blocks.push(md);
      break;
    }
    case 'center': {
      const md = inlineMd($, el, opts);
      if (md) blocks.push(md);
      break;
    }
    default: {
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
    items.push(`- ${inlineMd($, liEl, opts)}${nested}`);
  });
  return items.join(`\n${indent}`);
}

/** 一组节点 → markdown 文本（块间空行）。 */
export function nodesToMd($, nodes, opts) {
  const blocks = [];
  for (const node of nodes ?? []) blockNode($, node, opts, blocks);
  return blocks.filter((b) => String(b).trim()).join('\n\n');
}

export function loadHtml(html) {
  return cheerio.load(html);
}
