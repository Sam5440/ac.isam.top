import { marked } from 'marked';
import { defaultTreeAdapter, parseFragment, serialize } from 'parse5';

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
/**
 * 「文本语言」证据：假名 + 汉字。中文/全角标点（、，。：；？！（）「」等）与全角
 * 数学符号（≤ ＜ ≦ 等）不算 —— 它们经常出现在公式里（1245a 的 $0、10、20、30$、
 * 1063c 的 $0 ≤ x_1，y_1 ≤ 10^9$），算成 CJK 会把整段公式判成正文。
 */
const CJK_TEXT = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uFF66-\uFF9F]/;

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

/**
 * 行内代码里也可能装公式：Codeforces 交互题把输出格式写成
 *   print "`! $a_1$ $a_2$ $\ldots$ $a_n$`"
 * 整段当代码保住会让用户看到字面 $a_1$。这里把「成对且像公式」的 $…$ 切出来：
 * 片段仍走 inline-code，公式走 zs-math；只有单个 $ 的（$8 coffee、字符 $ 的 ASCII 码）不动。
 * 返回 null 表示整段保持代码。
 */
function splitCodeMath(content) {
  const dollars = [];
  for (let i = 0; i < content.length; i += 1) if (content[i] === '$') dollars.push(i);
  // 美元号必须成对出现（奇数个 = 有真美元号/转义残留，整段保持代码最安全）
  if (dollars.length < 2 || dollars.length % 2 !== 0) return null;
  const parts = [];
  let last = 0;
  for (let k = 0; k + 1 < dollars.length; k += 1) {
    const open = dollars[k];
    const close = dollars[k + 1];
    const body = content.slice(open + 1, close);
    if (!looksInlineMathBody(body)) continue;
    if (open > last) parts.push({ code: content.slice(last, open) });
    parts.push({ math: body.trim() });
    last = close + 1;
    k += 1;
  }
  if (!last) return null;
  if (last < content.length) parts.push({ code: content.slice(last) });
  return parts;
}

/** 行内代码里的公式字符集：字母数字、\\命令、上下标/括号/逗号点号/运算符/竖线/引号。 */
const INLINE_CODE_MATH_CHARS = /^[A-Za-z0-9_^{}()[\].,+\-*/=<>|'\\?]+$/;

/**
 * 行内代码里的公式体判定（短公式形状）：
 *  - 长度 ≤ 60、不许含空白（`$hello world$` 是代码里的美元号对，不是公式）；
 *  - 只许字母数字 / \\命令 / _ ^ { } ( ) [ ] , . + - * / = < > | 引号 ?（中文、全角符号一律排除）；
 *  - 至少要有一个字母数字或 ?（`$x$`、`$a$`、`$?$`、`$0$`、`$S$`、`$x_1$` 都算，`$$` 空体不算）。
 */
function looksInlineMathBody(body) {
  const t = body.trim();
  if (!t || t.length > 60) return false;
  if (/\s/.test(t)) return false;
  if (!INLINE_CODE_MATH_CHARS.test(t)) return false;
  return /[A-Za-z0-9?]/.test(t);
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

/* ============================================================================
 * 数学清洗四件套：实体解码 / 不可见文本 / 残缺定界符 / 裸 TeX 抢救
 * 存量题面（抓取端遗留）有四类数学缺陷，全部在渲染层兜底：
 *  A) 公式里的 HTML 实体（AtCoder 拍平 HTML 后 $a_i &lt; a_j$）；
 *  B) CF 愚人节题的 CSS 隐藏提示（\style{opacity:0…}），原站不可见；
 *  C) $ 定界符残缺（$ 1 \le n$、$$100\,000$、孤立的 $$$）；
 *  D) 定界符彻底丢失的裸 TeX（(1 \le T \le 10^4)）。
 * ==========================================================================*/

/**
 * 公式内容里的 HTML 实体解码。AtCoder 题面 HTML 拍平后小于号留在公式里成了
 * &lt;（存量如 abc036_c 的 $a_i &lt; a_j$、abc034_a 的 $x &lt; y$），实体原样
 * 送 KaTeX 会显示成「&lt;」甚至报错。
 * 只解码常见具名实体与数字引用；单趟替换，所以 &amp;lt; 只会还原成 &lt;
 * （= 小于号字面量），不会二次解码成小于号。
 */
const MATH_ENTITY = /&(?:lt|gt|amp|quot|apos|nbsp|#\d{1,7}|#[xX][\da-fA-F]{1,6});/gi;
const ENTITY_CHARS = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

export function decodeMathEntities(s) {
  const src = String(s ?? '');
  if (src.indexOf('&') < 0) return src;
  return src.replace(MATH_ENTITY, (m) => {
    const body = m.slice(1, -1);
    if (body[0] !== '#') return ENTITY_CHARS[body.toLowerCase()] ?? m;
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
    if (code >= 0xd800 && code <= 0xdfff) return m;
    return String.fromCodePoint(code);
  });
}

/**
 * Codeforces 愚人节题把「不该被选手看见的提示」写成不可见 TeX，例如
 * cf-gyms/106795c 的
 *   {\style{opacity:0;font-size:0px}{\tiny{\text{You must use i in exactly 1 for loop}}}}
 * （另有 106795d/106795i、codeforces/2129b、2189c1/c2）。原站靠 CSS 藏起来，
 * 抓取后成了普通正文 —— 这里按「不可见语义」整组删除（连外层花括号一起，
 * 不留可见文字）；\style{color:red}{…} 之类正常样式不动。
 */
const INVISIBLE_DECL = /(?:^|;)\s*(?:opacity\s*:\s*0+(?:\.0+)?(?=\s*[;}]|$)|display\s*:\s*none(?=\s*[;}]|$)|visibility\s*:\s*hidden(?=\s*[;}]|$)|font-size\s*:\s*0(?:px|pt|em|rem|%|ex)?(?=\s*[;}]|$))/i;

