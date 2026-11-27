"use client";

/**
 * /ide 工作台几何与布局偏好（localStorage 持久化）：
 *  - 左右侧栏宽度 / 开合 / 当前标签，底部终端高度 / 开合 / 当前标签；
 *  - 功能块摆放 assign：samples / statement / files / chat / settings → 'left' | 'right'
 *    （默认：文件 + 题面在左，样例 + AI + 设置在右；settings 不可隐藏，保证总能改回来）；
 *  - showRun：编辑器标题栏是否显示「运行」按钮。
 * 移动端（<768px）侧栏默认收起，以浮层打开。
 * 嵌入题目页的 compact 布局存在同一键的 `compact` 字段里：首次进入用题目页默认
 * （文件左 / 样例右、右侧最小宽度展开），之后用户怎么调就怎么记，刷新后保持。
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "ysc-vec-mdppy-i6";

export const MODULES = [
  { id: "samples", label: "样例" },
  { id: "statement", label: "题面" },
  { id: "files", label: "文件" },
  { id: "details", label: "详情" },
  { id: "chat", label: "AI 对话" },
  { id: "settings", label: "设置" },
];

export const LAYOUT_DEFAULTS = {
  assign: {
    samples: "right",
    statement: "left",
    files: "left",
    details: "right",
    chat: "right",
    settings: "right",
  },
  leftOpen: true,
  rightOpen: true,
  leftW: 300,
  rightW: 300,
  leftTab: "files",
  rightTab: "samples",
  termOpen: true,
  termH: 220,
  termTab: "terminal", // terminal | problems | ci
  showRun: true,
};
const LIMITS = { leftW: [220, 600], rightW: [220, 640], termH: [90, 900] };

/** 旧默认布局（样例在左、文件在右）一次性换位：文件管理放左、样例测试放右。
    只交换「正好是旧默认配对」的布局，用户自定义过的排列不动；幂等。 */
function migrateAssign(out) {
  if (out.assign.files === "right" && out.assign.samples === "left") {
    out.assign.files = "left";
    out.assign.samples = "right";
    if (out.leftTab === "samples") out.leftTab = "files";
    if (out.rightTab === "files") out.rightTab = "samples";
  }
  return out;
}

function load(compact = false) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    // 嵌入题目页的布局单独存 root.compact，避免半屏几何污染完整 /ide 布局
    const compactRaw = root.compact && typeof root.compact === "object" ? root.compact : null;
    const source = compact ? compactRaw ?? root : root;
    const out = { ...LAYOUT_DEFAULTS, assign: { ...LAYOUT_DEFAULTS.assign } };
    for (const k of Object.keys(LAYOUT_DEFAULTS)) {
      if (k === "assign") continue;
      if (typeof source[k] === typeof LAYOUT_DEFAULTS[k]) out[k] = source[k];
    }
    if (source.assign && typeof source.assign === "object") {
      for (const m of MODULES) {
        if (source.assign[m.id] === "left" || source.assign[m.id] === "right") out.assign[m.id] = source.assign[m.id];
      }
    }
    // 旧默认配对换位只针对完整 IDE；compact 的布局是用户自己的，别动
    return { layout: compact ? out : migrateAssign(out), saved: compact ? Boolean(compactRaw) : true };
  } catch {
    return { layout: { ...LAYOUT_DEFAULTS, assign: { ...LAYOUT_DEFAULTS.assign } }, saved: false };
  }
}

const clamp = (n, [min, max]) => Math.min(max, Math.max(min, n));

/** 某侧的模块列表（按 MODULES 顺序）。 */
export function modulesOn(layout, side) {
  return MODULES.filter((m) => layout.assign[m.id] === side);
}

