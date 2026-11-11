"use client";

/**
 * 终端面板（/ide 底部）：运行输出（stdout/stderr/编译诊断混排，等宽暗底）
 * + stdin 文本域（「运行」把内容整体作为 stdin 喂入；交互等待时逐行送入，
 * 同 CompilerDock 交互路径）+ 清屏 / 终止。
 */

import { useEffect, useRef, useState } from "react";
import { Eraser, Play, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/LoadingOverlay";

export default function TerminalPane({
  text,
  stage,
  running,
  waitingInput,
  stdin,
  onStdinChange,
  onRun,
  onSendLine,
  onSendEof,
  onStop,
  onClear,
  consoleRef,
  fill = false, // true：铺满布局（h-full 无边框）
}) {
  const [line, setLine] = useState("");
  const outRef = useRef(null);

  // 输出增长时贴底
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <section
      aria-label="终端"
      className={
        fill
          ? "flex h-full min-h-0 flex-col overflow-hidden"
          : "flex min-h-[240px] flex-col overflow-hidden rounded-lg border"
      }
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold tracking-wide">
          终端
          {running && (
            <span className="text-muted-foreground flex items-center gap-1.5 font-normal">
              <Spinner className="size-3" />
              {stage || "运行中…"}
            </span>
          )}
          {waitingInput && (
            <span className="text-amber-500 font-normal">等待输入（在下方逐行送入，空行 = EOF）</span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={running} onClick={onRun}>
            {running ? <Spinner className="size-3" /> : <Play className="size-3" />}
            运行
          </Button>
          {running && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onStop}>
              <Square className="size-3" />
              终止
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClear} title="清屏">
            <Eraser className="size-3" />
            清屏
          </Button>
        </span>
      </div>

      <div className="grid flex-1 min-h-0 grid-rows-[minmax(8rem,1fr)_auto] lg:grid-cols-2 lg:grid-rows-1 lg:divide-x">
        {/* 输出（暗底等宽） */}
        <pre
          ref={(el) => {
            outRef.current = el;
            if (typeof consoleRef === "object" && consoleRef) consoleRef.current = el;
          }}
          className="m-0 overflow-auto bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-100 whitespace-pre-wrap"
          aria-live="polite"
        >
          {text || "输出会显示在这里：编译诊断、程序 stdout/stderr、对拍进度。\n"}
        </pre>

        {/* stdin 区 */}
        <div className="flex min-h-0 flex-col gap-2 border-t p-3 lg:border-t-0">
          <label className="text-muted-foreground text-[11px] font-medium" htmlFor="ide-stdin">
            stdin（「运行」时整体作为标准输入喂给程序）
          </label>
          <textarea
            id="ide-stdin"
            value={stdin}
            onChange={(e) => onStdinChange(e.target.value)}
            placeholder={"3\n1 2 3"}
            spellCheck={false}
            className="min-h-20 flex-1 resize-none rounded-md border bg-transparent p-2 font-mono text-xs placeholder:text-muted-foreground"
          />
          {/* 交互等待时的逐行送入 */}
          <div className="flex gap-1.5">
            <input
              value={line}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && waitingInput) {
                  onSendLine(line);
                  setLine("");
                }
              }}
              disabled={!waitingInput}
              placeholder={waitingInput ? "输入一行后回车送入…" : "程序等待输入时可在此逐行送入"}
              aria-label="交互输入"
              className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-xs disabled:opacity-50 placeholder:text-muted-foreground"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={!waitingInput}
              onClick={() => {
                onSendLine(line);
                setLine("");
              }}
              title="送入一行"
            >
              <Send className="size-3" />
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!waitingInput} onClick={onSendEof}>
              EOF
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