/** 从 s[i] === '{' 起找配对的 '}'，返回其后一位下标；不配对返回 -1。 */
function matchBrace(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j += 1) {
    const ch = s[j];
    if (ch === '\\') { j += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/** 方括号配平（\xrightarrow[下]{上} 这类可选参数）。 */
function matchBracket(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j += 1) {
    const ch = s[j];
    if (ch === '\\') { j += 1; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/**
 * 反引号片段里出现 texttt 命令，说明这不是 markdown 代码，而是数据把反引号塞进了
 * 公式里（nowcoder 的 texttt 包引号写法）：不能当代码抽走，否则后面的 $ 配对全乱。
 */
function containsTexText(m) {
  return /\\texttt/.test(m);
}

/**
 * 删掉被清空后只剩定界符的空公式。
 * 隐藏提示常写成 美元符 + {\style{opacity:0…}{…}} + 美元符：style 命令整段被删掉后，
 * 正好剩下两个美元符，渲染出来就是两个字面美元符（cf-gyms/106794g、106795g 的中文译文）。
 * 这里只删「恰好包住被删内容」的那对定界符，不用全局正则——全局规则会把真正的
 * 块级公式开头的 $$（1552h）也当成空公式吃掉。
 */
export function stripHiddenTex(text) {
  const src = String(text ?? '');
  let out = '';
  let i = 0;
  for (;;) {
    const at = src.indexOf('\\style', i);
    if (at < 0) return out + src.slice(i);
    let j = at + 6;
    while (j < src.length && /\s/.test(src[j])) j += 1;
    if (src[j] !== '{') { out += src.slice(i, at + 6); i = at + 6; continue; }
    const declEnd = matchBrace(src, j);
    if (declEnd < 0) { out += src.slice(i, at + 6); i = at + 6; continue; }
    let k = declEnd;
    while (k < src.length && /\s/.test(src[k])) k += 1;
    if (src[k] !== '{') { out += src.slice(i, declEnd); i = declEnd; continue; }
    const bodyEnd = matchBrace(src, k);
    if (bodyEnd < 0) { out += src.slice(i, declEnd); i = declEnd; continue; }
    if (!INVISIBLE_DECL.test(src.slice(j + 1, declEnd - 1))) {
      out += src.slice(i, declEnd);
      i = declEnd;
      continue;
    }
    let start = at;
    let end = bodyEnd;
    // 外层花括号一起删：{\style{…}{…}} 删完不留空花括号
    if (src[start - 1] === '{' && src[end] === '}') { start -= 1; end += 1; }
    // 顺手吃掉包住这段隐藏内容的 $ / $$ 定界符，否则页面上只剩两个字面美元符
    let l = start;
    while (l > 0 && (src[l - 1] === ' ' || src[l - 1] === '\t')) l -= 1;
    let r = end;
    while (r < src.length && (src[r] === ' ' || src[r] === '\t')) r += 1;
    if (src[l - 1] === '$' && src[r] === '$') {
      start = l - 1;
      end = r + 1;
      if (src[start - 1] === '$' && src[end] === '$') { start -= 1; end += 1; }
    }
    out += src.slice(i, start);
    i = end;
  }
}

/* ------------------- 公式体里夹着单个 $、定界符写错的块级公式 ------------------- */

/**
 * 交互题常把整张表写成块级公式，存量数据有两处坏味道：
 *  ① 公式体内夹着成对的行内 $（1552h：\text{We choose the $(3, 2)$ vertices}），块级
 *     规则不许体内出现 $，这块就配不上，落到行内规则后被切成几段半截公式；
 *  ② 定界符写成单个 $ 却包着跨空行的大段内容（1060h：$\begin{array}…\end{array}$）。
 * 处理：$ / $$ 紧跟 \begin{env} 时先找配对的 \end{env}，若其后就是同种收尾定界符，
 * 就整块当块级公式，并把体内未转义的 $ 删掉（$ 在数学模式里本就非法，删掉正好还原
 * 原文）。单 $ 只在体内含空行（多段表格）时接管，其余形态仍走 reconcileDisplayMarks。
 */
const DISPLAY_BEGIN = /^[ \t]*\\begin\{([a-zA-Z*]+)\}/;

function fixDisplayEnvs(text, stashMath) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('$', i);
    if (open < 0) {
      out += text.slice(i);
      break;
    }
    const delim = text[open + 1] === '$' ? '$$' : '$';
    const head = DISPLAY_BEGIN.exec(text.slice(open + delim.length, open + delim.length + 64));
    if (!head) {
      out += text.slice(i, open + delim.length);
      i = open + delim.length;
      continue;
    }
    const closeTag = '\\end{' + head[1] + '}';
    let from = open + delim.length;
    let body = null;
    let close = -1;
    for (;;) {
      const endAt = text.indexOf(closeTag, from);
      if (endAt < 0) break;
      const after = endAt + closeTag.length;
      const tail = text.slice(after, after + 8);
      if ((delim === '$$' ? /^[ \t]*\$\$/ : /^[ \t]*\$(?!\$)/).test(tail)) {
        body = text.slice(open + delim.length, after);
        close = after;
        break;
      }
      from = after;
    }
    const dirty = body === null || body.indexOf('%AC') >= 0
      || (delim === '$$' ? body.indexOf('$') < 0 : !/\n[ \t]*\n/.test(body));
    if (close < 0 || dirty) {
      out += text.slice(i, open + delim.length);
      i = open + delim.length;
      continue;
    }
    out += text.slice(i, open) + stashMath('md', body.replace(/(^|[^\\])\$/g, '$1'));
    i = close;
  }
  return out;
}

/* ---------------------------- 残缺的 $ 定界符 ---------------------------- */

/**
 * $$…$$ 只在该成块级公式的位置上按块级处理：开在行首（允许缩进）、收在行尾。
 * 存量有两类反例：
 *  - codeforces/1091g「offered $$100\,000$ for factoring RSA-$1024$」：金额前的
 *    反斜杠丢了，$$ 撞上后面单个 $，按块级解析会把后面几句全吞进公式；
 *  - codeforces/1082d「$d_1 = …$$d_2 = …$$d_3 = …$」：相邻行内公式之间的 $$
 *    被块级规则当成一块，导致后面所有配对整体错位。
 * 处理：块边界上的 $$…$$ 保留块级；行内 $$…$$ 降级为行内公式；开口双 $ +
 * 收尾单 $ 也降级为行内公式（只留内层内容）。
 */
/** 收括号：紧跟在它后面的 $$ 是「收尾 + 开口」，不是开括号。 */
const CLOSER = ')]}';

function reconcileDisplayMarks(text, stashMath) {
  // 1) 块边界上的 $$…$$ 才是块级公式（可跨行）
  //    公式体里不许再出现 $$（否则 $$a$$ $$b$$ 会被整段吞成一块）
  let out = text.replace(
    /(^|\n)([ \t]*)[$][$]((?:(?![$][$])[\s\S])+?)[$][$][ \t]*(?=\n|$)/g,
    (m, pre, indent, body) => pre + indent + stashMath('md', body),
  );
  // 2) 行内 $$…$$ → 行内公式。两侧不能紧贴单词/美元符号：1082d 的
  //    $d_1 = …$$d_2 = …$ 里那些 $$ 是相邻公式的定界符，必须留给行内规则配对。
  //    前置字符是收括号（) ] }）时说明这是「上一段公式的收尾 + 本段的开口」，
  //    不是开括号（2245c 的 ...p_i])$$^{\text{∗}}$）
  //    收尾 $$ 后面紧跟单词时，只有公式体以标点收尾才认（2156a 的
  //    「…m_3.$$Then:」）；否则留给行内规则，避免吃掉相邻公式的定界符。
  out = out.replace(/(^|[^\w$])[$][$]([^\n$]{1,4000}?)[$][$]/g,
    (m, pre, body, offset, whole) => {
      if (pre && CLOSER.indexOf(pre) >= 0) return m;
      const next = whole[offset + m.length] ?? '';
      if (next === '$') return m;
      if (/[\w]/.test(next) && /[\w]$/.test(body)) return m;
      return pre + (body.indexOf('%%AC') >= 0 ? '$' + '$' + body + '$' + '$' : stashMath('mi', body));
    });
  // 3) 开口双 $、收尾单 $（1091g 的「$$100\,000$」）→ 行内公式
  out = out.replace(/(^|[^\w$])[$][$]([^\n$]{1,300}?)[$](?![\w$])/g,
    (m, pre, body) => (pre && CLOSER.indexOf(pre) >= 0
      ? m
      : pre + (body.indexOf('%%AC') >= 0 ? '$' + '$' + body + '$' : stashMath('mi', body))));
  return out;
}

/* ------------------------------ 裸 TeX 抢救 ------------------------------ */

/**
 * 存量大把题面的公式定界符彻底丢了，渲染后用户直接看到 0 \le z \lt M、
 * (1 \le T \le 10^4) 这类 LaTeX 源码（抓取端 MathJax 处理不全，那条线在
 * 抓取侧另修）。这里做保守抢救：把含 TeX 命令的片段包回 $…$。
 *
 * 边界规则（宁可少转，也绝不吞掉正文）：
 *  - 片段里一旦出现 CJK、$、表管 |、占位符、换行、普通英文单词（≥2 个字母
 *    且不是 TeX 命令/参数的一部分）→ 就地断开；
 *  - 必须含至少一条 TeX 命令（反斜杠 + 2 个以上字母），纯数字/纯运算符不转；
 *  - \begin{env} … \end{env} 整体当一个 token；找不到配对的 \end 就不碰它
 *    （矩阵/cases 被切开必定渲染炸）；
 *  - 单个片段 ≤ 240 字符（环境 ≤ 4000），跨行环境包成块级 $$…$$；
 *  - 幂等：包装结果含 $，再跑一遍不会二次包装。
 */
const MAX_BARE_TEX = 240;
const MAX_BARE_ENV = 4000;
const TEX_CMD2 = /\\[a-zA-Z]{2,}/;
const BARE_INNER_PUNCT = new Set(['_', '^', '=', '+', '-', '*', '/', '<', '>', ',', ';', ':', '!', "'", '[', ']', '~', '&']);
const BARE_STOP = new Set(['$', '(', ')', '.', '"', '%', '#', '@']);

/**
 * 从 s[i] === '$' 起跳到这段既有公式之后：$$…$$ 找下一个 $$，$…$ 找下一个 $。
 * 找不到配对就把 $$ / 单 $ 当作一个「断点 token」单独吃掉。
 */
function skipMathSpan(s, i) {
  const fence = s[i + 1] === '$' ? '$$' : '$';
  const at = s.indexOf(fence, i + fence.length);
  if (at >= 0 && at - i <= MAX_BARE_TEX) return at + fence.length;
  return i + fence.length;
}

/** 把文本切成「数学 / 普通单词 / 断点」token（只服务于裸 TeX 抢救）。 */
function bareTokens(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      const begin = /^\\begin\s*\{([a-zA-Z*]+)\}/.exec(s.slice(i));
      if (begin) {
        const env = begin[1].replace(/\*/g, '\\*');
        const tail = s.slice(i + begin[0].length);
        const end = new RegExp('\\\\end\\s*\\{' + env + '\\}').exec(tail);
        if (!end || end.index > MAX_BARE_ENV) {
          // 找不到配对的 \end：这段环境整体不碰（矩阵/cases 切开必定渲染炸），
          // 连它内部的行也不能单独包，所以一路跳到下一个 \end{…} 之后
          const from = i + begin[0].length;
          const anyEnd = /\\end\s*\{[a-zA-Z*]+\}/.exec(s.slice(from));
          const skipTo = anyEnd ? from + anyEnd.index + anyEnd[0].length : s.length;
          toks.push({ t: 'stop', s: i, e: skipTo });
          i = skipTo;
          continue;
        }
        const stop = i + begin[0].length + end.index + end[0].length;
        toks.push({ t: 'math', s: i, e: stop, cmd: true });
        i = stop;
        continue;
      }
      let j = i + 1;
      if (/[a-zA-Z]/.test(s[j] ?? '')) {
        while (j < s.length && /[a-zA-Z]/.test(s[j])) j += 1;
        // \left( \right) \big[ 这类「定界符命令」把后面的括号一起吃进来，
        // 否则片段会切在 \left 上，KaTeX 直接报错
        if (DELIM_SIZE_CMD.test(s.slice(i, j)) && '([{|/)].'.indexOf(s[j] ?? '') >= 0) j += 1;
      } else {
        j = Math.min(i + 2, s.length);
      }
      // 紧跟的可选参数（\xrightarrow[下]{上}）：方括号配平才粘
      if (s[j] === '[') {
        const close = matchBracket(s, j);
        if (close > 0 && close - j <= 200) j = close;
      }
      // 紧跟的花括号参数（\frac{a}{b}、\text{x}）：最多粘两个
      for (let n = 0; n < 2 && s[j] === '{'; n += 1) {
        const close = matchBrace(s, j);
        if (close < 0) break;
        j = close;
      }
      toks.push({ t: 'math', s: i, e: j, cmd: TEX_CMD2.test(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (ch === '{') {
      const close = matchBrace(s, i);
      if (close < 0) { toks.push({ t: 'stop', s: i, e: i + 1 }); i += 1; continue; }
      toks.push({ t: 'group', s: i, e: close, cmd: TEX_CMD2.test(s.slice(i + 1, close - 1)) });
      i = close;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j += 1;
      toks.push({ t: 'num', s: i, e: j });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z]/.test(s[j])) j += 1;
      toks.push({ t: j - i === 1 ? 'var' : 'word', s: i, e: j });
      i = j;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { toks.push({ t: 'sp', s: i, e: i + 1 }); i += 1; continue; }
    if (ch === '$') {
      // 已有公式整体跳过（幂等的前提）：单个 $ 跳到配对的 $，$$ 跳到配对的 $$
      const span = skipMathSpan(s, i);
      toks.push({ t: 'stop', s: i, e: span });
      i = span;
      continue;
    }
    // 竖线只有在「表格形态」（后面跟空白或行末）才断开：\begin{array}{|c|c|} 与 |x| 里的
    // 竖线必须留在片段里，否则矩阵和绝对值会被切碎
    if (ch === '|' && (s[i + 1] === undefined || s[i + 1] === ' ' || s[i + 1] === '\t' || s[i + 1] === '\n')) {
      toks.push({ t: 'stop', s: i, e: i + 1 });
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\u0060' || CJK.test(ch) || BARE_STOP.has(ch)) {
      toks.push({ t: 'stop', s: i, e: i + 1 });
      i += 1;
      continue;
    }
    toks.push({ t: BARE_INNER_PUNCT.has(ch) ? 'punct' : 'stop', s: i, e: i + 1 });
    i += 1;
  }
  return toks;
}

const TEXT_MODE_CMD = /\\(?:text|textrm|textnormal|texttt|textsf|mbox|hbox|mathrm|mathbf|mathit|operatorname|mathbb|mathcal)\s*\{/;
const DELIM_SIZE_CMD = /^\\(?:left|right|middle|bigl|bigr|Bigl|Bigr|biggl|biggr|bigg|Bigg|big|Big)$/;
/** 缺参数就会让 KaTeX 报错的命令：片段末尾如果是它们，必须砍掉。 */
const TEX_NEEDS_ARG = /\\(?:left|right|middle|bigl|bigr|Bigl|Bigr|biggl|biggr|bigg|Bigg|big|Big|frac|dfrac|tfrac|sqrt|overline|underline|vec|hat|bar|tilde|text|textrm|mathrm|mathbf|mathit|mathtt|operatorname|pmod|bmod|mathbin|mathrel|stackrel|overset|underset|begin)\s*$/;
const DELIM_CMD = /\\(?:left|right|middle|bigl|bigr|Bigl|Bigr|biggl|biggr|big|Big|bigg|Bigg)(?![a-zA-Z])/;

/**
 * 裸 TeX 里的 \{ \} \_ 是「字面量转义」，还原成花括号/下划线再送 KaTeX。
 * 两类例外保持原样：① 文本模式命令（\text{…}）内部，下划线会被当成数学下标；
 * ② \left\{ / \right\} 这类定界符命令，还原后 \left{ 是非法 TeX。
 * 还原会让花括号失衡时也保持原样。
 */
function restoreTexEscapes(tex) {
  if (TEXT_MODE_CMD.test(tex) || DELIM_CMD.test(tex)) return tex;
  const restored = tex.replace(/\\_/g, '_').replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  let depth = 0;
  for (let i = 0; i < restored.length; i += 1) {
    const ch = restored[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth < 0) return tex; }
  }
  return depth === 0 ? restored : tex;
}

/**
 * 把片段两端修剪到「能独立成立」的范围：末尾缺参数的命令（\\left / \\frac / \\begin…）、
 * 悬空的下标符号、开头只在下标/收组位置出现的 _ ^{ } 都砍掉；砍完没内容就放弃。
 */
function trimBareRange(src, start, end) {
  let a = start;
  let b = end;
  for (;;) {
    const frag = src.slice(a, b);
    if (!frag) return null;
    const missArg = TEX_NEEDS_ARG.exec(frag);
    if (missArg) {
      if (missArg.index === 0) return null;
      b = a + missArg.index;
      continue;
    }
    if (/[_^\\]$/.test(frag)) { b -= 1; continue; }
    if (/^[_^\]}]/.test(frag)) { a += 1; continue; }
    break;
  }
  return b > a ? { start: a, end: b } : null;
}

/**
 * 裸 TeX 抢救主函数（纯函数，便于单测）：把裸 TeX 片段包成 $…$。
 * stash(type, tex) 可注入（renderRich 注入惰性 token 收集器），
 * 默认直接拼 $…$ / $$…$$ 字面量。
 */
export function wrapBareTex(text, stash) {
  const src = String(text ?? '');
  const put = stash ?? ((type, tex) => (type === 'md' ? '$$' + tex + '$$' : '$' + tex + '$'));
  const toks = bareTokens(src);
  let out = '';
  let done = 0;
  let open = -1;
  let end = -1;
  let cmd = false;
  const reset = () => { open = -1; end = -1; cmd = false; };
  const flush = () => {
    const span = end - open;
    const env = open >= 0 && src.indexOf('\\begin', open) >= 0 && src.indexOf('\\begin', open) < end;
    if (open >= 0 && cmd && end > open && span <= (env ? MAX_BARE_ENV : MAX_BARE_TEX)) {
      let range = trimBareRange(src, open, end);
      // 片段里不能带占位符（{%%ACcode0%%, ...} 这类花括号组会把占位符吃进来，
      // 替换后在 zs-math 里插出 <pre>），截到占位符之前
      const ph = range ? src.slice(range.start, range.end).indexOf('%%AC') : -1;
      if (range && ph >= 0) range = trimBareRange(src, range.start, range.start + ph);
      if (range) {
        const frag = src.slice(range.start, range.end);
        // 含 & 却没有 \begin{ 的是表格被拍平后的残渣（1060h/1776i/1552h），
        // 包成行内公式只会换来 KaTeX 红框，保持原样交给数据侧重抓
        const tableResidue = frag.indexOf('&') >= 0 && frag.indexOf('\\begin') < 0;
        if (TEX_CMD2.test(frag) && !tableResidue) {
          out += src.slice(done, range.start) + put(frag.indexOf('\\begin') >= 0 ? 'md' : 'mi', restoreTexEscapes(frag));
          done = range.end;
        }
      }
    }
    reset();
  };
  for (const tok of toks) {
    if (tok.t === 'sp' || tok.t === 'punct') continue; // 片段内的空格/符号：不断开、也不算有效内容
    if (tok.t === 'stop' || tok.t === 'word') { flush(); continue; }
    if (open < 0) open = tok.s;
    end = tok.e;
    if (tok.cmd) cmd = true;
    if (end - open > MAX_BARE_TEX) reset();
  }
  flush();
  return out + src.slice(done);
}

/* --------------------------- 裸下标/上标抢救 --------------------------- */

/**
 * 存量题面里公式定界符整段丢了、又没有 TeX 命令的另一种形态：裸下标/上标
 * （「among the first p_i people」「two integers (a_i, b_i)」）。宽松行内与裸 TeX
 * 抢救都命中不了（前者要 $、后者要 \命令），用户看到的就是下划线原文。
 * 这里把「变量名 + _/^ + 短索引」包回 $…$：索引只允许字母数字与 { } , + -，
 * 不含 / . \ 空白（文件名、路径、URL、宏名因此天然放过），整段 ≤ 24 字符，幂等。
 */

/** 裸下标片段允许的字符（刻意不含 / . \ 与空白）。 */
const SUB_BODY_CHARS = /^[A-Za-z0-9_^{},+\-]+$/;
/** 花括号索引内部允许的字符。 */
const SUB_INDEX_CHARS = /^[A-Za-z0-9,+\-{}]$/;

/** URL / 图片 / 链接目标 / 原始 HTML 标签 —— 这些区间里绝不切下标。 */
function dangerousRanges(src) {
  const ranges = [];
  const patterns = [
    /https?:\/\/[^\s<>()[\]'"]+/g,
    /www\.[^\s<>()[\]'"]+/g,
    /\]\([^)\n]{1,300}\)/g,
    /<\/?[A-Za-z][^>\n]{0,300}>/g,
    /!\[[^\]\n]{0,120}\]/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m = re.exec(src);
    while (m) {
      ranges.push([m.index, m.index + m[0].length]);
      m = re.exec(src);
    }
  }
  return ranges;
}