export function useWorkbenchLayout({ compact = false } = {}) {
  const [layout, setLayout] = useState(null); // null = SSR/首帧
  const [isMobile, setIsMobile] = useState(false);
  const [dragging, setDragging] = useState(null); // 'left' | 'right' | 'term' | null
  const rootRef = useRef(null); // IDE 根（计算侧栏宽度）
  const bodyRef = useRef(null); // 编辑器 + 终端列（计算终端高度）

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const mobile = mq.matches;
    setIsMobile(mobile);
    const loaded = load(compact);
    setLayout({
      ...loaded.layout,
      ...(mobile
        ? { leftOpen: false, rightOpen: false, termOpen: false }
        : compact
          ? loaded.saved
            ? {}
            : {
                // 题目页半屏 IDE 的首次默认：文件管理在左（收起）、样例测试在右
                // 且展开到最小宽度；之后用户怎么调就怎么记（root.compact）。
                assign: { ...loaded.layout.assign, files: "left", samples: "right" },
                leftOpen: false,
                leftTab: "files",
                rightOpen: true,
                rightTab: "samples",
                rightW: LIMITS.rightW[0],
                termOpen: false,
              }
          : {}),
    });
    const sync = () => {
      setIsMobile(mq.matches);
      if (mq.matches) setLayout((prev) => (prev ? { ...prev, leftOpen: false, rightOpen: false } : prev));
    };
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [compact]);

  useEffect(() => {
    // 移动端只是临时收起，不落盘；嵌入模式写 root.compact，完整 IDE 写顶层字段，
    // 两者互不覆盖。
    if (!layout || isMobile) return;
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const base = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      const next = compact
        ? { ...base, compact: layout }
        : { ...layout, ...(base.compact ? { compact: base.compact } : {}) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, [layout, isMobile, compact]);

  const patch = useCallback(
    (p) => setLayout((prev) => (prev ? { ...prev, ...(typeof p === "function" ? p(prev) : p) } : prev)),
    [],
  );

  /** 把模块挪到另一侧；被挪走的若是当前标签，两侧标签各自回落到首个可用模块。 */
  const assignModule = useCallback(
    (id, side) =>
      patch((prev) => {
        const assign = { ...prev.assign, [id]: side };
        const next = { assign };
        const firstOn = (s) => MODULES.find((m) => assign[m.id] === s)?.id ?? null;
        if (assign[prev.leftTab] !== "left") next.leftTab = firstOn("left");
        if (assign[prev.rightTab] !== "right") next.rightTab = firstOn("right");
        if (side === "left") next.leftTab = prev.leftTab && assign[prev.leftTab] === "left" ? prev.leftTab : id;
        if (side === "right") next.rightTab = prev.rightTab && assign[prev.rightTab] === "right" ? prev.rightTab : id;
        return next;
      }),
    [patch],
  );

  /** 打开某个模块（自动展开其所在侧栏并切到该标签）。 */
  const showModule = useCallback(
    (id) =>
      patch((prev) =>
        prev.assign[id] === "left" ? { leftOpen: true, leftTab: id } : { rightOpen: true, rightTab: id },
      ),
    [patch],
  );

  const showTerm = useCallback(
    (tab, toggle = false) =>
      patch((prev) => (toggle && prev.termOpen && prev.termTab === tab ? { termOpen: false } : { termTab: tab, termOpen: true })),
    [patch],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const root = rootRef.current?.getBoundingClientRect();
      if (dragging === "left" && root) patch({ leftW: clamp(e.clientX - root.left, LIMITS.leftW) });
      else if (dragging === "right" && root) patch({ rightW: clamp(root.right - e.clientX, LIMITS.rightW) });
      else if (dragging === "term") {
        const rect = bodyRef.current?.getBoundingClientRect();
        if (rect) patch({ termH: clamp(rect.bottom - e.clientY, [LIMITS.termH[0], Math.max(LIMITS.termH[0], rect.height - 120)]) });
      }
    };
    const onUp = () => setDragging(null);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.classList.add("compiler-resizing");
    document.body.style.cursor = dragging === "term" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("compiler-resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, patch]);

  const startDrag = (mode) => (e) => {
    e.preventDefault();
    setDragging(mode);
  };

  return { layout, patch, assignModule, showModule, showTerm, isMobile, dragging, startDrag, rootRef, bodyRef };
}
