import { marked } from 'marked';
import { parseFragment, serialize } from 'parse5';

marked.setOptions({ gfm: true, breaks: false });

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 数学不在服务端渲染：SSR 与客户端输出同一段惰性 token，hydration 看到
 * 完全一致的 HTML；页面级监听器（KatexRuntime）挂载后把 token 换成真正
 * 的 KaTeX 标记，预渲染页面保持轻量。
 */
function mathToken(tex, displayMode) {
  const fence = displayMode ? '$$' : '$';
  return `<code class="zs-math" data-display="${displayMode ? 1 : 0}">${escapeHtml(
    fence + tex + fence,
  )}</code>`;
}

/**
 * AtCoder 的输入/输出格式块原站是 <pre> 内嵌 <var>（TeX，由 MathJax 渲染），
 * 管道拍平后成了无语言代码块，`\vdots` / `A_1` / `\mathrm{case}_i` 原样显示。
 * 这里按「格式块」识别：无语言标注、无代码特征字符、带下标/TeX 命令，且
 * 剥掉 TeX 命令后不存在与数学符号粘连的英文单词（排除 print(a_1) 之类代码）。
 * 命中后按空白（花括号外、非 `\ ` 转义）切分，数学 token 逐个走 KaTeX，
 * 空白与普通单词原样保留 —— 与原站「变量之间是普通空格」的排版一致。
 */
const FORMAT_FORBIDDEN = /[;="#<>$%&@`~]/;
const FORMAT_SIGNAL = /\\[a-zA-Z]{2,}|[A-Za-z0-9}')]\s*_\s*[\w{\\]|\^/;
const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

/** 格式块行预处理：`A _ 1` 收紧为 `A_1`，`u^'_1` 修正为 `u'_1`；`\rm case` 归一为 `\mathrm{case}`；
 *  `\cdotsc_{1,W}` 这类抓取时丢了空格的省略号命令补回空格。 */
function tidyFormatLine(line) {
  return line
    .replace(/\s*([_^])\s*/g, '$1')
    .replace(/\^'/g, "'")
    .replace(/\\rm\s+([A-Za-z]+)/g, '\\mathrm{$1}')
    .replace(/\\(cdots|ldots|vdots|ddots|dots)(?=[A-Za-z])/g, '\\$1 ');
}

function splitFormatTokens(line) {
  const parts = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      buf += ch + line[i + 1];
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (buf) parts.push({ math: true, s: buf });
      buf = '';
      const last = parts[parts.length - 1];
      if (last && !last.math) last.s += ch;
      else parts.push({ math: false, s: ch });
      continue;
    }
    buf += ch;
  }
  if (buf) parts.push({ math: true, s: buf });
  return parts;
}

/** 不需要 KaTeX 的 token：纯英文单词（swapLR / Yes）、纯数字、省略号/冒号等标点、含 CJK。 */
function isPlainWord(tok) {
  return /^[A-Za-z]{2,}$/.test(tok) || /^[:：.…‥\-,|!?]+$/.test(tok) || /^\d+$/.test(tok)
    || CJK.test(tok);
}

function formatTokens(body) {
  if (!body.trim() || FORMAT_FORBIDDEN.test(body) || !FORMAT_SIGNAL.test(body)) return null;
  const lines = body.split('\n').map((l) => splitFormatTokens(tidyFormatLine(l)));
  for (const line of lines) {
    for (const p of line) {
      if (!p.math || isPlainWord(p.s)) continue;
      const bare = p.s
        .replace(/\\(?:mathrm|text|textrm|mathit|mathtt|mathbf|operatorname|rm|bf)\s*\{[^}]*\}/g, '')
        .replace(/\\[a-zA-Z]+/g, '')
        .replace(/[A-Za-z]+\}?(?=[_^])/g, '')
        .replace(/[_^]\{[^{}]*\}/g, '');
      // 剥掉 TeX 命令、上下标与「单词_下标」底数后仍有 3+ 连续小写字母
      // （print(a / Input: 之类）→ 判定为代码/伪代码，整块保持原样
      if (/[a-z]{3,}/.test(bare)) return null;
    }
  }
  return lines;
}

