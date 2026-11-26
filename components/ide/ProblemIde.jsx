"use client";

/**
 * 题目页内嵌 IDE（/problems/[platform]/[problemId]）。
 *
 * 完整复用 /ide 的 IdePage（同一套布局 / 文件 / 样例 / 终端 / AI / 设置），
 * 只把外壳换成题目页的右侧分栏：
 *
 *   ┌────────────── 题目（左半屏）──────────────┬────────────── IDE（右半屏）──────────────┐
 *   │ 题面 / 样例 / 提交流程                     │ 工作区 · 编辑器 · 终端 · 状态栏            │
 *   └───────────────────────────────────────────┴───────────────────────────────────────────┘
 *
 * - 桌面端固定占 50vw（globals.css 的 body.problem-ide-open），复用
 *   CompilerDock 的 .compiler-track / body.compiler-open 分栏机制，所以顶栏的
 *   「编译器」按钮、⌘J、站点整体缩窄都保持一致；
 * - 移动端沿用 compiler-cover-mode（全屏从右滑入，避免半屏无法操作）；
 * - 打开时 IdePage 会为当前题目自动创建工作区：比赛目录 + 题号代码 + 同名 md。
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Braces, ChevronLeft, X } from "lucide-react";
import { loadCpSettings, saveCpSettings } from "@/lib/compiler/cp-settings";

const IdePage = dynamic(() => import("@/components/ide/IdePage"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-[13px] opacity-70">正在打开 IDE…</div>
  ),
});

const MOBILE_QUERY = "(max-width: 767.98px), (max-width: 920px) and (max-height: 500px)";

/**
 * `problemData`：题面在服务端不存在的平台（私有化）由调用方直接传已解密的
 * 题目对象，IdePage 用它代替 /api/problems 请求。
 */
