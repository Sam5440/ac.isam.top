"use client";

/**
 * WA 差异视图：渲染 judgeCase 返回的 expected / actual / diff。
 * 高亮首个不一致的行（{line, expected, actual}），上下文保留完整输出（已截断）。
 */

import { useState } from "react";

function Block({ label, text, tone }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-muted-foreground mb-1 text-[11px] font-medium">{label}</p>
      <pre
        className={`max-h-56 overflow-auto rounded-md border p-2 font-mono text-xs leading-5 whitespace-pre-wrap ${
          tone === "expected"
            ? "border-green-500/30 bg-green-500/5"
            : "border-red-500/30 bg-red-500/5"
        }`}
      >
        {text || "（空）"}
      </pre>
    </div>
  );
}

export default function DiffView({ result }) {
  const [raw, setRaw] = useState(false);
  if (!result || result.verdict === "AC") return null;
  const { diff, expected, actual } = result;

  return (
    <div className="mt-2 space-y-2">
      {diff && (
        <div className="text-warning-foreground rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs">
          首个不一致：第 {diff.line} 行
          <span className="ml-2 font-mono">
            期望 <span className="text-green-600 dark:text-green-400">{JSON.stringify(diff.expected)}</span>
            {"  "}实际 <span className="text-red-600 dark:text-red-400">{JSON.stringify(diff.actual)}</span>
          </span>
          <button
            type="button"
            onClick={() => setRaw((v) => !v)}
            className="text-muted-foreground ml-2 underline underline-offset-2 hover:text-foreground"
          >
            {raw ? "收起全文" : "查看全文"}
          </button>
        </div>
      )}
      {raw && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Block label="期望输出" text={expected} tone="expected" />
          <Block label="实际输出" text={actual} tone="actual" />
        </div>
      )}
    </div>
  );
}
