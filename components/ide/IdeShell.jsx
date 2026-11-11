"use client";

/**
 * IDE 全局铺满外壳（v1.7，参考 VS Code / TRAE 布局）：
 *
 *   ┌─ SiteHeader（全站顶栏，h-14）──────────────────────────────────┐
 *   │ 活动栏 │ 测试面板 │ 多标签编辑器（flex-1） │ 文件管理器 │ Chat │
 *   │  44px  │ 280px   │  Tab + 代码 + 状态栏    │  232px     │  ↑  │
 *   │        ├─────────┴────────────────────────┴────────────┤    │
 *   │        │ 底部面板（终端 / CI 日志，可拖拽高度，可收起）    │    │
 *   └────────┴───────────────────────────────────────────────┴────┘
 *
 * - 不经 #compiler-dock-root portal；本页注入 .ide-fullbleed 覆盖 layout
 *   的 max-w-6xl 约束（globals.css），并隐藏站点页脚（应用型页面）。
 * - 左缘 44px 活动栏（VS Code 式图标条）：测试面板 / 终端 / CI 日志 /
 *   文件管理器的开合 + AI 对话入口。
 * - IdePage（layout="workspace"）是唯一状态中枢；宽度与底部高度由本组件
 *   通过 CSS 变量（--ide-left/--ide-right/--ide-bottom）注入，面板拖拽
 *   手柄挂在外壳边界上，双击恢复默认，几何持久化 localStorage。
 * - CI 日志标签页：服务端传入的最近 20 次运行记录（CiLogPanel）。
 * - AI 对话：与题目页同一 ChatPanel（IDE 页无题目 → scope='global'，
 *   编辑器代码经 editor-bridge、运行结果经 ide-bus 注入上下文）。
 */

import { useEffect, useRef, useState } from "react";
import { Bot, Files, FlaskConical, PanelBottom, TerminalSquare } from "lucide-react";

import IdePage from "@/components/ide/IdePage";
import ChatPanel from "@/components/chat/ChatPanel";
import CiLogPanel from "@/components/ide/CiLogPanel";

const STORAGE_KEY = "ysc-ide-shell-v1";
const DEFAULTS = { leftW: 280, rightW: 232, bottomH: 240, bottomOpen: true, bottomTab: "terminal" };
const LIMITS = {
  leftW: [220, 480],
  rightW: [220, 480],
  bottomH: [120, 640],
};

function loadPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