export default function ProblemIde({ contest = null, problem = null, problemData = null }) {
  const [portalRoot, setPortalRoot] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  // 题目 / IDE 分栏宽度（px）：null = 跟随 CSS 默认 50vw；拖动左缘手柄调整
  const [panelW, setPanelW] = useState(null);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef(null);

  const seed = problem
    ? {
        platform: problem.platform,
        id: problem.id,
        index: problem.index ?? null,
        title: problem.title ?? "",
        titleZh: problem.titleZh ?? null,
        contest: contest
          ? { id: contest.id, title: contest.title, titleZh: contest.titleZh ?? null }
          : problem.contestId
            ? { id: problem.contestId }
            : null,
      }
    : null;

  useEffect(() => {
    setPortalRoot(document.getElementById("compiler-dock-root"));
    const s = loadCpSettings();
    // 用户上次的开合状态优先（像 CompilerDock 的 panelOpen）；本机没有记录时
    // 桌面默认展开、窄屏默认收起。宽度同理，null = 50vw。
    const savedOpen = s.problemIdeOpen;
    setOpen(
      savedOpen === false
        ? false
        : savedOpen === true
          ? window.innerWidth >= 900
          : window.innerWidth >= 1024,
    );
    setPanelW(Number.isFinite(s.problemIdeWidth) ? s.problemIdeWidth : null);
    setMounted(true);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.body.classList.add("problem-ide-open");
    document.body.classList.toggle("compiler-open", open);
    return () => {
      document.body.classList.remove("problem-ide-open");
      document.body.classList.remove("compiler-open");
    };
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;
    document.body.classList.toggle("compiler-cover-mode", isMobile);
    return () => document.body.classList.remove("compiler-cover-mode");
  }, [isMobile, mounted]);

  const openTouchedRef = useRef(false);
  const setOpenSaved = useCallback((next) => {
    openTouchedRef.current = true; // 只有用户主动开合才落盘，避免把「视口默认」写死
    setOpen(next);
  }, []);

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  // 题目页 IDE 的开合状态刷新后保持（关掉就不会每次重新弹出来）
  useEffect(() => {
    if (mounted && openTouchedRef.current) saveCpSettings({ problemIdeOpen: open });
  }, [open, mounted]);

  /* ---------- 题目 / IDE 分栏拖拽 ----------
     面板在右：拖它的左缘。改 body 上的 --compiler-w（内联优先于
     body.problem-ide-open 的 50vw）；拖拽期间挂 compiler-resizing 禁用开合
     过渡与选中文本；双击手柄恢复 50vw，聚焦后 ←/→ 微调。 */
  const clampPanelW = useCallback((w) => {
    const max = Math.max(360, window.innerWidth - 320);
    return Math.min(Math.max(Math.round(w), 360), max);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const body = document.body;
    if (panelW) body.style.setProperty("--compiler-w", `${panelW}px`);
    else body.style.removeProperty("--compiler-w");
    return () => body.style.removeProperty("--compiler-w");
  }, [panelW, mounted]);

  // 视口变窄时把宽度收回可用范围，避免题目列被挤没
  useEffect(() => {
    if (!mounted || !panelW) return;
    const onResize = () => setPanelW((w) => (w ? clampPanelW(w) : w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mounted, panelW, clampPanelW]);

  const beginResize = useCallback(
    (e) => {
      if (e.button !== 0 || !open) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = panelRef.current?.getBoundingClientRect().width ?? window.innerWidth / 2;
      let latest = startW;
      setResizing(true);
      document.body.classList.add("compiler-resizing");
      const onMove = (ev) => {
        latest = clampPanelW(startW + (startX - ev.clientX));
        setPanelW(latest);
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        document.body.classList.remove("compiler-resizing");
        setResizing(false);
        if (Math.round(latest) !== Math.round(startW)) saveCpSettings({ problemIdeWidth: latest });
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [clampPanelW, open],
  );

  useEffect(() => {
    if (!mounted) return;
    const toggle = () => setOpenSaved((v) => !v);
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key ?? "").toLowerCase() === "j") {
        e.preventDefault();
        setOpenSaved((v) => !v);
        return;
      }
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // 快速打开 / 右键菜单 / 设置对话框等弹层自己处理 Esc，别顺带把 IDE 关掉
      if (e.target instanceof Element && e.target.closest('[role="dialog"],[role="menu"],[role="listbox"]')) return;
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) setOpenSaved(false);
    };
    window.addEventListener("ysc-compiler-toggle", toggle);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("ysc-compiler-toggle", toggle);
      document.removeEventListener("keydown", onKey);
    };
  }, [mounted, setOpenSaved]);

  const close = useCallback(() => setOpenSaved(false), [setOpenSaved]);

  if (!mounted || !portalRoot) return null;

  return (
    <>
      {createPortal(
        <button
          type="button"
          onClick={() => setOpenSaved(true)}
          aria-label={open ? "收起 IDE" : "展开 IDE"}
          aria-controls="compiler-panel"
          aria-expanded={open}
          title="展开题目 IDE（右半屏，与题目并排）"
          className="compiler-edge-tab"
        >
          <Braces className="size-3.5" />
          <span className="edge-label">IDE</span>
          <ChevronLeft className="size-3.5" />
        </button>,
        document.body,
      )}

      {createPortal(
        <aside
          id="compiler-panel"
          ref={panelRef}
          className="compiler-box relative flex flex-col"
          aria-label="题目 IDE"
          aria-hidden={!open}
          inert={!open}
        >
          {/* 左缘分栏拖拽手柄：改 --compiler-w（题目 / IDE 宽度），双击恢复 50vw */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整题目与 IDE 宽度"
            title="拖动调整宽度，双击恢复默认"
            tabIndex={0}
            data-dragging={resizing || undefined}
            onPointerDown={beginResize}
            onDoubleClick={() => {
              setPanelW(null);
              saveCpSettings({ problemIdeWidth: null });
            }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const step = (e.shiftKey ? 64 : 16) * (e.key === "ArrowLeft" ? 1 : -1);
              const base = panelW ?? panelRef.current?.getBoundingClientRect().width ?? window.innerWidth / 2;
              const next = clampPanelW(base + step);
              setPanelW(next);
              saveCpSettings({ problemIdeWidth: next });
            }}
            className="compiler-resize-w"
          />
          <div className="flex h-[26px] shrink-0 items-center gap-1 border-b px-2" style={{ borderColor: "var(--vsc-border)" }}>
            <Braces className="size-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate text-[11px] opacity-70">
              {problem ? `${problem.index ?? ""} ${problem.titleZh || problem.title || ""}` : "IDE 工作台"}
            </span>
            <button
              type="button"
              onClick={close}
              title="关闭 IDE（Ctrl/⌘+J）"
              aria-label="关闭 IDE"
              className="grid size-5 place-items-center rounded-[4px] opacity-70 hover:bg-[color:var(--vsc-statusbar-hover)] hover:opacity-100"
            >
              <X className="size-3.5" strokeWidth={1.6} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {everOpened ? (
              <IdePage embedded problemSeed={seed} problemOverride={problemData} onClose={close} />
            ) : null}
          </div>
        </aside>,
        portalRoot,
      )}
    </>
  );
}