function inDanger(ranges, i) {
  for (const [s, e] of ranges) if (i >= s && i < e) return true;
  return false;
}

/** 从 start 起读「变量名 + 一个到多个 _/^ 短索引」这一段；不合形状返回 null。 */
function scanSubscriptSegment(src, start) {
  let j = start;
  while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j += 1;
  const base = src.slice(start, j);
  if (!base) return null;
  let scripts = 0;
  while (j < src.length && (src[j] === '_' || src[j] === '^')) {
    let k = j + 1;
    if (src[k] === '{') {
      let depth = 0;
      let m = k;
      let closed = false;
      for (; m < src.length; m += 1) {
        const c = src[m];
        if (c === '{') {
          depth += 1;
          if (depth > 2) return null;
        } else if (c === '}') {
          depth -= 1;
          if (depth === 0) {
            m += 1;
            closed = true;
            break;
          }
        } else if (!SUB_INDEX_CHARS.test(c)) {
          return null;
        }
      }
      if (!closed || m - k > 18) return null;
      j = m;
    } else {
      let run = 0;
      while (k + run < src.length && /[A-Za-z0-9]/.test(src[k + run])) run += 1;
      // 0 字符 = 不是下标；> 2 字符说明是 snake_case 标识符，不是公式
      if (run === 0 || run > 2) return null;
      j = k + run;
    }
    scripts += 1;
  }
  return { base, end: j, scripts };
}

