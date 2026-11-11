"use client";

/**
 * 编辑器组（VS Code 式）：
 *  - 35px 标签栏：活动标签顶部强调色描边、与编辑器同底；未保存显示 ●，悬停变 ×；
 *    中键关闭；右侧「运行」「保存」编辑器标题动作；
 *  - 面包屑（工作区 › 文件）；
 *  - Monaco（components/compiler/CodeEditor，主题 / 诊断 / clang 补全 / AI ghost 链一致）；
 *  - 无打开文件时显示 VS Code 式水印（快捷键提示）。
 * 光标位置经 onCursor 上报给状态栏。
 */

import dynamic from "next/dynamic";
import { Braces, ChevronRight, Expand, Maximize, Minimize, Play, Save, Shrink, Square, X } from "lucide-react";
import { ActionButton, FileIcon } from "@/components/ide/vsc";

const CodeEditor = dynamic(() => import("@/components/compiler/CodeEditor"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-[13px] opacity-60">编辑器加载中…</div>,
});

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
const MOD = isMac ? "⌘" : "Ctrl+";

function Watermark({ onNewFile }) {
  const rows = [
    ["新建文件", "在文件管理中"],
    ["保存", `${MOD}S`],
    ["运行当前文件", "F5"],
    ["运行全部测试", `${MOD}Enter`],
    ["切换终端", `${MOD}J`],
    ["切换左 / 右侧栏", `${MOD}B / ${MOD}⌥B`],
    ["全屏 IDE", "F11"],
  ];
  return (
    <div className="grid h-full place-items-center select-none" style={{ background: "var(--vsc-editor)" }}>
      <div className="flex flex-col items-center gap-6">
        <Braces className="size-32 opacity-[0.08]" strokeWidth={1} aria-hidden />
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-2 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-right opacity-60">{k}</dt>
              <dd>
                {k === "新建文件" ? (
                  <button type="button" onClick={onNewFile} className="text-[color:var(--vsc-info)] hover:underline">
                    {v}
                  </button>
                ) : (
                  <kbd className="rounded-[3px] border px-1.5 py-px font-sans text-[11px] opacity-80" style={{ borderColor: "var(--vsc-input-border)", background: "var(--vsc-hover)" }}>
                    {v}
                  </kbd>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export default function EditorPane({
  openPaths,
  files,
  activePath,
  onSelectTab,
  onCloseTab,
  code,
  lang,
  onChange,
  onSave,
  theme,
  diagnostics,
  getAi,
  onAiStatus,
  onCursor,
  isDirty,
  running,
  onRun,
  onStop,
  onNewFile,
  showRun = true,
  fullscreen,
  pageFullscreen,
  onToggleFullscreen,
  onTogglePageFullscreen,
}) {
  const fileOf = (path) => files.find((f) => f.path === path);
  const active = fileOf(activePath);

  return (
    <section aria-label="代码编辑器" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" style={{ background: "var(--vsc-editor)" }}>
      {/* 标签栏 */}
      {(
        <div className="flex h-[35px] shrink-0" style={{ background: "var(--vsc-tabs)" }}>
          <div className="vsc-tabs flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden" role="tablist">
            {openPaths.map((path) => {
              const f = fileOf(path);
              const isActive = path === activePath;
              const dirty = f && isDirty?.(f);
              return (
                <div
                  key={path}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={0}
                  onClick={() => onSelectTab(path)}
                  onKeyDown={(e) => e.key === "Enter" && onSelectTab(path)}
                  onAuxClick={(e) => e.button === 1 && onCloseTab(path)}
                  title={path}
                  className="group relative flex h-full max-w-56 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 border-r pr-1.5 pl-2.5 text-[13px]"
                  style={{
                    borderColor: "var(--vsc-border)",
                    background: isActive ? "var(--vsc-editor)" : "transparent",
                    color: isActive ? "var(--vsc-tab-active-fg)" : "var(--vsc-tab-inactive-fg)",
                    boxShadow: isActive ? "inset 0 1px 0 var(--vsc-accent)" : undefined,
                  }}
                >
                  {/* 活动标签底边与编辑器连通 */}
                  {!isActive && <span className="absolute inset-x-0 bottom-0 h-px" style={{ background: "var(--vsc-border)" }} />}
                  <FileIcon lang={f?.lang} name={f?.name ?? path} />
                  <span className={`truncate ${isActive ? "" : "group-hover:text-[color:var(--vsc-tab-active-fg)]"}`}>{f ? f.name : path}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(path);
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
            <span className="min-w-4 flex-1 border-b" style={{ borderColor: "var(--vsc-border)" }} />
          </div>
          {/* 编辑器标题动作 */}
          <div className="flex shrink-0 items-center gap-0.5 border-b px-2" style={{ borderColor: "var(--vsc-border)" }}>
            {showRun &&
              (running ? (
                <ActionButton icon={Square} title="停止运行" onClick={onStop} className="text-[color:var(--vsc-error)]" />
              ) : (
                <ActionButton icon={Play} title="运行当前文件 (F5)" onClick={onRun} disabled={!activePath} className="text-[color:var(--vsc-success)]" />
              ))}
            <ActionButton icon={Save} title={`保存 (${MOD}S)`} onClick={onSave} disabled={!activePath} />
            {onTogglePageFullscreen && (
              <ActionButton
                icon={pageFullscreen ? Shrink : Expand}
                title={pageFullscreen ? "退出页面内全屏 (Esc)" : "页面内全屏（铺满浏览器窗口）"}
                onClick={onTogglePageFullscreen}
                active={!!pageFullscreen}
              />
            )}
            {onToggleFullscreen && (
              <ActionButton
                icon={fullscreen ? Minimize : Maximize}
                title={fullscreen ? "退出全屏 (Esc / F11)" : "全屏（整个屏幕，F11）"}
                onClick={onToggleFullscreen}
                active={!!fullscreen}
              />
            )}
          </div>
        </div>
      )}

      {activePath ? (
        <>
          {/* 面包屑 */}
          <nav aria-label="面包屑" className="flex h-[22px] shrink-0 items-center gap-0.5 px-3 text-[13px] opacity-80" style={{ background: "var(--vsc-editor)" }}>
            <span>工作区</span>
            {activePath.split("/").map((seg, i, arr) => (
              <span key={i} className="flex items-center gap-0.5">
                <ChevronRight className="size-3.5 opacity-70" strokeWidth={1.5} />
                {i === arr.length - 1 && <FileIcon lang={active?.lang} name={seg} />}
                <span>{seg}</span>
              </span>
            ))}
          </nav>
          <div className="min-h-0 flex-1">
            <CodeEditor
              language={lang}
              value={code}
              onChange={onChange}
              diagnostics={diagnostics}
              theme={theme}
              getAi={getAi}
              onAiStatus={onAiStatus}
              onReady={(editor) => {
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
              }}
            />
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1">
          <Watermark onNewFile={onNewFile} />
        </div>
      )}
    </section>
  );
}
