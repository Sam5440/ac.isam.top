import { marked } from 'marked';

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

function renderCodeBlock(block) {
  const fence = block.match(/^```([^\n]*)\n([\s\S]*?)```\s*$/);
  if (fence) {
    const lang = fence[1].trim().toLowerCase();
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
  const mathKeep = (type) => (_, t) => keep(type, String(t).replace(/\t/g, ' '));
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
 *  - 整块移除 script/style/iframe/object/embed/link/meta/base/form/template/svg/math
 *    （含闭合块）与 HTML 注释；
 *  - 剥离所有 on* 事件属性与 srcdoc/formaction;
 *  - href/src 的 javascript:/vbscript:/非图片 data: 一律置为 "#"。
 * 白名单放行 marked 与管线自产的常规标签/属性(p、pre/code、表格、img、
 * sub/sup、data-lang、data-display、referrerpolicy 等)。
 */
const SANITIZE_BLOCK =
  'script|style|iframe|object|embed|link|meta|base|form|template|svg|math';
const RE_BLOCK_FULL = new RegExp(
  `<(?:${SANITIZE_BLOCK})\\b[^>]*>[\\s\\S]*?</(?:${SANITIZE_BLOCK})\\s*>`,
  'gi',
);
const RE_BLOCK_OPEN = new RegExp(`<(?:${SANITIZE_BLOCK})\\b[^>]*/?>`, 'gi');
const RE_COMMENT = /<![\s\S]*?>/g;
const RE_ON_ATTR = /\son[a-z0-9]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const RE_DANGEROUS_ATTR =
  /\s(?:srcdoc|formaction|action|background)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const RE_JS_URL =
  /(\shref\s*=|\ssrc\s*=|\sxlink:href\s*=)\s*(?:"\s*(?:javascript|vbscript|data\s*:\s*(?!image\/))[^"]*"|'\s*(?:javascript|vbscript|data\s*:\s*(?!image\/))[^']*'|(?:javascript|vbscript|data\s*:\s*(?!image\/))[^\s>]*)/gi;

export function sanitizeRichHtml(html) {
  return String(html)
    .replace(RE_COMMENT, '')
    .replace(RE_BLOCK_FULL, '')
    .replace(RE_BLOCK_OPEN, '')
    .replace(RE_ON_ATTR, '')
    .replace(RE_DANGEROUS_ATTR, '')
    .replace(RE_JS_URL, '$1"#"' );
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