/**
 * 裸下标/上标整段：允许连写（t_{1}t_{2}、x_i y 的前半段），但不超过 24 字符。
 * 至少要有一次 _/^，纯单词一律不碰。
 */
function scanSubscript(src, start) {
  const first = scanSubscriptSegment(src, start);
  if (!first || !first.scripts) return null;
  let j = first.end;
  for (;;) {
    if (j >= src.length || !/[A-Za-z0-9]/.test(src[j])) break;
    const more = scanSubscriptSegment(src, j);
    if (!more || !more.scripts || more.end - start > 24) break;
    j = more.end;
  }
  const tex = src.slice(start, j);
  if (tex.length > 24 || !SUB_BODY_CHARS.test(tex)) return null;
  // 纯数字底数只认上标（10^9 / 10^{9}）；10_9 更可能是范围或编号
  if (/^[0-9]+$/.test(first.base) && src[start + first.base.length] === '_') return null;
  return { end: j, tex };
}

/** 把裸下标/上标包成行内公式（纯函数；占位符里没有 _ ^，天然不受影响，幂等）。 */
export function wrapBareSubscript(text, stash) {
  const src = String(text ?? '');
  const put = stash ?? ((type, tex) => '$' + tex + '$');
  const danger = dangerousRanges(src);
  let out = '';
  let done = 0;
  let i = 0;
  while (i < src.length) {
    if (!/[A-Za-z0-9]/.test(src[i])) {
      i += 1;
      continue;
    }
    const prev = src[i - 1];
    // 前面紧贴字母数字/下划线/花括号/反斜杠/星号 → 不是独立变量（宏名、强调、标识符）
    if (prev !== undefined && /[A-Za-z0-9_^{}\\*/.$]/.test(prev)) {
      i += 1;
      continue;
    }
    if (inDanger(danger, i)) {
      i += 1;
      continue;
    }
    const hit = scanSubscript(src, i);
    if (!hit) {
      i += 1;
      continue;
    }
    const after = src.slice(hit.end, hit.end + 8);
    // 文件名（a_1.txt）、路径（dir/a_1）、宏名（\\a_1）、长标识符（a_1bc）都放过
    if (/^\.[A-Za-z0-9]/.test(after) || /^[A-Za-z0-9_\\]/.test(after) || after[0] === '$') {
      i += 1;
      continue;
    }
    out += src.slice(done, i) + put('mi', hit.tex);
    done = hit.end;
    i = hit.end;
  }
  return out + src.slice(done);
}
/* --------------------------- 字形重复折叠 --------------------------- */

