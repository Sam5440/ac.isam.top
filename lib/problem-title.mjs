/**
 * 题名净化（纯函数，client/server 通用）。
 *
 * 题名的来源是外部数据：CF 的 title 原样抓取、titleZh 由 LLM 翻译生成 —— 两者都可能
 * 带 markdown/TeX 标记（实测 codeforces/1282b2 的 titleZh 是「一份的钱买 $k$ 份（困难版）」，
 * 1744d「被 $2^n$ 整除」，agc070_e「删除 $2K+1$ 条边」）。题名在站点里几乎全部以**纯文本**
 * 出口渲染（document.title、下拉选择项、面包屑、复制题目、列表卡片、赛题目录），
 * 走 markdown 渲染就会出现字面量 `$k$`（2026-11-17 用户反馈「部分题目显示不正确」的一部分）。
 *
 * 因此统一在数据出口把它们拍平成纯文本：数学定界符连同定界符一起去掉、只留公式正文
 * （`$k$` → `k`），并折叠空白。题面正文里的公式不受影响（那是 renderRich 的职责）。
 */

/** 数学定界符 → 正文。顺序：先块级/历史定界，再行内，避免行内规则把 $$ 拆碎。 */
const DELIMITERS = [
  [/\$\$([\s\S]+?)\$\$/g, '$1'], // $$…$$
  [/\\\[([\s\S]+?)\\\]/g, '$1'], // \[…\]
  [/\\\(([\s\S]+?)\\\)/g, '$1'], // \(…\)
  [/\$([^$\n]+?)\$/g, '$1'], // $…$
];

/** 行内代码反引号、HTML 常见实体（题名里偶发 &lt; &amp;）。 */
function stripInlineMarkup(s) {
  return s
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 题名 → 纯文本（幂等；非字符串返回空串）。
 * 注意不处理 * 与 **：AtCoder 有真实题名就叫 "AtCoder *** Contest"，去掉会改坏原题名。
 */
export function plainTitle(title) {
  if (typeof title !== 'string') return '';
  let s = stripInlineMarkup(title);
  for (const [re, rep] of DELIMITERS) s = s.replace(re, rep);
  // 定界符剥掉后残留的多余空白与首尾空格归一
  return s.replace(/\s+/g, ' ').trim();
}

/** 题名记录（{title,titleZh}）→ 双字段净化后的浅拷贝；缺字段原样保留。 */
export function plainTitled(problem) {
  if (!problem || typeof problem !== 'object') return problem;
  const out = { ...problem };
  if (typeof problem.title === 'string') out.title = plainTitle(problem.title);
  if (typeof problem.titleZh === 'string') out.titleZh = plainTitle(problem.titleZh);
  return out;
}
