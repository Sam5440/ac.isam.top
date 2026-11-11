"use client";

/**
 * /ide 编辑器区的 VS Code 式部件：终端面板标签头、问题列表、状态栏、
 * 快速打开（Ctrl/⌘P）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleX, Info, TriangleAlert, X } from "lucide-react";
import { ActionButton, Badge, FileIcon } from "@/components/ide/vsc";

/* ---------------- 面板 ---------------- */

export function PanelHeader({ tabs, active, onTab, actions, onClose }) {
  return (
    <div className="flex h-[35px] shrink-0 items-center pr-2 pl-2">
      <div role="tablist" className="flex h-full min-w-0 items-center overflow-x-auto">
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onTab(t.id)}
              className="relative mx-[2px] flex h-full shrink-0 items-center gap-1.5 px-2 text-[11px] tracking-[0.02em] uppercase"
              style={{ color: on ? "var(--vsc-fg-strong)" : "var(--vsc-fg-muted)" }}
            >
              {t.label}
              {t.badge ? <Badge>{t.badge}</Badge> : null}
              {on && <span className="absolute inset-x-2 bottom-[4px] h-px bg-[color:var(--vsc-accent)]" />}
            </button>
          );
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
        {actions}
        <span className="mx-1 h-4 w-px" style={{ background: "var(--vsc-border)" }} />
        <ActionButton icon={X} title="隐藏终端 (⌘J)" onClick={onClose} />
      </div>
    </div>
  );
}