/**
 * 中文译文常把数学斜体字形与其 ASCII 转写并排放着（「共有 𝑥x 只羊」、
 * 「3≤𝑛≤503≤n≤50」），来源是英文原文里 U+1D400 区的数学字母在翻译时没被识别。
 * 数据侧只重抓英文、中文译文不重译，所以在渲染层做确定性折叠：把「含数学字形的
 * 片段 + 紧随其后、去掉字形后完全相同的 ASCII 片段」折成一份（保留 ASCII）。
 * 判定要求片段里真的含 U+1D400 区字形，纯数字（2020 年）永远不动，且幂等。
 */
const MATH_GLYPH = /[\u{1D400}-\u{1D6A3}\u{1D7CE}-\u{1D7FF}]/u;
const MATH_GLYPH_G = /[\u{1D400}-\u{1D6A3}\u{1D7CE}-\u{1D7FF}]/gu;
const FOLD_MAX_BLOCK = 80;

function glyphToAscii(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x1d7ce && cp <= 0x1d7ff) return String.fromCharCode(48 + ((cp - 0x1d7ce) % 10));
  if (cp >= 0x1d400 && cp <= 0x1d6a3) {
    const off = (cp - 0x1d400) % 52;
    return String.fromCharCode(off < 26 ? 65 + off : 97 + off - 26);
  }
  return ch;
}

