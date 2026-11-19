/**
 * 编辑器空选区整行复制/剪切（VS Code 的 emptySelectionClipboard 语义）。
 *
 * 纯函数（不碰 DOM / Monaco），光标的行号与全文行数组进来，出去是
 * 「剪切板文本 + 要删掉的行区间」。浏览器侧接线在 components/compiler/CodeEditor.jsx：
 * 编辑器容器上捕获 copy / cut 事件，选区非空时一律不接管（交回浏览器与 Monaco）。
 *
 * 语义约定：
 *  - 复制：整行内容 + 行尾换行（与 VS Code 一致，粘贴时自然另起一行）
 *  - 剪切：整行连同行尾一起删掉；最后一行（文件末尾无换行）删内容 + 前一个换行，
 *    不留空行
 *  - 多光标：按行号去重升序，合并相邻行，避免产生互相重叠的编辑区间
 */

const EOL = '\n';

/** 判断一条 Monaco 选区是否为「空选区」（单光标，未选中任何字符）。 */
function isEmptySelection(sel) {
  return (
    !!sel &&
    sel.startLineNumber === sel.endLineNumber &&
    sel.startColumn === sel.endColumn
  );
}

/** 把行号集合压成连续段 [[a, b], ...]（升序）。 */
function mergeLineRuns(lineNumbers) {
  const sorted = [...lineNumbers].sort((a, b) => a - b);
  const runs = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs;
}

/**
 * 一段连续行 [a, b] 的删除区间（1-based，endColumn 为「列后一位」语义）。
 * 末尾段没有下一行可吞，改为吞掉前一个换行；单行文件则删整行内容。
 */
function runDeletionRange(lines, a, b) {
  if (b < lines.length) {
    return {
      startLineNumber: a,
      startColumn: 1,
      endLineNumber: b + 1,
      endColumn: 1,
    };
  }
  if (a > 1) {
    return {
      startLineNumber: a - 1,
      startColumn: lines[a - 2].length + 1,
      endLineNumber: b,
      endColumn: lines[b - 1].length + 1,
    };
  }
  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: b,
    endColumn: lines[b - 1].length + 1,
  };
}

/**
 * 计算一次「空选区整行复制/剪切」的载荷。
 *
 * @param {string[]} lines 全文按行切开（Monaco model.getLines()，每项不含换行符）
 * @param {Array<{startLineNumber:number,startColumn:number,endLineNumber:number,endColumn:number}>} selections
 * @returns {{ text: string, ranges: Array<{startLineNumber:number,startColumn:number,endLineNumber:number,endColumn:number}> } | null}
 *   选区里有任何非空选区（或输入不可用）时返回 null —— 调用方必须原样放行，
 *   让浏览器/Monaco 按普通复制粘贴处理。
 */
export function lineClipboardPayload(lines, selections) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  if (!Array.isArray(selections) || selections.length === 0) return null;
  const lineNumbers = new Set();
  for (const sel of selections) {
    if (!isEmptySelection(sel)) return null;
    const n = sel.startLineNumber;
    if (!Number.isInteger(n) || n < 1 || n > lines.length) return null;
    lineNumbers.add(n);
  }
  const ordered = [...lineNumbers].sort((a, b) => a - b);
  const text = ordered.map((n) => lines[n - 1] + EOL).join('');
  const ranges = mergeLineRuns(lineNumbers).map(([a, b]) =>
    runDeletionRange(lines, a, b),
  );
  return { text, ranges };
}
