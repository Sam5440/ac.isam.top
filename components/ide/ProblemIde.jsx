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

const IdePage = dynamic(() => import("@/components/ide/IdePage"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-[13px] opacity-70">正在打开 IDE…</div>
  ),
});

const MOBILE_QUERY = "(max-width: 767.98px), (max-width: 920px) and (max-height: 500px)";

export default function ProblemIde({ contest = null, problem = null }) {
  const [portalRoot, setPortalRoot] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
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
    setOpen(window.innerWidth >= 1024);
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

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const toggle = () => setOpen((v) => !v);
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key ?? "").toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) setOpen(false);
    };
    window.addEventListener("ysc-compiler-toggle", toggle);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("ysc-compiler-toggle", toggle);
      document.removeEventListener("keydown", onKey);
    };
  }, [mounted]);

  const close = useCallback(() => setOpen(false), []);

  if (!mounted || !portalRoot) return null;

  return (
    <>
      {createPortal(
        <button
          type="button"
          onClick={() => setOpen(true)}
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
            {everOpened ? <IdePage embedded problemSeed={seed} onClose={close} /> : null}
          </div>
        </aside>,
        portalRoot,
      )}
    </>
  );
}