const glyphAscii = (str) => Array.from(str).map(glyphToAscii).join('');

/**
 * 折叠「数学字形串 + ASCII 转写」的重复。返回新字符串（不改原串，幂等）。
 */
export function foldMathGlyphDuplication(text) {
  const src = String(text ?? '');
  MATH_GLYPH_G.lastIndex = 0;
  if (!MATH_GLYPH_G.test(src)) return src;
  const chars = Array.from(src);
  let out = '';
  let i = 0;
  while (i < chars.length) {
    // 只有「后面 FOLD_MAX_BLOCK 个字符里出现数学字形」的位置才值得尝试折叠：
    // 重复块的开头可能是数字/运算符（3≤𝑛≤503≤n≤50），不能只从字形位置起步
    let near = -1;
    for (let k = i; k < chars.length && k < i + FOLD_MAX_BLOCK; k += 1) {
      if (MATH_GLYPH.test(chars[k])) { near = k; break; }
    }
    if (near < 0) {
      out += chars[i];
      i += 1;
      continue;
    }
    const maxL = Math.min(FOLD_MAX_BLOCK, Math.floor((chars.length - i) / 2));
    let folded = 0;
    for (let L = maxL; L >= 1; L -= 1) {
      const left = chars.slice(i, i + L).join('');
      if (!MATH_GLYPH.test(left)) continue;
      const right = chars.slice(i + L, i + 2 * L).join('');
      if (glyphAscii(left) !== glyphAscii(right)) continue;
      out += glyphAscii(left);
      i += 2 * L;
      folded = L;
      break;
    }
    if (!folded) {
      out += chars[i];
      i += 1;
    }
  }
  return out;
}

/* --------------------------- 孤 $ 收尾 --------------------------- */

/**
 * 配对结束后还剩下的单个 $ 是数据缺陷（抓取时丢了收尾符，见 115d 的
 * "$(X) + (Y)"、"$(X) - (Y)"）。中文/日文语境里直接去掉美元号只留正文，
 * 英文语境与 $5 / $10 这类金额保持原样（宁可留一个 $，也不能吃掉金额）。
 */
export function dropOrphanDollars(text) {
  const src = String(text ?? '');
  if (src.indexOf('$') < 0) return src;
  return src.replace(/\$/g, (m, off, whole) => {
    const next = whole[off + 1] ?? '';
    if (/[0-9]/.test(next)) return m;                 // 金额：$5、$10
    const lineStart = whole.lastIndexOf('\n', off) + 1;
    const lineEnd = whole.indexOf('\n', off);
    const line = whole.slice(lineStart, lineEnd < 0 ? whole.length : lineEnd);
    return CJK.test(line) ? '' : m;                   // 中日文语境：去掉残标
  });
}

/* ---------------------------- 行内公式配对 ---------------------------- */

/**
 * 行内公式的两档判定与配对：
 *  ① 严格形态（历史行为）：定界符内侧紧邻非空白，例如 $n$、$a_i \le 10^9$；
 *  ② 宽松形态：容忍内侧空白，例如 $ 1 \le n \le 10^5$、$N (1 \leq N \leq 10^5) $、
 *     $\n\{3,4\}$（开括号后直接换行）、$s = $（公式以等号结尾）。
 * 宽松形态是存量脏数据的主要来源（400+ 题面），但风险是吞掉金额与整句，
 * 所以叠了守卫：CJK、纯金额尾、金额区间、占位符、跨段落、跨句、长度。
 *
 * 配对必须手写扫描而不是正则替换：正则里某个开口 $ 判失败时，引擎会把已经
 * 消费掉的收尾 $ 一起丢掉，导致后面所有配对整体错位（1017e 的 $\theta$
 * 之所以残留，就是这么错位的）。这里判失败只前进一个 $，让后一个 $ 重新当
 * 开括号。
 */
