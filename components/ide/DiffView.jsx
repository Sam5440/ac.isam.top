"use client";

/**
 * WA 差异视图（VS Code 测试 peek 风格）：首个不一致行提示 + 期望/实际并排，
 * 不一致行以 diff 底色（绿 = 期望，红 = 实际）高亮。
 */

function Lines({ label, text, badLine, tone }) {
  const lines = (text || "").split("\n");
  const bg = tone === "expected" ? "rgba(155,185,85,0.2)" : "rgba(255,0,0,0.2)";
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-0.5 text-[11px] uppercase opacity-70">{label}</p>
      <pre
        className="max-h-48 overflow-auto rounded-[2px] border py-1 font-mono text-[12px] leading-[18px]"
        style={{ background: "var(--vsc-input)", borderColor: "var(--vsc-input-border)" }}
      >
        {text ? (
          lines.map((l, i) => (
            <div key={i} className="flex" style={i + 1 === badLine ? { background: bg } : undefined}>
              <span className="w-7 shrink-0 pr-2 text-right opacity-50 select-none">{i + 1}</span>
              <span className="pr-2 whitespace-pre-wrap">{l || " "}</span>
            </div>
          ))
        ) : (
          <span className="px-2 opacity-60">（空）</span>
        )}
      </pre>
    </div>
  );
}

export default function DiffView({ result, compact = false }) {
  if (!result || result.verdict === "AC") return null;
  const { diff, expected, actual } = result;
  return (
    <div className="space-y-1.5">
      {diff && (
        <p className="text-[12px] leading-[18px]">
          <span className="text-[color:var(--vsc-error)]">第 {diff.line} 行不一致：</span>
          <span className="font-mono">
            期望 <span className="text-[color:var(--vsc-success)]">{JSON.stringify(diff.expected)}</span>，实际{" "}
            <span className="text-[color:var(--vsc-error)]">{JSON.stringify(diff.actual)}</span>
          </span>
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        {!compact && <Lines label="期望输出" text={expected} badLine={diff?.line} tone="expected" />}
        <Lines label="实际输出" text={actual} badLine={diff?.line} tone="actual" />
      </div>
    </div>
  );
}
