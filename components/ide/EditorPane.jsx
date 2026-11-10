"use client";

/**
 * 多标签 Monaco 编辑器（/ide 中栏）：复用 components/compiler/CodeEditor
 * （主题 / 诊断 / clang 补全 / AI ghost text 注入链一致）。Tab 条来自工作区
 * 文件列表，激活文件内容双向绑定到父组件状态；Ctrl/⌘S 由 IdePage 全局接管。
 */

import dynamic from "next/dynamic";
import { X } from "lucide-react";

const CodeEditor = dynamic(() => import("@/components/compiler/CodeEditor"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-xs text-muted-foreground">
      编辑器加载中…
    </div>
  ),
});

const LANG_LABEL = { cpp: "C++", python: "Python" };

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
}) {
  const fileOf = (path) => files.find((f) => f.path === path);

  return (
    <section
      aria-label="代码编辑器"
      className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-lg border lg:h-[calc(100dvh-8rem)] lg:sticky lg:top-[4.5rem]"
    >
      {/* Tab 条 */}
      <div className="flex items-center overflow-x-auto border-b">
        {openPaths.length === 0 && (
          <span className="text-muted-foreground px-3 py-1.5 text-xs">没有打开的文件</span>
        )}
        {openPaths.map((path) => {
          const f = fileOf(path);
          const active = path === activePath;
          return (
            <div
              key={path}
              className={`group flex shrink-0 items-center gap-1.5 border-r px-3 py-1.5 text-xs ${
                active ? "bg-muted/60 text-foreground font-medium" : "text-muted-foreground hover:bg-accent/60"
              }`}
            >
              <button type="button" onClick={() => onSelectTab(path)} className="max-w-40 truncate">
                {f ? f.name : path}
                {f && f.lang === "python" && <span className="ml-1 opacity-60">py</span>}
              </button>
              <button
                type="button"
                onClick={() => onCloseTab(path)}
                aria-label={`关闭 ${path}`}
                className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* 编辑器主体 */}
      {activePath ? (
        <>
          <div className="flex-1 min-h-0">
            <CodeEditor
              language={lang}
              value={code}
              onChange={onChange}
              diagnostics={diagnostics}
              theme={theme}
            />
          </div>
          <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-3 py-1 text-[11px]">
            <span className="truncate font-mono">{activePath}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span>{LANG_LABEL[lang] ?? lang}</span>
              <button
                type="button"
                onClick={onSave}
                className="underline underline-offset-2 hover:text-foreground"
                title="保存到工作区（Ctrl/⌘S）"
              >
                保存
              </button>
            </span>
          </div>
        </>
      ) : (
        <div className="text-muted-foreground grid flex-1 place-items-center text-sm">
          从右侧文件管理器新建或打开一个文件
        </div>
      )}
    </section>
  );
}
