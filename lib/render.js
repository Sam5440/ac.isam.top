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
  return String(md)
    .replace(/(?<!\\)\\\[([\s\S]+?)\\\]/g, (_, t) => `$$${t}$$`)
    .replace(/(?<!\\)\\\(([\s\S]+?)\\\)/g, (_, t) => `$${t}$`);
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
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, mathKeep('md'));
  text = text.replace(/\$([^$\n]+?)\$/g, mathKeep('mi'));
  let html = marked.parse(text);
  html = html.replace(/%%ACcode(\d+)%%/g, (_, i) => renderCodeBlock(stash[i].content));
  html = html.replace(/%%ACmi(\d+)%%/g, (_, i) => mathToken(stash[i].content, false));
  html = html.replace(/%%ACmd(\d+)%%/g, (_, i) => mathToken(stash[i].content, true));
  // 牛客图床（uploadfiles.nowcoder.com）对站外 Referer 返回 403，
  // 站内渲染的 <img> 一律不带 Referer（实测无 Referer 可正常返回图片）。
  html = html.replace(/<img\b/g, '<img referrerpolicy="no-referrer"');
  return html;
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
