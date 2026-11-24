"use client";

/**
 * Markdown 工作台（IDE 内 .md 文件专用）：
 *
 *   分屏（默认）            所见即所得
 *   ┌──────────┬─────────┐  ┌─────────────────────┐
 *   │ 原文     │ 渲染结果 │  │ 直接编辑渲染后的正文 │
 *   └──────────┴─────────┘  └─────────────────────┘
 *
 * - 左侧复用同一个 Monaco（components/compiler/CodeEditor，语言 markdown），
 *   右侧走站内 renderRich + 全局 KatexRuntime，公式与题面渲染完全一致；
 * - 所见即所得用 contentEditable：输入后经 lib/markdown-dom 的 htmlToMarkdown
 *   写回 Markdown，光标不因外部同步而跳动（聚焦时跳过回填）；
 * - 导出 / 分享：打印（另存为 PDF，文字可选中）、直接导出 PDF / PNG / MD，
 *   Web Share 可用时分享文件，否则回退下载。生成的 Markdown 就是工作区里的
 *   文件内容，不额外维护一份。
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Code2,
  Columns2,
  Download,
  Eye,
  FileDown,
  FileText,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  LoaderCircle,
  Minus,
  PenLine,
  Printer,
  Quote,
  Share2,
  Sigma,
  Table2,
} from "lucide-react";
import CodeEditor from "@/components/compiler/CodeEditor";
import { ActionButton } from "@/components/ide/vsc";
import { htmlToMarkdown, markdownToEditableHtml } from "@/lib/markdown-dom";
import { renderRich } from "@/lib/render";
import {
  downloadBlob,
  markdownToBlob,
  markdownToPdfBlob,
  markdownToPngBlob,
  printMarkdown,
  shareBlob,
} from "@/lib/markdown-export";
import { toast } from "@/lib/toast";

const MODES = [
  { id: "split", label: "分屏", icon: Columns2, hint: "左边原文，右边渲染结果" },
  { id: "wysiwyg", label: "所见即所得", icon: PenLine, hint: "直接编辑渲染后的正文" },
  { id: "preview", label: "预览", icon: Eye, hint: "只查看渲染结果" },
];

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** contentEditable 里用真实标签包住选区（行内代码 / 自定义标记）。 */
function surroundWysiwyg(tag, text = "文本") {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  const picked = sel?.toString() || text;
  document.execCommand(
    "insertHTML",
    false,
    `<${tag}>${escapeHtml(picked)}</${tag}>`,
  );
}

function baseName(filePath) {
  const name = String(filePath ?? "").split("/").pop() || "document";
  return name.replace(/\.[^.]+$/, "") || "document";
}

function ToolbarButton({ icon: Icon, title, onClick, disabled, active, children }) {
  return (
    <ActionButton
      icon={Icon}
      title={title}
      onClick={onClick}
      disabled={disabled}
      active={active}
      // 保住 contentEditable / Monaco 的选区：按钮的 mousedown 若把焦点抢走，
      // execCommand / executeEdits 就作用在塌缩的光标上（WYSIWYG 粗体失效的根因）
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </ActionButton>
  );
}

