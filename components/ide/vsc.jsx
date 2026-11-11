"use client";

/**
 * /ide 的 VS Code 风格基础件（配色由 globals.css 的 .vsc 变量提供）：
 * 文件图标、工具栏图标按钮、视图标题、可折叠分节标题、徽标。
 */

import { useEffect as useEffectCm, useRef as useRefCm } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/** 文件图标（仿 Seti：C++ 蓝色 / Python 黄色字形）。 */
export function FileIcon({ lang, name = "", className = "" }) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const isPy = lang === "python" || ext === "py";
  const isHeader = /^(h|hpp|hh)$/.test(ext);
  const label = isPy ? "py" : isHeader ? "h" : ext === "txt" || ext === "in" || ext === "out" ? "≡" : "C+";
  const color = isPy ? "#e8c34a" : isHeader ? "#a074c4" : label === "≡" ? "var(--vsc-fg-muted)" : "#519aba";
  return (
    <span
      aria-hidden
      className={`inline-flex w-4 shrink-0 items-center justify-center font-mono text-[9.5px] leading-none font-bold tracking-tighter ${className}`}
      style={{ color }}
    >
      {label}
    </span>
  );
}

/** 工具栏图标按钮（22×22，悬停浅底，codicon 尺寸 16）。 */
export function ActionButton({ icon: Icon, title, onClick, disabled, active, className = "", children, ...rest }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center gap-1 rounded-[5px] px-[3px] text-[color:var(--vsc-fg)] hover:bg-[color:var(--vsc-statusbar-hover)] disabled:pointer-events-none disabled:opacity-40 ${
        active ? "bg-[color:var(--vsc-statusbar-hover)]" : ""
      } ${className}`}
      {...rest}
    >
      {Icon && <Icon className="size-4" strokeWidth={1.5} />}
      {children}
    </button>
  );
}

/** 侧栏视图工具条（标题由侧栏标签条显示，这里仅留读屏标题 + 右对齐动作）。 */
export function ViewHeader({ title, actions }) {
  return (
    <div className="group/vh flex h-[30px] shrink-0 items-center justify-end px-2">
      <h2 className="sr-only">{title}</h2>
      <div className="flex items-center gap-0.5">{actions}</div>
    </div>
  );
}

/** 可折叠分节标题（22px，粗体大写 11px，悬停显示动作）。 */
export function SectionHeader({ title, open, onToggle, actions, badge }) {
  return (
    <div
      className="group/sh flex h-[22px] shrink-0 cursor-pointer items-center border-t border-transparent pr-2 select-none [&:not(:first-child)]:border-[color:var(--vsc-border)]"
      onClick={onToggle}
      role="button"
      aria-expanded={open}
    >
      {open ? (
        <ChevronDown className="mx-0.5 size-4 shrink-0" strokeWidth={1.5} />
      ) : (
        <ChevronRight className="mx-0.5 size-4 shrink-0" strokeWidth={1.5} />
      )}
      <span className="min-w-0 flex-1 truncate text-[11px] font-bold tracking-[0.02em] uppercase">{title}</span>
      {badge != null && <Badge className="mr-1 group-hover/sh:hidden">{badge}</Badge>}
      <div
        className="hidden items-center gap-0.5 group-hover/sh:flex group-focus-within/sh:flex"
        onClick={(e) => e.stopPropagation()}
      >
        {actions}
      </div>
    </div>
  );
}

/** 计数徽标（活动栏 / 分节）。 */
export function Badge({ children, className = "", tone = "default" }) {
  const style =
    tone === "accent"
      ? { background: "var(--vsc-accent)", color: "var(--vsc-accent-fg)" }
      : { background: "var(--vsc-badge)", color: "var(--vsc-badge-fg)" };
  return (
    <span
      className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium tabular-nums ${className}`}
      style={style}
    >
      {children}
    </span>
  );
}

/** 右键菜单（VS Code 式：圆角浮层、24px 行、分隔线），items: [{label, onClick, keybinding, danger} | 'sep']。 */
export function ContextMenu({ x, y, items, onClose }) {
  const ref = useRefCm(null);
  useEffectCm(() => {
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  const left = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1e4) - 230);
  const top = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 1e4) - items.length * 26 - 16);
  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[80] min-w-[220px] rounded-[5px] border p-1 shadow-[0_2px_8px_rgba(0,0,0,0.36)]"
      style={{ left, top, background: "var(--vsc-widget)", borderColor: "var(--vsc-widget-border)" }}
    >
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="mx-1 my-1 h-px" style={{ background: "var(--vsc-widget-border)" }} />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className="flex h-6 w-full items-center justify-between gap-6 rounded-[3px] px-3 text-left text-[13px] hover:bg-[color:var(--vsc-accent)] hover:text-[color:var(--vsc-accent-fg)]"
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            <span>{it.label}</span>
            {it.keybinding && <span className="text-[12px] opacity-70">{it.keybinding}</span>}
          </button>
        ),
      )}
    </div>
  );
}
