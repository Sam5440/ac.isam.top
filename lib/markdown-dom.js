/**
 * Markdown 所见即所得编辑（浏览器 DOM ↔ Markdown）。
 *
 * - markdownToEditableHtml：复用站内 renderRich 的渲染结果，但把公式 token
 *   换成不可编辑的原始文本（`$...$`），避免全局 KatexRuntime 把 DOM 换成
 *   KaTeX 结构后无法再序列化回 Markdown。
 * - htmlToMarkdown：把 contentEditable 的 DOM 重新写回 Markdown，覆盖标题、
 *   段落、强调、行内代码、围栏代码、列表、引用、表格、链接、图片、分隔线与
 *   公式占位。只实现编辑器工具栏能产出的子集，够用且可预测。
 *
 * 纯浏览器模块（DOMParser / Element），服务端不要 import。
 */

import { renderRich } from './render.js';

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'div', 'figure', 'figcaption', 'footer', 'header',
  'main', 'nav', 'section', 'details', 'summary',
]);

function escapeMathToken(html) {
  return html.replace(
    /<code class="zs-math" data-display="([01])">([\s\S]*?)<\/code>/g,
    (_, display, raw) =>
      `<span class="md-math" contenteditable="false" data-display="${display}">${raw}</span>`,
  );
}

/** Markdown → contentEditable 的 HTML（公式保留原始文本，不交给 KaTeX）。 */
export function markdownToEditableHtml(md) {
  if (!md) return '';
  return escapeMathToken(renderRich(md));
}

function textOf(node) {
  return String(node?.nodeValue ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n');
}

function attr(node, name) {
  return node?.getAttribute?.(name) ?? '';
}

function inlineCode(text) {
  const raw = String(text ?? '').replace(/\n/g, ' ');
  if (!raw) return '';
  const runs = raw.match(/`+/g) ?? [];
  const longest = runs.reduce((n, run) => Math.max(n, run.length), 0);
  const fence = '`'.repeat(Math.max(1, longest + 1));
  return `${fence}${raw}${fence}`;
}

function inlineOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return textOf(node);
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  if (node.classList?.contains('md-math')) return node.textContent || '';
  switch (tag) {
    case 'br':
      return '  \n';
    case 'strong':
    case 'b': {
      const inner = childrenInline(node);
      return inner.trim() ? `**${inner}**` : inner;
    }
    case 'em':
    case 'i': {
      const inner = childrenInline(node);
      return inner.trim() ? `*${inner}*` : inner;
    }
    case 'del':
    case 's': {
      const inner = childrenInline(node);
      return inner.trim() ? `~~${inner}~~` : inner;
    }
    case 'code':
      return inlineCode(node.textContent || '');
    case 'a': {
      const href = attr(node, 'href');
      const label = childrenInline(node) || href;
      return href ? `[${label}](${href})` : label;
    }
    case 'img': {
      const src = attr(node, 'src');
      const alt = attr(node, 'alt');
      return src ? `![${alt}](${src})` : '';
    }
    case 'span':
    case 'u':
    case 'sub':
    case 'sup':
    case 'mark':
    default:
      return childrenInline(node);
  }
}

function childrenInline(node) {
  let out = '';
  for (const child of node.childNodes) out += inlineOf(child);
  return out;
}

function listOf(list, depth) {
  const ordered = list.tagName.toLowerCase() === 'ol';
  let counter = Number(attr(list, 'start') || 1) || 1;
  const lines = [];
  for (const li of [...list.children]) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    let main = '';
    const nested = [];
    for (const child of li.childNodes) {
      if (child.nodeType === 1 && /^(ul|ol)$/i.test(child.tagName)) {
        nested.push(listOf(child, depth + 1));
      } else if (child.nodeType === 1 && /^p$/i.test(child.tagName)) {
        main += `${main.trim() ? ' ' : ''}${childrenInline(child)}`;
      } else {
        main += inlineOf(child);
      }
    }
    main = main.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    const marker = ordered ? `${counter++}. ` : '- ';
    lines.push(`${'  '.repeat(depth)}${marker}${main}`.trimEnd());
    for (const block of nested) if (block) lines.push(block);
  }
  return lines.join('\n');
}

function rowsOf(table) {
  return [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.children]
      .filter((cell) => /^(th|td)$/i.test(cell.tagName))
      .map((cell) => childrenInline(cell).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()),
  ).filter((cells) => cells.length);
}

function tableOf(table) {
  const rows = rowsOf(table);
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  const head = pad(rows[0]);
  const body = rows.slice(1).map(pad);
  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function codeBlockOf(pre) {
  const code = pre.querySelector('code');
  const raw = (code ?? pre).textContent ?? '';
  const lang = String(
    attr(code, 'data-lang') ||
      code?.className?.match(/language-([\w-]+)/)?.[1] ||
      attr(pre, 'data-lang') ||
      '',
  ).trim();
  const body = raw.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  const longest = (body.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}

function blockOf(node, depth = 0) {
  if (!node) return '';
  if (node.nodeType === 3) return textOf(node);
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const text = childrenInline(node).replace(/\s+/g, ' ').trim();
    return text ? `${'#'.repeat(level)} ${text}` : '';
  }
  switch (tag) {
    case 'p':
      return childrenInline(node).trim();
    case 'pre':
      return codeBlockOf(node);
    case 'ul':
    case 'ol':
      return listOf(node, depth);
    case 'blockquote': {
      const body = [...node.childNodes].map((c) => blockOf(c, depth)).filter(Boolean).join('\n\n');
      if (!body) return '';
      return body
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    }
    case 'hr':
      return '---';
    case 'table':
      return tableOf(node);
    case 'br':
      return '';
    case 'img': {
      const src = attr(node, 'src');
      return src ? `![${attr(node, 'alt')}](${src})` : '';
    }
    case 'details':
      return childrenBlocks(node, depth);
    default: {
      if (BLOCK_TAGS.has(tag)) return childrenBlocks(node, depth);
      return inlineOf(node);
    }
  }
}

function childrenBlocks(node, depth) {
  return [...node.childNodes].map((child) => blockOf(child, depth)).filter((s) => s.trim()).join('\n\n');
}

/** contentEditable 根节点 → Markdown 文本。 */
export function htmlToMarkdown(root) {
  if (!root) return '';
  const out = childrenBlocks(root, 0)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out ? `${out}\n` : '';
}

export default { markdownToEditableHtml, htmlToMarkdown };