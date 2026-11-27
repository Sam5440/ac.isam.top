/**
 * 编辑器「结构」大纲解析（纯函数，node 可测）。
 *
 * 参考 VS Code 的 Outline：把当前文件里的符号按层级列出来，点击跳转。
 * 只做正则级解析，不追求编译级精度——目标是把「函数 / 变量 / 结构体 /
 * 类 / 命名空间 / Markdown 标题」这些一眼能认出来的东西列全，误报可接受，
 * 漏报才是问题。
 *
 * 返回 [{ name, kind, line, col, depth, detail? }]，kind ∈
 *   function | method | class | struct | enum | namespace | variable | constant |
 *   macro | typedef | heading | label
 */

export const OUTLINE_KINDS = {
  function: "函数",
  method: "方法",
  class: "类",
  struct: "结构体",
  enum: "枚举",
  namespace: "命名空间",
  variable: "变量",
  constant: "常量",
  macro: "宏",
  typedef: "类型",
  heading: "标题",
  label: "标签",
};

const CPP_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "sizeof", "do", "else",
  "case", "default", "new", "delete", "throw", "decltype", "alignof", "static_assert",
  "requires", "co_await", "co_return", "co_yield", "operator",
]);

function lineStarts(text) {
  const out = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") out.push(i + 1);
  return out;
}