export default function MarkdownEditor({
  value = "",
  onChange,
  filePath = "",
  theme,
  diagnostics = [],
  getAi,
  onAiStatus,
  onCursor,
  onReady,
}) {
  const [mode, setMode] = useState("split");
  const [busy, setBusy] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const editorRef = useRef(null);
  const wysiwygRef = useRef(null);
  const shareRef = useRef(null);
  const exportRef = useRef(null);
  const savedRangeRef = useRef(null);
  const deferred = useDeferredValue(value);
  const previewHtml = useMemo(() => renderRich(deferred || ""), [deferred]);
  const base = baseName(filePath);

  /* ---------- 外部内容变化：只在「没有正在编辑」时回填 WYSIWYG ---------- */
  useEffect(() => {
    if (mode !== "wysiwyg") return;
    const el = wysiwygRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const html = markdownToEditableHtml(value);
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [mode, value]);

  useEffect(() => {
    if (mode !== "split") editorRef.current = null;
  }, [mode]);

  /* 记住 WYSIWYG 的选区：窗口 prompt（链接 / 图片 / 公式）会让编辑器失焦，
     恢复选区后 execCommand 才会作用在用户选中的文字上。 */
  useEffect(() => {
    if (mode !== "wysiwyg") return;
    const save = () => {
      const sel = window.getSelection();
      const el = wysiwygRef.current;
      if (!sel?.rangeCount || !el) return;
      const range = sel.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) savedRangeRef.current = range.cloneRange();
    };
    document.addEventListener("selectionchange", save);
    return () => document.removeEventListener("selectionchange", save);
  }, [mode]);

  const restoreSelection = useCallback(() => {
    const range = savedRangeRef.current;
    const el = wysiwygRef.current;
    if (!range || !el) return;
    el.focus();
    const sel = window.getSelection();
    try {
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
  }, []);

  useEffect(() => {
    if (!shareOpen && !exportOpen) return;
    const close = (e) => {
      if (shareOpen && !shareRef.current?.contains(e.target)) setShareOpen(false);
      if (exportOpen && !exportRef.current?.contains(e.target)) setExportOpen(false);
    };
    const key = (e) => {
      if (e.key !== "Escape") return;
      setShareOpen(false);
      setExportOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [shareOpen, exportOpen]);

  /* ---------- 格式化：Monaco（分屏）与 contentEditable（所见即所得） ---------- */
  const wrapSelection = useCallback(
    (before, after, placeholder = "文本") => {
      const ed = editorRef.current;
      if (!ed || ed.isDisposed?.()) return false;
      const model = ed.getModel();
      const sel = ed.getSelection();
      if (!model || !sel) return false;
      const selected = model.getValueInRange(sel);
      const text = selected || placeholder;
      ed.executeEdits("md-format", [{ range: sel, text: `${before}${text}${after}`, forceMoveMarkers: true }]);
      ed.focus();
      return true;
    },
    [],
  );

  const prefixLines = useCallback((prefix) => {
    const ed = editorRef.current;
    if (!ed || ed.isDisposed?.()) return false;
    const model = ed.getModel();
    const sel = ed.getSelection();
    if (!model || !sel) return false;
    const start = Math.min(sel.startLineNumber, sel.endLineNumber);
    const end = Math.max(sel.startLineNumber, sel.endLineNumber);
    const edits = [];
    for (let line = start; line <= end; line += 1) {
      edits.push({
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: model.getLineMaxColumn(line),
        },
        text: `${prefix}${model.getLineContent(line)}`,
      });
    }
    ed.executeEdits("md-format", edits);
    ed.focus();
    return true;
  }, []);

  const insertBlock = useCallback((text) => {
    const ed = editorRef.current;
    if (!ed || ed.isDisposed?.()) return false;
    const sel = ed.getSelection();
    if (!sel) return false;
    ed.executeEdits("md-format", [{ range: sel, text, forceMoveMarkers: true }]);
    ed.focus();
    return true;
  }, []);

  const exec = useCallback((command, arg) => {
    try {
      document.execCommand(command, false, arg);
    } catch {}
  }, []);

  const edit = useCallback(
    (action) => (e) => {
      e?.preventDefault?.();
      if (mode === "preview") return;
      if (mode === "wysiwyg") {
        restoreSelection();
        action.wysiwyg?.();
        return;
      }
      action.monaco?.();
    },
    [mode, restoreSelection],
  );

  const insertAtCursor = useCallback(
    (text) => {
      if (mode === "wysiwyg") {
        restoreSelection();
        exec("insertText", text);
      } else {
        insertBlock(text);
      }
    },
    [mode, exec, insertBlock, restoreSelection],
  );

  const askLink = useCallback(() => {
    const url = window.prompt("链接地址（https://…）", "https://");
    if (!url) return;
    if (mode === "wysiwyg") {
      restoreSelection();
      exec("createLink", url);
    } else wrapSelection("[", `](${url})`, "链接文字");
  }, [mode, exec, wrapSelection, restoreSelection]);

  const askImage = useCallback(() => {
    const url = window.prompt("图片地址（https://… 或 data:image/…）", "https://");
    if (!url) return;
    if (mode === "wysiwyg") {
      restoreSelection();
      exec("insertHTML", `<img src="${escapeHtml(url)}" alt="">`);
    } else {
      insertBlock(`![图片](${url})`);
    }
  }, [mode, exec, insertBlock, restoreSelection]);

  const askFormula = useCallback(() => {
    const tex = window.prompt("LaTeX 公式（可省略两侧 $）", "a_i");
    if (!tex) return;
    const body = tex.replace(/^\$+|\$+$/g, "");
    insertAtCursor(` $${body}$ `);
  }, [insertAtCursor]);

  const insertTable = useCallback(() => {
    if (mode === "wysiwyg") {
      restoreSelection();
      exec(
        "insertHTML",
        "<table><thead><tr><th>列 1</th><th>列 2</th></tr></thead><tbody><tr><td></td><td></td></tr></tbody></table><p><br></p>",
      );
    } else {
      insertBlock("\n| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n");
    }
  }, [mode, exec, insertBlock, restoreSelection]);

  /* ---------- WYSIWYG 输入 → Markdown ---------- */
  const handleWysiwygInput = useCallback(() => {
    const el = wysiwygRef.current;
    if (!el) return;
    onChange?.(htmlToMarkdown(el));
  }, [onChange]);

  const handleWysiwygPaste = useCallback(
    (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      document.execCommand("insertText", false, text);
    },
    [],
  );

  /* ---------- 导出 / 分享 ---------- */
  const withBusy = useCallback(async (label, fn) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast.error(`${label}失败：${err?.message ?? err}`);
    } finally {
      setBusy("");
    }
  }, []);

  const exportMd = useCallback(
    (share = false) =>
      withBusy(share ? "分享 Markdown" : "", async () => {
        const blob = markdownToBlob(value);
        if (share) {
          const result = await shareBlob(blob, `${base}.md`, { title: base, text: "题目 Markdown" });
          if (result === "shared") toast.success("已调起系统分享");
          else if (result === "downloaded") toast.info("当前浏览器不支持文件分享，已改为下载");
        } else {
          downloadBlob(blob, `${base}.md`);
          toast.success("已导出 Markdown");
        }
      }),
    [base, value, withBusy],
  );

  const exportPng = useCallback(
    (share = false) =>
      withBusy(share ? "分享图片" : "导出图片", async () => {
        const blob = await markdownToPngBlob(value, { title: base });
        if (share) {
          const result = await shareBlob(blob, `${base}.png`, { title: base, text: "题目长图" });
          if (result === "shared") toast.success("已调起系统分享");
          else if (result === "downloaded") toast.info("已改为下载图片");
        } else {
          downloadBlob(blob, `${base}.png`);
          toast.success("已导出图片");
        }
      }),
    [base, value, withBusy],
  );

  const exportPdf = useCallback(
    (share = false) =>
      withBusy(share ? "分享 PDF" : "导出 PDF", async () => {
        const blob = await markdownToPdfBlob(value, { title: base });
        if (share) {
          const result = await shareBlob(blob, `${base}.pdf`, { title: base, text: "题目 PDF" });
          if (result === "shared") toast.success("已调起系统分享");
          else if (result === "downloaded") toast.info("已改为下载 PDF");
        } else {
          downloadBlob(blob, `${base}.pdf`);
          toast.success("已导出 PDF");
        }
      }),
    [base, value, withBusy],
  );

  const printPdf = useCallback(() => {
    printMarkdown(value, { title: base });
    toast.info("在打印窗口选择「另存为 PDF」（文字可复制）");
  }, [base, value]);

  const shareItems = [
    { label: "分享 Markdown", icon: FileText, run: () => exportMd(true) },
    { label: "分享 PDF", icon: FileDown, run: () => exportPdf(true) },
    { label: "分享图片", icon: ImageIcon, run: () => exportPng(true) },
  ];
  const exportItems = [
    { label: "导出 Markdown", icon: FileText, run: () => exportMd(false) },
    { label: "导出 PDF（图片版）", icon: FileDown, run: () => exportPdf(false) },
    { label: "导出 PNG 长图", icon: ImageIcon, run: () => exportPng(false) },
    { label: "打印 / 另存为 PDF", icon: Printer, run: printPdf },
  ];

  return (
    <section aria-label="Markdown 工作台" className="flex h-full min-h-0 min-w-0 flex-col" style={{ background: "var(--vsc-editor)" }}>
      {/* 工具条：模式 + 格式化 + 导出 */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-1 border-b px-1.5 py-1"
        style={{ borderColor: "var(--vsc-border)", background: "var(--vsc-tabs)" }}
      >
        <div className="flex items-center rounded-[5px] border p-0.5" style={{ borderColor: "var(--vsc-border)" }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.hint}
              onClick={() => setMode(m.id)}
              className="inline-flex h-[22px] items-center gap-1 rounded-[3px] px-2 text-[11px]"
              style={
                mode === m.id
                  ? { background: "var(--vsc-focus-selection)", color: "var(--vsc-fg-strong)" }
                  : { color: "var(--vsc-fg-muted)" }
              }
            >
              <m.icon className="size-3.5" strokeWidth={1.6} /> {m.label}
            </button>
          ))}
        </div>

        <span className="mx-1 h-4 w-px" style={{ background: "var(--vsc-border)" }} />

        <ToolbarButton icon={Bold} title="粗体" disabled={mode === "preview"} onClick={edit({ wysiwyg: () => exec("bold"), monaco: () => wrapSelection("**", "**") })} />
        <ToolbarButton icon={Italic} title="斜体" disabled={mode === "preview"} onClick={edit({ wysiwyg: () => exec("italic"), monaco: () => wrapSelection("*", "*") })} />
        <ToolbarButton icon={Heading2} title="二级标题" disabled={mode === "preview"} onClick={edit({ wysiwyg: () => exec("formatBlock", "h2"), monaco: () => prefixLines("## ") })} />
        <ToolbarButton icon={Quote} title="引用" disabled={mode === "preview"} onClick={edit({ wysiwyg: () => exec("formatBlock", "blockquote"), monaco: () => prefixLines("> ") })} />
        <ToolbarButton icon={List} title="无序列表" disabled={mode === "preview"} onClick={edit({ wysiwyg: () => exec("insertUnorderedList"), monaco: () => prefixLines("- ") })} />
        <ToolbarButton icon={ListOrdered} title="有序列表" disabled={mode === "preview"} onClick={edit({ wysiwyg: () => exec("insertOrderedList"), monaco: () => prefixLines("1. ") })} />
        <ToolbarButton icon={Code2} title="行内代码" disabled={mode === "preview"} onClick={edit({ wysiwyg: () => surroundWysiwyg("code", "code"), monaco: () => wrapSelection("`", "`", "code") })} />
        <ToolbarButton icon={Link2} title="链接" disabled={mode === "preview"} onClick={askLink} />
        <ToolbarButton icon={ImageIcon} title="图片" disabled={mode === "preview"} onClick={askImage} />
        <ToolbarButton icon={Table2} title="表格" disabled={mode === "preview"} onClick={insertTable} />
        <ToolbarButton icon={Sigma} title="公式" disabled={mode === "preview"} onClick={askFormula} />
        <ToolbarButton icon={Minus} title="分隔线" disabled={mode === "preview"} onClick={edit({ wysiwyg: () => exec("insertHorizontalRule"), monaco: () => insertBlock("\n---\n") })} />

        <span className="mx-1 h-4 w-px" style={{ background: "var(--vsc-border)" }} />

        <div className="relative" ref={exportRef}>
          <button
            type="button"
            title="导出 Markdown / PDF / 图片"
            onClick={() => setExportOpen((v) => !v)}
            disabled={!!busy}
            className="inline-flex h-[22px] items-center gap-1 rounded-[5px] px-1.5 text-[11px] hover:bg-[color:var(--vsc-statusbar-hover)] disabled:opacity-40"
          >
            <Download className="size-4" strokeWidth={1.5} /> 导出
          </button>
          {exportOpen && (
            <div
              className="absolute top-[26px] right-0 z-50 w-52 rounded-[5px] border p-1 shadow-lg"
              style={{ background: "var(--vsc-widget)", borderColor: "var(--vsc-widget-border)" }}
            >
              {exportItems.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    it.run();
                  }}
                  className="flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[12px] whitespace-nowrap hover:bg-[color:var(--vsc-accent)] hover:text-[color:var(--vsc-accent-fg)]"
                >
                  <it.icon className="size-3.5" strokeWidth={1.5} /> {it.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative" ref={shareRef}>
          <button
            type="button"
            title="分享文件"
            onClick={() => setShareOpen((v) => !v)}
            disabled={!!busy}
            className="inline-flex h-[22px] items-center gap-1 rounded-[5px] px-1.5 text-[11px] hover:bg-[color:var(--vsc-statusbar-hover)] disabled:opacity-40"
          >
            <Share2 className="size-4" strokeWidth={1.5} /> 分享
          </button>
          {shareOpen && (
            <div
              className="absolute top-[26px] right-0 z-50 w-40 rounded-[5px] border p-1 shadow-lg"
              style={{ background: "var(--vsc-widget)", borderColor: "var(--vsc-widget-border)" }}
            >
              {shareItems.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  onClick={() => {
                    setShareOpen(false);
                    it.run();
                  }}
                  className="flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[12px] whitespace-nowrap hover:bg-[color:var(--vsc-accent)] hover:text-[color:var(--vsc-accent-fg)]"
                >
                  <it.icon className="size-3.5" strokeWidth={1.5} /> {it.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {busy && (
          <span className="ml-1 inline-flex items-center gap-1 text-[11px] opacity-70">
            <LoaderCircle className="size-3.5 animate-spin" /> {busy}…
          </span>
        )}
      </div>

      {/* 正文 */}
      <div className="flex min-h-0 flex-1">
        {mode === "wysiwyg" ? (
          <div
            ref={wysiwygRef}
            role="textbox"
            aria-multiline="true"
            aria-label="Markdown 所见即所得编辑"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onInput={handleWysiwygInput}
            onBlur={handleWysiwygInput}
            onPaste={handleWysiwygPaste}
            className="md-body md-wysiwyg min-h-0 flex-1 overflow-auto px-6 py-4"
            style={{ outline: "none", background: "var(--vsc-editor)", color: "var(--vsc-fg)" }}
          />
        ) : (
          <>
            {mode === "split" && (
              <div className="flex min-h-0 w-1/2 min-w-0 flex-col border-r" style={{ borderColor: "var(--vsc-border)" }}>
                <CodeEditor
                  language="markdown"
                  value={value}
                  onChange={onChange}
                  diagnostics={diagnostics}
                  theme={theme}
                  getAi={getAi}
                  onAiStatus={onAiStatus}
                  onReady={(editor) => {
                    editorRef.current = editor;
                    const report = () => {
                      const pos = editor.getPosition();
                      const sel = editor.getSelection();
                      const model = editor.getModel();
                      const selLen = sel && model && !sel.isEmpty() ? model.getValueInRange(sel).length : 0;
                      onCursor?.({ line: pos?.lineNumber ?? 1, col: pos?.column ?? 1, sel: selLen });
                    };
                    editor.onDidChangeCursorPosition(report);
                    editor.onDidChangeCursorSelection(report);
                    report();
                    onReady?.(editor);
                  }}
                />
              </div>
            )}
            <div className="md-preview min-h-0 min-w-0 flex-1 overflow-auto" style={{ background: "var(--vsc-editor)" }}>
              <div
                className="md-body mx-auto max-w-none px-6 py-4"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}