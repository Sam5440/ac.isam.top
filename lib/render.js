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
  let text = String(md).replace(/```[^\n]*\n[\s\S]*?```|`[^`\n]+`/g, (m) => keep('code', m));
  // 兼容 Codeforces 源码级数学标记（$$$$$$ 块级 / $$$ 行内），先长后短
  text = text.replace(/\$\$\$\$\$\$([\s\S]+?)\$\$\$\$\$\$/g, (_, t) => keep('md', t));
  text = text.replace(/\$\$\$([\s\S]+?)\$\$\$/g, (_, t) => keep('mi', t));
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep('md', t));
  text = text.replace(/\$([^$\n]+?)\$/g, (_, t) => keep('mi', t));
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