function lineOf(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function colOf(starts, index) {
  const line = lineOf(starts, index);
  return index - starts[line - 1] + 1;
}

/** 去掉注释与字符串字面量（保留换行，位置不变），避免把注释里的文字当符号。 */
export function stripComments(text) {
  const s = String(text ?? "");
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    const d = s[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && s[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(s[i] === "*" && s[i + 1] === "/")) {
        out += s[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += " ";
      i += 1;
      while (i < n && s[i] !== quote) {
        if (s[i] === "\\") {
          out += " ";
          i += 1;
        }
        if (i < n) {
          out += s[i] === "\n" ? "\n" : " ";
          i += 1;
        }
      }
      out += " ";
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * 每个下标处的花括号深度（0 = 文件顶层）。
 * stripComments 之后字符串已被抹成空格，所以 `{`/`}` 只剩真实语法。
 */
function braceDepths(text) {
  const depths = new Int32Array(text.length + 1);
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "}") depth = Math.max(0, depth - 1);
    depths[i] = depth;
    if (text[i] === "{") depth += 1;
  }
  depths[text.length] = depth;
  return depths;
}

/** 从 `{` 的位置找配对的 `}`；找不到时返回文本末尾。 */
function matchBrace(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/** C/C++ 大纲。 */
export function outlineCpp(source) {
  const text = stripComments(source);
  const starts = lineStarts(text);
  const depths = braceDepths(text);
  const out = [];
  /** 容器（class/struct/namespace）范围，用来把内部函数标成方法并加深度。 */
  const containers = [];
  const push = (name, kind, index, depth, detail) => {
    if (!name) return;
    out.push({ name, kind, line: lineOf(starts, index), col: colOf(starts, index), depth, ...(detail ? { detail } : {}) });
  };
  const containerAt = (index) => {
    let best = null;
    for (const c of containers) {
      if (index > c.open && index < c.close && (!best || c.open > best.open)) best = c;
    }
    return best;
  };

  // #define
  for (const m of text.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)/gm)) {
    push(m[1], "macro", m.index + m[0].length - m[1].length, 0);
  }
  // typedef ... Name;
  for (const m of text.matchAll(/\btypedef\b[^;{}]*?\b([A-Za-z_]\w*)[ \t]*;/g)) {
    push(m[1], "typedef", m.index + m[0].lastIndexOf(m[1]), 0);
  }
  // using Name = ...（排除 using namespace）
  for (const m of text.matchAll(/\busing[ \t]+([A-Za-z_]\w*)[ \t]*=/g)) {
    push(m[1], "typedef", m.index, 0);
  }
  // namespace X { / namespace {（匿名用 (anonymous)）
  for (const m of text.matchAll(/\bnamespace[ \t]+([A-Za-z_]\w*)?[ \t]*\{/g)) {
    const open = m.index + m[0].lastIndexOf("{");
    containers.push({ open, close: matchBrace(text, open), kind: "namespace" });
    push(m[1] || "(anonymous)", "namespace", m.index, depths[m.index]);
  }
  // struct / class / union / enum（含 enum class）
  for (const m of text.matchAll(/\b(struct|class|union|enum(?:[ \t]+class)?)[ \t]+([A-Za-z_]\w*)[^;{]*\{/g)) {
    const raw = m[1];
    const kind = raw.startsWith("enum") ? "enum" : raw === "class" ? "class" : "struct";
    const open = m.index + m[0].lastIndexOf("{");
    containers.push({ open, close: matchBrace(text, open), kind });
    push(m[2], kind, m.index, depths[m.index]);
  }
  // 函数定义：<返回类型> name(args) { ... }。允许前面是 ; } 或行首。
  const fnRe =
    /(?:^|[;}])\s*(?:template\s*<[^>]*>\s*)?((?:[A-Za-z_]\w*(?:::\w+)*(?:\s*[*&])?\s+)+)([A-Za-z_]\w*(?:::\w+)*)\s*\(([^;{}()]*)\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?(?:->[^;{]+)?\s*\{/gm;
  for (const m of text.matchAll(fnRe)) {
    const name = m[2];
    const short = name.split("::").pop();
    if (!name || CPP_KEYWORDS.has(short)) continue;
    if (!/[A-Za-z_]/.test(m[1])) continue;
    const index = m.index + m[0].lastIndexOf(name);
    const holder = containerAt(index);
    const isMember = holder && (holder.kind === "class" || holder.kind === "struct");
    push(
      name,
      isMember || name.includes("::") ? "method" : "function",
      index,
      depths[index],
    );
  }
  // 顶层变量 / 常量（行首、无括号；支持 `int n, m;`）
  const varRe =
    /^[ \t]*(?:(?:static|const|constexpr|extern|inline)\s+)*([A-Za-z_][\w:<>,\s*&]*?)\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?:=[^;\n]*)?;/gm;
  for (const m of text.matchAll(varRe)) {
    const type = m[1].trim();
    if (!type || /^(return|using|typedef|friend|public|private|protected|namespace)$/.test(type)) continue;
    if (/\busing\s+namespace\b/.test(m[0])) continue;
    const constant = /\b(const|constexpr)\b/.test(m[0]);
    const namesAt = m.index + m[0].indexOf(m[2]);
    let offset = namesAt;
    for (const raw of m[2].split(",")) {
      const name = raw.trim();
      if (name && !CPP_KEYWORDS.has(name)) {
        push(name, constant ? "constant" : "variable", offset + raw.indexOf(name), depths[offset]);
      }
      offset += raw.length + 1;
    }
  }
  return dedupe(out);
}

/** Python 大纲。 */
export function outlinePython(source) {
  const lines = String(source ?? "").split("\n");
  const out = [];
  const stack = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = /^(\s*)(?:async[ \t]+)?(def|class)[ \t]+([A-Za-z_]\w*)/.exec(line);
    if (m) {
      const indent = m[1].replace(/\t/g, "    ").length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const depth = stack.length;
      const kind = m[2] === "class" ? "class" : depth ? "method" : "function";
      out.push({ name: m[3], kind, line: i + 1, col: indent + 1, depth });
      stack.push({ indent });
      continue;
    }
    const v = /^([A-Za-z_]\w*)[ \t]*(?::[^=]+)?=/.exec(line);
    if (v && !line.startsWith(" ")) out.push({ name: v[1], kind: "variable", line: i + 1, col: 1, depth: 0 });
  }
  return out;
}

/** Markdown 大纲（标题层级）。 */
export function outlineMarkdown(source) {
  const lines = String(source ?? "").split("\n");
  const out = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ name: m[2], kind: "heading", line: i + 1, col: 1, depth: m[1].length - 1 });
  }
  return out;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((s) => {
    const key = `${s.line}:${s.col}:${s.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 按语言分派；未知语言返回空数组。 */
export function outlineOf(lang, source) {
  if (lang === "python") return outlinePython(source);
  if (lang === "markdown") return outlineMarkdown(source);
  if (lang === "cpp" || lang === "c") return outlineCpp(source);
  return [];
}

/** 大纲 → 平铺列表（按行号排序，附带缩进用 depth）。 */
export function sortOutline(list) {
  return [...(list ?? [])].sort((a, b) => a.line - b.line || a.col - b.col);
}