export default function IdeShell({ ciRuns, ciActionsUrl }) {
  const [prefs, setPrefs] = useState(null); // null = SSR/首帧，避免 hydration 不一致
  const [chatOpen, setChatOpen] = useState(false);
  const [dragging, setDragging] = useState(null); // 'left' | 'right' | 'bottom' | null
  const dragRef = useRef(null);
  const rootRef = useRef(null);

  useEffect(() => setPrefs(loadPrefs()), []);

  const patch = (p) => setPrefs((prev) => ({ ...prev, ...p }));
  useEffect(() => {
    if (prefs) localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  /* 移动端（<768px）：侧面板与底部面板默认全部收起（宽度归 0），铺满以编辑器
     为主——用户可通过活动栏把任一面板临时打开（此时限宽 70vw）。桌面端不受影响。 */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (isMobile) setPrefs((prev) => (prev ? { ...prev, leftW: 0, rightW: 0, bottomOpen: false } : prev));
  }, [isMobile]);

  const panelW = (w, side) => {
    if (!w) return 0;
    // 移动端临时打开的面板最多占 70vw，避免把编辑器挤没
    return isMobile ? `min(${w}px, 70vw)` : `${w}px`;
  };

  /* ---------- 拖拽（面板宽 / 底部高） ---------- */
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const mode = dragRef.current;
      if (!mode) return;
      if (mode === "left") {
        patch({ leftW: clamp(e.clientX - 44, LIMITS.leftW) });
      } else if (mode === "right") {
        patch({ rightW: clamp(window.innerWidth - e.clientX, LIMITS.rightW) });
      } else {
        const rect = rootRef.current?.getBoundingClientRect();
        if (rect) patch({ bottomH: clamp(rect.bottom - e.clientY, LIMITS.bottomH), bottomOpen: true });
      }
    };
    const onUp = () => {
      setDragging(null);
      dragRef.current = null;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.classList.add("compiler-resizing"); // 复用：拖拽期间禁用过渡
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("compiler-resizing");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const startDrag = (mode) => (e) => {
    e.preventDefault();
    dragRef.current = mode;
    setDragging(mode);
  };

  if (!prefs) return <div className="ide-fullbleed h-[calc(100dvh-3.5rem)]" aria-busy="true" />;

  const bottomTab = prefs.bottomTab || "terminal";
  const ciCount = Array.isArray(ciRuns) ? ciRuns.length : 0;

  return (
    <div
      ref={rootRef}
      className="ide-fullbleed flex flex-col"
      style={{
        height: "calc(100dvh - 3.5rem)", // 顶栏 h-14（56px；border 1px 由下一行抵消）
        marginTop: "-1px",
        paddingBottom: "1px",
        "--ide-left": panelW(prefs.leftW, "left"),
        "--ide-right": panelW(prefs.rightW, "right"),
        "--ide-bottom": prefs.bottomOpen ? `${prefs.bottomH}px` : "0px",
      }}
    >
      {/* 主体行：活动栏 + IdePage（workspace 布局，含底部面板） */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* 活动栏（VS Code 式左缘图标条） */}
        <nav aria-label="IDE 视图" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r bg-muted/30 py-2">
          <ActivityBtn
            title="测试面板"
            icon={FlaskConical}
            active={leftVisible()}
            onClick={() => patch({ leftW: leftVisible() ? 0 : DEFAULTS.leftW })}
          />
          <ActivityBtn
            title="终端"
            icon={TerminalSquare}
            active={prefs.bottomOpen && bottomTab === "terminal"}
            onClick={() => patch({ bottomOpen: !(prefs.bottomOpen && bottomTab === "terminal"), bottomTab: "terminal" })}
          />
          <ActivityBtn
            title="CI 日志"
            icon={PanelBottom}
            active={prefs.bottomOpen && bottomTab === "ci"}
            onClick={() => patch({ bottomOpen: !(prefs.bottomOpen && bottomTab === "ci"), bottomTab: "ci" })}
          />
          <ActivityBtn
            title="文件管理器"
            icon={Files}
            active={rightVisible()}
            onClick={() => patch({ rightW: rightVisible() ? 0 : DEFAULTS.rightW })}
          />
          <ActivityBtn title="AI 对话" icon={Bot} active={chatOpen} onClick={() => setChatOpen((v) => !v)} className="mt-auto" />
        </nav>

        {/* 左缘拖拽手柄（测试面板右边界）+ 右缘手柄由 IdePage 内部面板宽度变化自然承接；
            拖拽手柄挂在外壳层：左面板右缘、右面板左缘、底部面板上缘 */}
        <div className="relative flex min-w-0 flex-1">
          {leftVisible() && (
            <div
              role="separator"
              aria-orientation="vertical"
              className="hover:bg-primary/40 absolute top-0 bottom-0 z-20 w-1 cursor-col-resize"
              style={{ left: "calc(var(--ide-left) - 2px)" }}
              onPointerDown={startDrag("left")}
              onDoubleClick={() => patch({ leftW: DEFAULTS.leftW })}
              title="拖动调整宽度，双击恢复"
            />
          )}
          {rightVisible() && (
            <div
              role="separator"
              aria-orientation="vertical"
              className="hover:bg-primary/40 absolute top-0 bottom-0 right-0 z-20 w-1 cursor-col-resize"
              onPointerDown={startDrag("right")}
              onDoubleClick={() => patch({ rightW: DEFAULTS.rightW })}
              title="拖动调整宽度，双击恢复"
            />
          )}
          {prefs.bottomOpen && (
            <div
              role="separator"
              aria-orientation="horizontal"
              className="hover:bg-primary/40 absolute inset-x-0 z-20 h-1 cursor-row-resize"
              style={{ bottom: "calc(var(--ide-bottom) - 2px)" }}
              onPointerDown={startDrag("bottom")}
              onDoubleClick={() => patch({ bottomH: DEFAULTS.bottomH })}
              title="拖动调整高度，双击恢复"
            />
          )}

          {/* 全部状态与面板的唯一中枢（测试面板/编辑器/文件/底部区域） */}
          <IdePage
            layout="workspace"
            activeBottomTab={prefs.bottomOpen ? bottomTab : "terminal"}
            ciSlot={<CiLogPanel runs={ciCount ? ciRuns : []} actionsUrl={ciActionsUrl} />}
          />
        </div>
      </div>

      {/* AI 对话浮窗（与题目页同一组件；IDE 页无题目 → scope='global'） */}
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );

  function clamp(n, [min, max]) {
    return Math.min(max, Math.max(min, n));
  }
  function leftVisible() {
    return prefs.leftW > 0;
  }
  function rightVisible() {
    return prefs.rightW > 0;
  }
}

function ActivityBtn({ title, icon: Icon, active, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`text-muted-foreground hover:text-foreground relative flex h-11 w-full items-center justify-center transition-colors ${
        active ? "text-foreground bg-accent/70" : ""
      } ${className}`}
    >
      {active && <span className="bg-primary absolute left-0 h-5 w-0.5 rounded-r" />}
      <Icon className="size-4.5" />
    </button>
  );
}
