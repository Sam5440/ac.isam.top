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
import { Braces, ChevronRight, Expand, Maximize, Minimize, PanelLeft, Play, Save, Shrink, Square, X } from "lucide-react";
import { ActionButton, FileIcon } from "@/components/ide/vsc";
import TabList from "@/components/ide/TabList";

const CodeEditor = dynamic(() => import("@/components/compiler/CodeEditor"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-[13px] opacity-60">编辑器加载中…</div>,
});

const MarkdownEditor = dynamic(() => import("@/components/ide/MarkdownEditor"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-[13px] opacity-60">Markdown 工作台加载中…</div>,
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
  onCloseMany,
  pinnedPath = null,
  onTogglePin,
  verticalTabs = false,
  onToggleVerticalTabs,
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
  onClose,
  wordWrap = true,
  onToggleWordWrap,
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
      {!verticalTabs && (
        <div className="flex h-[35px] shrink-0" style={{ background: "var(--vsc-tabs)" }}>
          <TabList
            openPaths={openPaths}
            files={files}
            activePath={activePath}
            pinnedPath={pinnedPath}
            onSelect={onSelectTab}
            onClose={onCloseTab}
            onCloseMany={onCloseMany}
            onTogglePin={onTogglePin}
            isDirty={isDirty}
          />
          {/* 只负责把标签栏底部边框延伸到操作按钮前：固定 16px，不能与
              上面的 TabList 同时 flex-1，否则两者各分一半剩余宽度，标签区
              会被压窄、右侧留出一条空挡（看起来像遮挡条）。 */}
          <span className="w-4 shrink-0 border-b" style={{ borderColor: "var(--vsc-border)" }} />
          {/* 编辑器标题动作 */}
          <div className="flex shrink-0 items-center gap-0.5 border-b px-2" style={{ borderColor: "var(--vsc-border)" }}>
            {onToggleVerticalTabs && (
              <ActionButton
                icon={PanelLeft}
                title={verticalTabs ? "标签栏改为顶部横排" : "标签栏改为左侧竖排"}
                onClick={onToggleVerticalTabs}
                active={verticalTabs}
              />
            )}
            {showRun &&
              (running ? (
                <ActionButton icon={Square} title="停止运行" onClick={onStop} className="text-[color:var(--vsc-error)]" />
              ) : (
                <ActionButton icon={Play} title="运行当前文件 (F5)" onClick={onRun} disabled={!activePath} className="text-[color:var(--vsc-success)]" />
              ))}
            <ActionButton icon={Save} title={`保存 (${MOD}S)`} onClick={onSave} disabled={!activePath} />
            {onToggleWordWrap && (
              <ActionButton
                icon={Braces}
                title={wordWrap ? "关闭自动换行" : "开启自动换行"}
                onClick={onToggleWordWrap}
                active={wordWrap}
              />
            )}
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
            {onClose && (
              <ActionButton icon={X} title="关闭 IDE 面板" onClick={onClose} />
            )}
          </div>
        </div>
      )}

      {activePath ? (
        <div className={verticalTabs ? "flex min-h-0 flex-1" : "contents"}>
          {verticalTabs && (
            <div
              className="flex w-[190px] shrink-0 flex-col border-r"
              style={{ background: "var(--vsc-tabs)", borderColor: "var(--vsc-border)" }}
            >
              <div className="flex h-[26px] shrink-0 items-center justify-between px-2 text-[11px] tracking-wide uppercase opacity-70">
                <span>已打开的编辑器</span>
                {onToggleVerticalTabs && (
                  <ActionButton icon={PanelLeft} title="标签栏改为顶部横排" onClick={onToggleVerticalTabs} active />
                )}
              </div>
              <TabList
                openPaths={openPaths}
                files={files}
                activePath={activePath}
                pinnedPath={pinnedPath}
                onSelect={onSelectTab}
                onClose={onCloseTab}
                onCloseMany={onCloseMany}
                onTogglePin={onTogglePin}
                isDirty={isDirty}
                orientation="vertical"
                className="min-h-0 flex-1"
              />
            </div>
          )}
          <div className="flex min-w-0 min-h-0 flex-1 flex-col">
          {/* 面包屑：单行显示，长路径只截断目录段，文件名优先保留 */}
          <nav aria-label="面包屑" className="flex h-[22px] shrink-0 items-center gap-0.5 overflow-hidden px-3 text-[13px] opacity-80" style={{ background: "var(--vsc-editor)" }}>
            <span className="shrink-0">工作区</span>
            {(() => {
              const parts = activePath.split("/");
              const file = parts.pop();
              const dir = parts.join("/");
              return (
                <>
                  {dir ? (
                    <>
                      <ChevronRight className="size-3.5 shrink-0 opacity-70" strokeWidth={1.5} />
                      <span className="min-w-0 truncate" title={dir}>{dir}</span>
                    </>
                  ) : null}
                  <ChevronRight className="size-3.5 shrink-0 opacity-70" strokeWidth={1.5} />
                  <FileIcon lang={active?.lang} name={file} />
                  <span className="min-w-0 truncate" title={activePath}>{file}</span>
                </>
              );
            })()}
          </nav>
          <div className="min-h-0 flex-1">
            {lang === "markdown" ? (
              <MarkdownEditor
                value={code}
                onChange={onChange}
                filePath={activePath}
                theme={theme}
                diagnostics={diagnostics}
                getAi={getAi}
                onAiStatus={onAiStatus}
                onCursor={onCursor}
              />
            ) : (
              <CodeEditor
                language={lang}
                value={code}
                onChange={onChange}
                wordWrap={wordWrap}
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
            )}
          </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <Watermark onNewFile={onNewFile} />
        </div>
      )}
    </section>
  );
}
