"use client";

/**
 * 编辑器标签栏（横排 / 竖排共用一份实现）。
 *
 * - 每个标签按路径取一个稳定色相（lib/ide-bindings 的 pathHue），相邻标签
 *   之间有细微色差，长文件名允许换行而不是一律截断；
 * - 右键：关闭其他 / 关闭全部 / 关闭左侧 / 关闭右侧（竖排显示为上侧 / 下侧）；
 * - 置顶标签（题目页切题时钉住的那道题）固定在首位并带图钉标记。
 */

import { useRef, useState } from "react";
import { Pin, PinOff, X } from "lucide-react";

import { ContextMenu, FileIcon } from "@/components/ide/vsc";
import { pathHue } from "@/lib/ide-bindings.mjs";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
const MOD = isMac ? "⌘" : "Ctrl+";

function tint(path, active, pinned) {
  const hue = pathHue(path);
  const alpha = active ? 0.2 : pinned ? 0.13 : 0.07;
  return `hsl(${hue} 55% 50% / ${alpha})`;
}

export default function TabList({
  openPaths,
  files,
  activePath,
  pinnedPath = null,
  onSelect,
  onClose,
  onCloseMany,
  onTogglePin,
  isDirty,
  orientation = "horizontal",
  className = "",
}) {
  const [menu, setMenu] = useState(null);
  const listRef = useRef(null);
  const vertical = orientation === "vertical";
  const fileOf = (path) => files.find((f) => f.path === path);

  const menuItems = (path) => {
    const i = openPaths.indexOf(path);
    const items = [
      {
        label: pinnedPath === path ? "取消置顶" : "置顶标签",
        onClick: () => onTogglePin?.(path),
      },
      "sep",
      { label: "关闭其他标签", onClick: () => onCloseMany?.(path, "others") },
      { label: "关闭全部标签", onClick: () => onCloseMany?.(path, "all") },
      "sep",
      {
        label: vertical ? "关闭上侧标签" : "关闭左侧标签",
        onClick: () => onCloseMany?.(path, "left"),
        disabled: i <= 0,
      },
      {
        label: vertical ? "关闭下侧标签" : "关闭右侧标签",
        onClick: () => onCloseMany?.(path, "right"),
        disabled: i < 0 || i >= openPaths.length - 1,
      },
    ];
    return items;
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={
        vertical
          ? `flex min-h-0 flex-col overflow-y-auto overflow-x-hidden ${className}`
          : `vsc-tabs flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden ${className}`
      }
    >
      {openPaths.map((path) => {
        const f = fileOf(path);
        const isActive = path === activePath;
        const pinned = path === pinnedPath;
        const dirty = f && isDirty?.(f);
        const name = f ? f.name : path.split("/").pop();
        return (
          <div
            key={path}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onClick={() => onSelect(path)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(path)}
            onAuxClick={(e) => e.button === 1 && onClose(path)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, path });
            }}
            title={path}
            className={
              vertical
                ? "group relative flex min-h-[26px] w-full shrink-0 cursor-pointer items-center gap-1.5 border-b px-2 py-1 text-left text-[12.5px]"
                : "group relative flex h-full max-w-56 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 border-r pr-1.5 pl-2.5 text-[13px]"
            }
            style={{
              borderColor: "var(--vsc-border)",
              background: isActive ? "var(--vsc-editor)" : tint(path, false, pinned),
              color: isActive ? "var(--vsc-tab-active-fg)" : "var(--vsc-tab-inactive-fg)",
              boxShadow: isActive
                ? vertical
                  ? "inset 2px 0 0 var(--vsc-accent)"
                  : "inset 0 1px 0 var(--vsc-accent)"
                : undefined,
            }}
          >
            {!isActive && !vertical && (
              <span className="absolute inset-x-0 bottom-0 h-px" style={{ background: "var(--vsc-border)" }} />
            )}
            {pinned && <Pin className="size-3 shrink-0 text-[color:var(--vsc-accent)]" strokeWidth={2} aria-label="已置顶" />}
            <FileIcon lang={f?.lang} name={f?.name ?? path} />
            <span
              className={
                vertical
                  ? "min-w-0 flex-1 leading-4 break-all"
                  : "min-w-0 leading-4 break-words group-hover:whitespace-normal"
              }
              style={vertical ? undefined : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            >
              {name}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(path);
              }}
              aria-label={`关闭 ${path}`}
              title={`关闭 (${MOD}W)`}
              className={`grid size-5 shrink-0 place-items-center rounded-[5px] hover:bg-[color:var(--vsc-statusbar-hover)] ${
                dirty || isActive ? "" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              {dirty && <span className="size-2 rounded-full bg-current group-hover:hidden" />}
              <X className={`size-4 ${dirty ? "hidden group-hover:block" : ""}`} strokeWidth={1.5} />
            </button>
          </div>
        );
      })}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={menuItems(menu.path).map((it) =>
            it === "sep" ? it : { ...it, disabled: it.disabled },
          )}
        />
      )}
    </div>
  );
}