/**
 * 「这段是公式」的信号：TeX 命令、\ 转义空格、上下标、运算符，以及 Unicode /
 * 全角数学符号（AtCoder 中文题面常见 $N\ (1 ≦ N ≦ 100)$、$S＜T$ 这种没有
 * 反斜杠命令的写法）。
 */
const LOOSE_MATH_SIGNAL = /\\[a-zA-Z]+|\\\s|[_^=<>+*/|~-]|\d\s*[-–+]\s*\d|[≦≧≤≥＜＞＝≠≈≡±∓×÷·⋅√∑∏∞∈∉⊂⊆⊃⊇∪∩→←↔⇒⇔−]/;
/** 纯数字 + 结尾运算符：金额区间（$5-$10 / $10+）而不是公式。 */
const MONEY_TAIL = /^\d[\d\s.,]*[-–—+*/]$/;
const LOOSE_MAX = 1000;
/** 严格形态（内侧无空白）允许更长：1669d/1748f 的长公式有 500+ 字符。 */
const TIGHT_STRICT_MAX = 2000;
const TIGHT_MAX = 2000;

function isMathBody(raw, whole, open, close) {
  const body = raw.trim();
  if (!body || body.length > TIGHT_MAX) return false;
  if (whole[open - 1] === '\\') return false;              // markdown 转义的 \$（金额）
  if (body.indexOf('%%AC') >= 0) return false;             // 不吞代码/公式占位符
  if (CJK_TEXT.test(body) && !/\\[a-zA-Z]/.test(body)) return false;
  // 金额：$5-$10 / $10+ / $5,000$ 这类「内容就是数字」，后面还紧跟数字
  const numeric = /^[\d\s.,]+[-–—+*/]?$/.test(body);
  if (numeric && /[\d$]/.test(whole[close + 1] ?? '')) return false;
  if (MONEY_TAIL.test(body)) return false;
  // 不跨句：必须是「小写字母 + 句号 + 空格 + 首字母大写的单词」，$[L.. R]$ 这类
  // 带方括号的公式不会被误判
  if (/[a-z][.!?]\s+[A-Z][a-z]{2,}/.test(raw)) return false;
  // 严格形态：单行、内侧无空白 → 沿用历史行为（内容不做数学信号要求）
  if (raw.indexOf('\n') < 0 && !/^\s/.test(raw) && !/\s$/.test(raw)) {
    return body.length <= TIGHT_STRICT_MAX;
  }
  // 宽松形态：必须有数学信号、不跨段落、长度受限
  if (body.length > LOOSE_MAX) return false;
  if (/\n[ \t]*\n/.test(raw)) return false;
  return LOOSE_MATH_SIGNAL.test(body);
}

/**
 * 找下一个 $ 定界符。刻意不跳过 $$ 残标：1082d 的「$d_1 = …$$d_2 = …$」里，
 * 每对相邻公式之间的 $$ 其实是一个收尾 + 一个开口，按单个 $ 顺序配对才对；
 * 真正的块级/行内 $$…$$ 已经在 reconcileDisplayMarks 里抽成 token 了。
 */
function nextDollar(text, from) {
  return text.indexOf('$', from);
}

/**
 * 「成对的 $ 里包着的是中文/日文正文」，不是公式：数据抓取时把日文说明塞进了
 * 公式定界符（atcoder abc030_d 的 $1 ≦ b_i ≦ N かつ b_i ≠ i (1 ≦ i ≦ N)$）。
 * 这类成对定界符直接去掉只留正文 —— 既不会渲染出 KaTeX 错误框，也不会露出 $。
 * 金额（$5 元 / $10）不算。
 */
function isCjkProsePair(raw, whole, open, close) {
  const body = raw.trim();
  if (!body || body.length > LOOSE_MAX) return false;
  if (!CJK_TEXT.test(body)) return false;
  if (/\\[a-zA-Z]/.test(body)) return false;
  if (/^[\d\s.,]*\d\s*(元|円|块|美元|刀)?$/.test(body)) return false;
  return true;
}

function pairInlineMath(text, stashMath) {
  let out = '';
  let done = 0;
  let search = 0;
  for (;;) {
    const open = nextDollar(text, search);
    if (open < 0) break;
    const close = nextDollar(text, open + 1);
    if (close < 0) break;
    const raw = text.slice(open + 1, close);
    if (!isMathBody(raw, text, open, close)) {
      // 成对的 $ 里是中文/日文正文，或者内容里已经夹了代码/公式占位符
      // （外层 $ 配不上对的坏数据）→ 去掉定界符，只留正文，别把 $ 露出来
      if (isCjkProsePair(raw, text, open, close) || raw.indexOf('%%AC') >= 0) {
        out += text.slice(done, open) + raw;
        done = close + 1;
        search = close + 1;
        continue;
      }
      search = open + 1;
      continue;
    }
    out += text.slice(done, open) + stashMath('mi', raw.trim());
    done = close + 1;
    search = close + 1;
  }
  return out + text.slice(done);
}

/**
 * 公式内容的 KaTeX 兼容修正（数据来源五花八门，这两类会直接让 KaTeX 报错框）：
 *  - \\lt / \\gt：MathJax 认识的别名，KaTeX 没有，换成 < / >；
 *  - 文本模式命令（\\texttt 等）里的裸 ^ / _：LaTeX 里必须写成 \\^{} / \\_{}，
 *    但 CF 交互表常直接写 \\texttt{^ 3 3}（1776i、1060h 的表格），MathJax 能过、KaTeX 不能。
 */
function normalizeTexText(src) {
  return src
    // 输出裸 < >：mathToken 会用 escapeHtml 转义，这里再写实体就会变成 &amp;lt;
    .replace(/\\lt(?![a-zA-Z])/g, '<')
    .replace(/\\gt(?![a-zA-Z])/g, '>')
    .replace(/\\(text[a-zA-Z]*)\{([^{}]*)\}/g, (m, cmd, body) =>
      '\\' + cmd + '{' + body.replace(/\^/g, '\\^{}').replace(/(^|[^\\])_/g, '$1\\_{}') + '}');
}