/** 多字母底数（case_1 / Query_i）按 AtCoder 惯例用正体，避免斜体字母挤成一团。 */
function formatTokenTex(tok) {
  return tok.replace(/(^|[^\\A-Za-z{])([A-Za-z]{2,})(?=_)/g, '$1\\mathrm{$2}');
}

function renderFormatBlock(lines) {
  const html = lines
    .map((line) => line
      .map((p) => (p.math && !isPlainWord(p.s) ? mathToken(formatTokenTex(p.s), false) : escapeHtml(p.s)))
      .join(''))
    .join('\n');
  return `<pre class="code-block tex-format"><code>${html}</code></pre>`;
}

function renderCodeBlock(block) {
  const fence = block.match(/^```([^\n]*)\n([\s\S]*?)```\s*$/);
  if (fence) {
    const lang = fence[1].trim().toLowerCase();
    if (!lang || lang === 'text') {
      const lines = formatTokens(fence[2].replace(/\n$/, ''));
      if (lines) return renderFormatBlock(lines);
    }
    return `<pre class="code-block"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(
      fence[2].replace(/\n$/, ''),
    )}</code></pre>`;
  }
  return `<code class="inline-code">${escapeHtml(block.slice(1, -1))}</code>`;
}

/**
 * 渲染前字符清洗（代码块内同样适用 —— 这些字符只可能是抓取/翻译残留）：
 *  - 控制字符 \u0000–\u001F、DEL：HTML 实体解析残留与 LLM 翻译偶发 ESC，
 *    轻则乱码，重则被行内 $…$ 规则误配对成公式送进 KaTeX 渲染出错误框；
 *  - 零宽字符（ZWSP/ZWNJ/ZWJ/BOM）：MT 残留，混进公式会产生
 *    「No character metrics」且复制样例代码会带进不可见字符导致 CE；
 *  - 分数斜线 ⁄（U+2044）：MT 把 / 替换的产物，KaTeX 无字形；
 *  - NBSP（U+00A0）：HTML &nbsp; 实体残留（存量 1.9 万处），进公式
 *    触发 KaTeX 字形告警，进代码块会在复制后编译失败。
 */
export function sanitizeText(md) {
  if (!md) return md ?? '';
  return String(md)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u2044/g, '/')
    .replace(/\u00A0/g, ' ');
}

/**
 * TeX 定界符归一：兼容历史数据残留的 \(…\) / \[…\]（存量 19 题，AtCoder 旧
 * 页面按字面量输出），统一转为 $…$ / $$…$$，否则原样显示 LaTeX 源码。
 * 前向 lookbehind 排除 LaTeX 自身的 \\[1em] 行距与 \\( 换行。
 * 注意：只应用于正文（renderRich 先隔离代码块再调用）；管道入库时整篇调用
 * 与 CF normalizeCfMath 的既有口径一致。
 */
export function normalizeMathMarks(md) {
  if (!md) return md ?? '';
  // 用捕获组而非 lookbehind：Safari < 16.4 不支持 lookbehind，正则字面量在
  // 模块解析期抛 SyntaxError 会让整个 bundle 白屏。
  return String(md)
    .replace(/(^|[^\\])\\\[([\s\S]+?)\\\]/g, (_, pre, t) => `${pre}$$${t}$$`)
    .replace(/(^|[^\\])\\\(([\s\S]+?)\\\)/g, (_, pre, t) => `${pre}$${t}$`);
}

/**
 * LLM 译文偶发把 TeX 命令的反斜杠转义两次：`$\\mathrm{case}_i$`、`$1\\le N$`
 * （存量 36 题），KaTeX 会把 `\\` 当换行、命令名当普通字母渲染。公式里不含
 * \begin 环境（矩阵/cases 才有合法的 `\\` 换行）时，把 `\\` + 字母还原为单反斜杠。
 */
