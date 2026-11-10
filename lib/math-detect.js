/**
 * 纯函数：检测纯文本是否包含 TeX 公式 —— 决定样例输入/输出用 <pre> 原文
 * 展示还是走 renderRich 的 KaTeX 渲染路径。规则与 lib/render.js 的公式
 * 提取口径一致：$$…$$ 块级、\(…\) / \[…\] 历史残留定界、\begin{…} 环境、
 * 行内 $…$（沿用 renderRich 的收紧规则：定界符内侧紧邻非空白字符，防
 * 「成本 $5, 上限 $10」这类金额文本误判成公式）。
 */

// 与 render.js 行内 $…$ 同款收紧规则（Safari 兼容：不用 lookbehind）
const INLINE_MATH = /\$(\S(?:[^$\n]*?\S)?)\$/;

export function hasMathTex(text) {
  if (!text || typeof text !== 'string') return false;
  if (/\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/.test(text)) return true;
  if (/\\begin\s*\{[a-zA-Z*]+\}/.test(text)) return true;
  if (/\$\$[\s\S]+?\$\$/.test(text)) return true;
  return INLINE_MATH.test(text);
}