/** 问题列表（编译诊断）：点击跳转到编辑器对应行列。 */
export function ProblemsList({ diags, filePath }) {
  if (!diags.length)
    return <p className="px-5 py-1 text-[13px] opacity-80">尚未在工作区检测到问题。</p>;
  const jump = (d) => {
    const ed = typeof window !== "undefined" ? window.__ysMonaco?.editor : null;
    if (!ed || !d.line) return;
    ed.setPosition({ lineNumber: d.line, column: d.col || 1 });
    ed.revealLineInCenter(d.line);
    ed.focus();
  };
  return (
    <div className="h-full overflow-auto py-0.5 text-[13px]">
      <div className="flex h-[22px] items-center gap-1.5 pl-3">
        <FileIcon name={filePath || ""} />
        <span>{filePath}</span>
        <Badge>{diags.length}</Badge>
      </div>
      {diags.map((d, i) => {
        const Icon = d.severity === "warning" ? TriangleAlert : d.severity === "note" || d.severity === "info" ? Info : CircleX;
        const color = d.severity === "warning" ? "var(--vsc-warning)" : d.severity === "note" || d.severity === "info" ? "var(--vsc-info)" : "var(--vsc-error)";
        return (
          <button
            key={i}
            type="button"
            onClick={() => jump(d)}
            className="flex min-h-[22px] w-full items-start gap-1.5 py-[3px] pr-3 pl-8 text-left hover:bg-[color:var(--vsc-hover)]"
          >
            <Icon className="mt-px size-4 shrink-0" strokeWidth={1.5} style={{ color }} />
            <span className="min-w-0 flex-1 break-words">{d.message}</span>
            <span className="shrink-0 opacity-60">
              {d.source || (d.severity === "syntax" ? "python" : "clang")}
              {d.line ? ` [行 ${d.line}${d.col ? `, 列 ${d.col}` : ""}]` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- 状态栏 ---------------- */

export function StatusItem({ children, title, onClick, className = "" }) {
  const cls = `flex h-full shrink-0 items-center gap-1 px-[5px] ${onClick ? "cursor-pointer hover:bg-[color:var(--vsc-statusbar-hover)]" : ""} ${className}`;
  return onClick ? (
    <button type="button" title={title} onClick={onClick} className={cls}>
      {children}
    </button>
  ) : (
    <span title={title} className={cls}>
      {children}
    </span>
  );
}

export function StatusBar({ left, right, running }) {
  return (
    <footer
      className="flex h-[22px] shrink-0 items-center justify-between overflow-hidden border-t text-[12px] select-none"
      style={{
        background: running ? "var(--vsc-accent)" : "var(--vsc-statusbar)",
        color: running ? "var(--vsc-accent-fg)" : "var(--vsc-statusbar-fg)",
        borderColor: running ? "transparent" : "var(--vsc-border)",
      }}
    >
      <div className="flex h-full min-w-0 items-center overflow-hidden">{left}</div>
      <div className="flex h-full shrink-0 items-center pr-1">
        {right}
      </div>
    </footer>
  );
}

/* ---------------- 快速打开 ---------------- */

/** 子序列模糊匹配得分（越小越好），不匹配返回 -1。 */
function fuzzy(q, s) {
  if (!q) return 0;
  const a = s.toLowerCase();
  let pos = -1;
  let gaps = 0;
  for (const ch of q.toLowerCase()) {
    const n = a.indexOf(ch, pos + 1);
    if (n < 0) return -1;
    gaps += n - pos - 1;
    pos = n;
  }
  return gaps;
}

export function QuickOpen({ files, recent, onPick, onCreate, onClose }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);
  const items = useMemo(() => {
    const order = new Map(recent.map((p, i) => [p, i]));
    return files
      .map((f) => ({ f, s: fuzzy(q, f.path) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => (q ? a.s - b.s : (order.get(a.f.path) ?? 999) - (order.get(b.f.path) ?? 999)))
      .map((x) => x.f);
  }, [files, q, recent]);
  const canCreate = q.trim() && !files.some((f) => f.path === q.trim());
  const total = items.length + (canCreate ? 1 : 0);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (i) => {
    if (i < items.length) onPick(items[i].path);
    else if (canCreate) onCreate(q.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[75]" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-label="快速打开"
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-[42px] left-1/2 w-[min(600px,calc(100vw-24px))] -translate-x-1/2 rounded-[6px] border p-1.5 shadow-[0_0_8px_2px_rgba(0,0,0,0.36)]"
        style={{ background: "var(--vsc-widget)", borderColor: "var(--vsc-widget-border)" }}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(total - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter" && total) choose(sel);
          }}
          placeholder="按名称搜索文件（输入新文件名可直接创建）"
          aria-label="搜索文件"
          spellCheck={false}
          className="vsc-input !h-[26px] !border-[color:var(--vsc-accent)]"
        />
        <ul ref={listRef} className="mt-1 max-h-[300px] overflow-auto" role="listbox">
          {items.map((f, i) => (
            <li key={f.path} role="option" aria-selected={i === sel}>
              <button
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(i)}
                className="flex h-[22px] w-full items-center gap-1.5 rounded-[3px] px-1.5 text-left text-[13px]"
                style={i === sel ? { background: "var(--vsc-focus-selection)", color: "var(--vsc-fg-strong)" } : undefined}
              >
                <FileIcon lang={f.lang} name={f.name} />
                <span className="truncate">{f.name}</span>
                {f.path !== f.name && <span className="truncate text-[12px] opacity-60">{f.path}</span>}
                {!q && i === 0 && recent.length > 0 && <span className="ml-auto text-[12px] opacity-60">最近打开</span>}
              </button>
            </li>
          ))}
          {canCreate && (
            <li role="option" aria-selected={sel === items.length}>
              <button
                type="button"
                onMouseEnter={() => setSel(items.length)}
                onClick={() => choose(items.length)}
                className="flex h-[22px] w-full items-center gap-1.5 rounded-[3px] px-1.5 text-left text-[13px]"
                style={sel === items.length ? { background: "var(--vsc-focus-selection)", color: "var(--vsc-fg-strong)" } : undefined}
              >
                <FileIcon name={q.trim()} />
                <span>新建文件：{q.trim()}</span>
              </button>
            </li>
          )}
          {!total && <li className="px-1.5 py-1 text-[13px] opacity-70">没有匹配的结果</li>}
        </ul>
      </div>
    </div>
  );
}