function fixDoubleEscape(tex) {
  if (/\\begin\s*\{/.test(tex)) return tex;
  return tex.replace(/\\\\(?=[a-zA-Z])/g, '\\');
}

/**
 * 渲染含公式的 Markdown（数据管道已把 CF 的 $$$…$$$ / AtCoder 的 \(…\)
 * 统一归一为 $…$ 行内与 $$…$$ 块级公式）。代码块/行内代码不参与公式提取。
 */
export function renderRich(md) {
  if (!md) return '';
  const stash = [];
  const keep = (type, content) => {
    stash.push({ type, content });
    return `%%AC${type}${stash.length - 1}%%`;
  };
  let text = sanitizeText(md).replace(/```[^\n]*\n[\s\S]*?```|`[^`\n]+`/g, (m) => keep('code', m));
  text = normalizeMathMarks(text);
  // 兼容 Codeforces 源码级数学标记（$$$$$$ 块级 / $$$ 行内），先长后短；
  // 公式体内的 tab 归一为空格（TeX 语义等价，避免 KaTeX 字形告警）
  const mathKeep = (type) => (_, t) => keep(type, fixDoubleEscape(String(t).replace(/\t/g, ' ')));
  text = text.replace(/\$\$\$\$\$\$([\s\S]+?)\$\$\$\$\$\$/g, mathKeep('md'));
  text = text.replace(/\$\$\$([\s\S]+?)\$\$\$/g, mathKeep('mi'));
  // $$…$$ 块级公式可跨行(含空行),保持 [\s\S];行内 $…$ 收紧见下
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, mathKeep('md'));
  // 行内 $…$：要求定界符内侧紧邻非空白字符 —— 否则「成本 $5,上限 $10」这类
  // 金额文本会被截成公式送进 KaTeX 渲染出错误框。
  text = text.replace(/\$(\S(?:[^$\n]*?\S)?)\$/g, mathKeep('mi'));
  let html = marked.parse(text);
  html = html.replace(/%%ACcode(\d+)%%/g, (_, i) => renderCodeBlock(stash[i].content));
  html = html.replace(/%%ACmi(\d+)%%/g, (_, i) => mathToken(stash[i].content, false));
  html = html.replace(/%%ACmd(\d+)%%/g, (_, i) => mathToken(stash[i].content, true));
  // 牛客图床（uploadfiles.nowcoder.com）对站外 Referer 返回 403，
  // 站内渲染的 <img> 一律不带 Referer（实测无 Referer 可正常返回图片）。
  html = html.replace(/<img\b/g, '<img referrerpolicy="no-referrer"');
  return sanitizeRichHtml(html);
}

/**
 * 出口净化（修复 2026-11-09 审查 P0-2）。marked 默认原样放行 raw HTML，而
 * renderRich 的数据来自持续摄入的外部源（抓取题面 / MT 译文 / AI 回复 /
 * 用户自定义 AI 端点），任何一处携带 <img onerror> 或 <script> 都会经
 * dangerouslySetInnerHTML 在访问者浏览器执行（AI 回复还被持久化，每次打开
 * 面板重新执行）。管线侧已在 html2md 对文本节点重新转义 <>，这里对
 * MT/AI 等绕过管线的入口做最后兜底：
 * parse5 解析并按标签/属性白名单重建；URL 校验在 HTML entity 解码后执行。
 */
const SAFE_TAGS = new Set([
  'a', 'blockquote', 'br', 'circle', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'img', 'li', 'ol', 'p', 'path', 'pre', 's', 'span', 'strong',
  'sub', 'sup', 'svg', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);
const DROP_TAGS = new Set([
  'base', 'embed', 'form', 'iframe', 'link', 'math', 'meta', 'object', 'script', 'style',
  'template',
]);
const SAFE_ATTRS = new Set([
  'alt', 'aria-hidden', 'class', 'colspan', 'cx', 'cy', 'd', 'data-display', 'data-lang',
  'fill', 'height', 'href', 'loading', 'r', 'referrerpolicy', 'role', 'rowspan', 'src',
  'start', 'stroke', 'stroke-linecap', 'stroke-linejoin', 'stroke-width', 'title', 'viewbox', 'width',
]);
const RASTER_DATA_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp|avif);base64,[a-z0-9+/]+=*$/i;

function safeRichUrl(value, tag, attr) {
  const original = String(value).trim();
  const normalized = original.replace(/[\u0000-\u0020\u007f]/g, '');
  if (attr === 'src' && normalized.length <= 65536 && RASTER_DATA_IMAGE.test(normalized)) return true;
  if (/^(?:javascript|vbscript|data):/i.test(normalized)) return false;
  try {
    const url = new URL(normalized, 'https://ac.invalid/');
    const protocols = tag === 'a' && attr === 'href'
      ? ['https:', 'http:', 'mailto:']
      : ['https:', 'http:'];
    return protocols.includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeTree(parent) {
  for (let i = 0; i < (parent.childNodes?.length ?? 0);) {
    const child = parent.childNodes[i];
    if (child.nodeName === '#comment') {
      parent.childNodes.splice(i, 1);
      continue;
    }
    const tag = child.tagName?.toLowerCase();
    if (tag && DROP_TAGS.has(tag)) {
      parent.childNodes.splice(i, 1);
      continue;
    }
    sanitizeTree(child);
    if (tag && !SAFE_TAGS.has(tag)) {
      const children = child.childNodes ?? [];
      for (const item of children) item.parentNode = parent;
      parent.childNodes.splice(i, 1, ...children);
      i += children.length;
      continue;
    }
    if (tag) {
      child.attrs = (child.attrs ?? []).filter(({ name, value }) => {
        const attr = name.toLowerCase();
        if (!SAFE_ATTRS.has(attr) || attr.startsWith('on')) return false;
        if ((attr === 'fill' || attr === 'stroke')
          && !/^(?:none|currentcolor|#[\da-f]{3,8}|[a-z]{1,20})$/i.test(value)) return false;
        if (['cx', 'cy', 'r', 'stroke-width', 'width', 'height'].includes(attr)
          && !/^[\d.]+(?:px)?$/.test(value)) return false;
        return attr !== 'href' && attr !== 'src' ? true : safeRichUrl(value, tag, attr);
      });
      if (tag === 'a') {
        const href = child.attrs.find((attr) => attr.name === 'href');
        if (href && /^https?:/i.test(href.value)) {
          child.attrs.push({ name: 'rel', value: 'noopener noreferrer' });
        }
      }
      if (tag === 'img' && !child.attrs.some((attr) => attr.name === 'referrerpolicy')) {
        child.attrs.push({ name: 'referrerpolicy', value: 'no-referrer' });
      }
    }
    i += 1;
  }
}

export function sanitizeRichHtml(html) {
  const fragment = parseFragment(String(html));
  sanitizeTree(fragment);
  return serialize(fragment);
}

const RATING_COLORS = [
  [1200, '#9aa3b5'],
  [1400, '#43d17e'],
  [1600, '#2fd6c3'],
  [1900, '#5b8dff'],
  [2100, '#b06bff'],
  [2400, '#ff9d45'],
  [Infinity, '#ff5b6e'],
];

export function ratingColor(rating) {
  if (rating == null) return '#9aa3b5';
  for (const [max, color] of RATING_COLORS) {
    if (rating < max) return color;
  }
  return '#9aa3b5';
}
