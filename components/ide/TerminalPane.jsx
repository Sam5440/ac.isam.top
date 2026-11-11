"use client";

/**
 * 终端（VS Code 集成终端式，面板「终端」标签页的主体）：
 *  - 左：输出区（终端底色、等宽 12px；编译诊断、stdout/stderr、对拍进度）；
 *    程序等待输入时，末尾出现内联输入行（Enter 送入一行，Ctrl+D = EOF）；
 *  - 右：stdin 分屏（「运行」时整体作为标准输入喂入），类似终端分屏列表。
 * 运行 / 终止 / 清屏动作由面板标题栏承载（IdePage）。
 */

import { useEffect, useRef, useState } from "react";

export default function TerminalPane({ text, waitingInput, stdin, onStdinChange, onSendLine, onSendEof, consoleRef, stdinW = 280 }) {
  const [line, setLine] = useState("");
  const outRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, waitingInput]);

  useEffect(() => {
    if (waitingInput) inputRef.current?.focus();
  }, [waitingInput]);

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div
        ref={(el) => {
          outRef.current = el;
          if (typeof consoleRef === "object" && consoleRef) consoleRef.current = el;
        }}
        className="min-w-0 flex-1 cursor-text overflow-auto px-5 py-1 font-mono text-[12px] leading-[17px]"
        style={{ background: "var(--vsc-terminal)", color: "var(--vsc-terminal-fg)" }}
        onClick={() => waitingInput && inputRef.current?.focus()}
        aria-live="polite"
      >
        <pre className="m-0 font-[inherit] whitespace-pre-wrap">
          {text || <span className="opacity-60">输出会显示在这里：编译诊断、程序 stdout/stderr、对拍进度。按 F5 运行当前文件。{"\n"}</span>}
        </pre>
        {waitingInput && (
          <div className="flex items-center">
            <span className="text-[color:var(--vsc-success)]">❯&nbsp;</span>
            <input
              ref={inputRef}
              value={line}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSendLine(line);
                  setLine("");
                } else if (e.key === "d" && e.ctrlKey) {
                  e.preventDefault();
                  onSendEof();
                }
              }}
              aria-label="交互输入"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-[inherit] outline-none"
              placeholder="程序正在等待输入 — Enter 送入一行，Ctrl+D 发送 EOF"
            />
          </div>
        )}
      </div>

      {/* stdin 分屏 */}
      <div className="hidden shrink-0 flex-col border-l sm:flex" style={{ width: stdinW, borderColor: "var(--vsc-border)", background: "var(--vsc-panel)" }}>
        <label htmlFor="ide-stdin" className="flex h-[22px] shrink-0 items-center px-2 text-[11px] uppercase opacity-80" title="「运行」时整体作为标准输入喂给程序">
          stdin
        </label>
        <textarea
          id="ide-stdin"
          value={stdin}
          onChange={(e) => onStdinChange(e.target.value)}
          placeholder={"运行时作为标准输入，例如：\n3\n1 2 3"}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none border-0 px-2 py-1 font-mono text-[12px] leading-[17px] outline-none placeholder:opacity-50 focus:shadow-[inset_0_0_0_1px_var(--vsc-accent)]"
          style={{ background: "var(--vsc-terminal)", color: "var(--vsc-terminal-fg)" }}
        />
      </div>
    </div>
  );
}