/** 渲染含公式的 Markdown（数据管道已把 CF 的 $$$…$$$ / AtCoder 的 \(…\)
 * 统一归一为 $…$ 行内与 $$…$$ 块级公式）。代码块/行内代码不参与公式提取。
 */
export function renderRich(md, { translation = false } = {}) {
  if (!md) return '';
  const stash = [];
  const keep = (type, content) => {
    stash.push({ type, content });
    return `%%AC${type}${stash.length - 1}%%`;
  };
  // 抽公式统一口径：实体解码 → 换行标签清理 → 双重反斜杠还原 → tab 归一 → 首尾空白裁剪
  // （须在切代码前定义）。清理 <br> 是给存量牛客题面兜底：数组公式里有 <br /> 残渣
  // （sanitizeText 转义成 &lt;br /&gt; 后又被 decodeMathEntities 还原），送进 KaTeX 会直接报错。
  // 只删换行标签，不动作为比较符的 < >。
  const stashMath = (type, tex) => keep(
    type,
    fixDoubleEscape(
      normalizeTexText(
        decodeMathEntities(String(tex).replace(/\t/g, ' '))
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<\/?br\b[^>]*>/gi, ' ')
          .trim(),
      ),
    ),
  );
  // 围栏代码块原样保留（要能复制）；行内代码里的成对公式切出来走 zs-math
  let text = sanitizeText(md).replace(/```[^\n]*\n[\s\S]*?```|`[^`\n]+`/g, (m) => {
    if (m.startsWith('```')) return keep('code', m);
    if (containsTexText(m)) return m;
    const parts = splitCodeMath(m.slice(1, -1));
    if (!parts) return keep('code', m);
    return parts
      .map((p) => (p.math !== undefined ? stashMath('mi', p.math) : p.code ? keep('code', '\u0060' + p.code + '\u0060') : ''))
      .join('');
  });
  // 中文译文里的「𝑥x」字形重复先折叠（不影响代码/公式：占位符里没有 U+1D400 区字形）
  text = foldMathGlyphDuplication(text);
  text = normalizeMathMarks(text);
  // 不可见提示（CF 愚人节的 \style{opacity:0…}）先删，免得被当成正文/公式渲染
  text = stripHiddenTex(text);
  // 兼容 Codeforces 源码级数学标记（$$$$$$ 块级 / $$$ 行内），先长后短
  text = text.replace(/\$\$\$\$\$\$([\s\S]+?)\$\$\$\$\$\$/g, (_, t) => stashMath('md', t));
  text = text.replace(/\$\$\$([\s\S]+?)\$\$\$/g, (_, t) => stashMath('mi', t));
  // 配不成对的 $$$$$$ / $$$ 残标（1776a、2071c 等）无法判定边界，直接丢弃：
  // 留着会被后面的 $$ 规则截成半个公式，KaTeX 报错框比丢标记更难解释
  text = text.replace(/[$]{3,}/g, '');
  // 公式体里夹着单个 $、或定界符写成单 $ 的表格公式（1552h / 1060h）先整块救出来
  text = fixDisplayEnvs(text, stashMath);
  // $$…$$ 只认块边界上的形态，行内的降级为行内公式（1091g 的金额、1082d 的相邻公式）
  text = reconcileDisplayMarks(text, stashMath);
  // 行内 $…$ 配对：严格形态与宽松形态共用一次扫描（守卫与错位处理见 pairInlineMath）
  text = pairInlineMath(text, stashMath);
  // 最后一遍：裸 TeX 抢救（定界符彻底丢失的公式片段包回 $…$，边界见 wrapBareTex）。
  // 必须在行内配对之后 —— 否则会把「$ 1 \le n$」里的内容先抢走，留下孤立的 $。
  text = wrapBareTex(text, (type, tex) => stashMath(type, tex));
  // 所有能配对的公式都已抽走，剩下成串的 $ 只可能是残标（106795d 段末的 $$）
  text = text.replace(/[$]{2,}/g, '');
  // 单个孤 $ 同样是数据缺陷；中日文语境去掉，英文金额保持原样
  text = dropOrphanDollars(text);
  // 裸下标/上标抢救（p_i、t_{k}、c_{i,j}、10^9）：定界符与 TeX 命令都丢了的数据
  text = wrapBareSubscript(text, (type, tex) => stashMath(type, tex));
  // 孤立 $ 贴着公式占位符（$ ∎ 这种）同样是残标：中间只隔着空白也算
  text = text.replace(/[$][ \t]*(%%ACm[id]\d+%%)/g, '$1').replace(/(%%ACm[id]\d+%%)[$]/g, '$1');
  let html = marked.parse(text);
  html = html.replace(/%%ACcode(\d+)%%/g, (_, i) => renderCodeBlock(stash[i].content));
  html = html.replace(/%%ACmi(\d+)%%/g, (_, i) => mathToken(stash[i].content, false));
  html = html.replace(/%%ACmd(\d+)%%/g, (_, i) => mathToken(stash[i].content, true));
  // 牛客图床（uploadfiles.nowcoder.com）对站外 Referer 返回 403，
  // 站内渲染的 <img> 一律不带 Referer（实测无 Referer 可正常返回图片）。
  html = html.replace(/<img\b/g, '<img referrerpolicy="no-referrer"');
  return sanitizeRichHtml(html, { translation });
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

const NON_PROSE_TAGS = new Set(['pre', 'code', 'img', 'svg']);

function markTranslationProse(parent) {
  for (const [index, child] of (parent.childNodes ?? []).entries()) {
    if (child.nodeName === '#text' && child.value.trim()) {
      const span = defaultTreeAdapter.createElement('span', 'http://www.w3.org/1999/xhtml', [{ name: 'data-zh-prose', value: '' }]);
      child.parentNode = span;
      parent.childNodes[index] = span;
      span.parentNode = parent;
      span.childNodes.push(child);
    } else if (!NON_PROSE_TAGS.has(child.tagName)) {
      markTranslationProse(child);
    }
  }
}

export function sanitizeRichHtml(html, { translation = false } = {}) {
  const fragment = parseFragment(String(html));
  sanitizeTree(fragment);
  if (translation) markTranslationProse(fragment);
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
