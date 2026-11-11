"use client";

/**
 * 样例管理（CPH 式，/ide 侧栏「样例」视图）：
 *  - 样例集按「当前文件」绑定（lib/ide-samples），切换文件即切换样例；
 *  - 导入：搜索题库并导入题目样例（同时绑定题目，供「题面」视图与 AI 上下文）；
 *  - 自建：新增 / 编辑（输入、期望输出可直接改）/ 删除 / 清空；
 *  - 运行全部 / 单个，结果徽章 + 耗时，失败时展示首个差异与期望/实际对照。
 */

import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  ListX,
  LoaderCircle,
  Play,
  Plus,
  Search,
  Trash2,
  Unlink,
} from "lucide-react";
import { Spinner } from "@/components/ui/LoadingOverlay";
import DiffView from "@/components/ide/DiffView";
import { ActionButton, FileIcon, ViewHeader } from "@/components/ide/vsc";

const VERDICT_LABEL = { AC: "通过", WA: "答案错误", RE: "运行时错误", TE: "超时" };

export function VerdictIcon({ verdict, running, className = "size-4" }) {
  if (running) return <LoaderCircle className={`${className} animate-spin text-[color:var(--vsc-info)]`} strokeWidth={1.75} />;
  if (verdict === "AC") return <CircleCheck className={`${className} text-[color:var(--vsc-success)]`} strokeWidth={1.75} />;
  if (verdict === "TE") return <Clock className={`${className} text-[color:var(--vsc-warning)]`} strokeWidth={1.75} />;
  if (verdict) return <CircleX className={`${className} text-[color:var(--vsc-error)]`} strokeWidth={1.75} />;
  return <CircleDashed className={`${className} opacity-50`} strokeWidth={1.75} />;
}

function IoEdit({ label, value, onChange, readOnly }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[11px] opacity-70">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        className="w-full resize-y rounded-md border px-2 py-1 font-mono text-[12px] leading-[18px] outline-none focus:border-[color:var(--vsc-accent)]"
        style={{ background: "var(--vsc-input)", borderColor: "var(--vsc-input-border)", color: "var(--vsc-fg)" }}
      />
    </label>
  );
}

/** 题库搜索框（导入样例用）。 */
function ProblemSearch({ onPick }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const s = q.trim();
    if (!s) {
      setItems([]);
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/problems?q=${encodeURIComponent(s)}`);
        setItems((await res.json()).items ?? []);
      } catch {
        setItems([]);
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === "Escape" && (setQ(""), setOpen(false))}
        placeholder="搜索题库导入样例（题号 / 关键词）"
        aria-label="搜索题目"
        className="vsc-input !pr-6"
      />
      {busy ? (
        <Spinner className="absolute top-1/2 right-1.5 size-3 -translate-y-1/2" />
      ) : (
        <Search className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 opacity-60" strokeWidth={1.5} />
      )}
      {open && q.trim() && !busy && (
        <div
          className="absolute inset-x-0 top-[28px] z-30 max-h-72 overflow-auto rounded-md border py-0.5 shadow-lg"
          style={{ background: "var(--vsc-widget)", borderColor: "var(--vsc-widget-border)" }}
        >
          {items.length ? (
            items.map((r) => (
              <button
                key={`${r.platform}:${r.id}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQ("");
                  setOpen(false);
                  onPick(r);
                }}
                className="flex h-6 w-full items-center gap-2 px-2 text-left text-[12px] hover:bg-[color:var(--vsc-hover)]"
              >
                <span className="font-mono text-[11px] text-[color:var(--vsc-info)]">{r.id}</span>
                <span className="min-w-0 flex-1 truncate">{r.titleZh || r.title}</span>
                <span className="text-[10px] uppercase opacity-60">{r.platform}</span>
              </button>
            ))
          ) : (
            <p className="px-2 py-1 text-[12px] opacity-70">没有匹配的题目</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SamplesPanel({
  filePath,
  fileLang,
  set, // {problem, cases}
  onChangeCases,
  onImportProblem, // (searchItem) => Promise
  onUnbindProblem,
  importing,
  results, // [{index, verdict, ...}]
  running,
  stage,
  onRunAll,
  onRunOne,
  onClearResults,
}) {
  const [expanded, setExpanded] = useState({});
  const [runningIdx, setRunningIdx] = useState(null);
  const cases = set.cases;

  useEffect(() => setExpanded({}), [filePath]);
  useEffect(() => {
    if (!running) setRunningIdx(null);
  }, [running]);
  useEffect(() => {
    const failed = results.filter((c) => c.verdict && c.verdict !== "AC").map((c) => c.index);
    if (failed.length) setExpanded((p) => ({ ...p, ...Object.fromEntries(failed.map((i) => [i, true])) }));
  }, [results]);

  const passCount = results.filter((c) => c.verdict === "AC").length;
  const failCount = results.filter((c) => c.verdict && c.verdict !== "AC").length;

  const editCase = (i, patch) => onChangeCases(cases.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addCase = () => {
    onChangeCases([...cases, { input: "", output: "" }]);
    setExpanded((p) => ({ ...p, [cases.length]: true }));
  };
  const removeCase = (i) => onChangeCases(cases.filter((_, j) => j !== i));

  const runAll = () => {
    setRunningIdx(-1);
    onRunAll(cases);
  };
  const runOne = (i) => {
    setRunningIdx(i);
    onRunOne(i, cases);
  };

  if (!filePath) {
    return (
      <section aria-label="样例" className="flex h-full flex-col">
        <ViewHeader title="样例" />
        <p className="px-4 py-2 text-[12px] leading-5 opacity-70">先在文件管理中打开一个文件——样例按文件绑定。</p>
      </section>
    );
  }

  return (
    <section aria-label="样例" className="flex h-full min-w-0 flex-col overflow-hidden">
      <ViewHeader
        title="样例"
        actions={
          <>
            <ActionButton icon={Play} title="运行全部样例 (⌘Enter)" onClick={runAll} disabled={running || !cases.length} />
            <ActionButton icon={Plus} title="新建样例" onClick={addCase} />
            <ActionButton icon={ListX} title="清除运行结果" onClick={onClearResults} disabled={!results.length || running} />
          </>
        }
      />

      {/* 绑定信息 */}
      <div className="shrink-0 space-y-2 px-3 pb-2">
        <div className="flex h-5 items-center gap-1.5 text-[12px] opacity-80" title="样例与该文件绑定">
          <FileIcon lang={fileLang} name={filePath} />
          <span className="truncate font-mono">{filePath}</span>
        </div>
        {set.problem ? (
          <div className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]" style={{ borderColor: "var(--vsc-border)" }}>
            <span className="font-mono text-[11px] text-[color:var(--vsc-info)]">{set.problem.id}</span>
            <span className="min-w-0 flex-1 truncate">{set.problem.titleZh || set.problem.title}</span>
            <ActionButton icon={Unlink} title="解除题目绑定（保留样例）" onClick={onUnbindProblem} />
          </div>
        ) : null}
        <ProblemSearch onPick={onImportProblem} />
        {importing && (
          <p className="flex items-center gap-1.5 text-[12px] opacity-80">
            <Spinner className="size-3" /> 正在导入样例…
          </p>
        )}
      </div>

      {/* 样例列表 */}
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {!cases.length && (
          <div className="px-2 py-3 text-[12px] leading-5 opacity-75">
            <p>这个文件还没有样例。</p>
            <p className="mt-1">在上方搜索题库导入，或手动新建。</p>
            <button type="button" className="vsc-btn mt-3 w-full" onClick={addCase}>
              <Plus className="size-3.5" /> 新建样例
            </button>
          </div>
        )}
        <ul className="space-y-1.5">
          {cases.map((s, i) => {
            const r = results.find((x) => x.index === i);
            const open = !!expanded[i];
            const isRunning = running && (runningIdx === i || (runningIdx === -1 && !r));
            return (
              <li key={i} className="rounded-md border" style={{ borderColor: "var(--vsc-border)", background: "var(--vsc-editor)" }}>
                <div
                  className="group flex h-8 cursor-pointer items-center gap-1.5 pr-1 pl-1.5 text-[13px]"
                  onClick={() => setExpanded((p) => ({ ...p, [i]: !p[i] }))}
                >
                  {open ? <ChevronDown className="size-4 shrink-0 opacity-70" strokeWidth={1.5} /> : <ChevronRight className="size-4 shrink-0 opacity-70" strokeWidth={1.5} />}
                  <VerdictIcon verdict={r?.verdict} running={isRunning} />
                  <span className="min-w-0 flex-1 truncate">
                    样例 {i + 1}
                    {r?.verdict && <span className="ml-1.5 text-[11px] opacity-70">{VERDICT_LABEL[r.verdict] ?? r.verdict}</span>}
                  </span>
                  {r?.elapsedMs != null && <span className="text-[11px] tabular-nums opacity-60">{r.elapsedMs}ms</span>}
                  <span className="flex" onClick={(e) => e.stopPropagation()}>
                    <ActionButton icon={Play} title="运行此样例" onClick={() => runOne(i)} disabled={running} />
                    <ActionButton icon={Trash2} title="删除此样例" onClick={() => removeCase(i)} className="opacity-0 group-hover:opacity-100" />
                  </span>
                </div>
                {open && (
                  <div className="space-y-2 border-t px-2.5 py-2" style={{ borderColor: "var(--vsc-border)" }}>
                    {r?.note && <p className="text-[12px] text-[color:var(--vsc-error)]">{r.note}</p>}
                    <IoEdit label="输入" value={s.input} onChange={(v) => editCase(i, { input: v })} />
                    <IoEdit label="期望输出" value={s.output} onChange={(v) => editCase(i, { output: v })} />
                    {r && r.verdict !== "AC" && <DiffView result={r} compact />}
                    {r?.verdict === "AC" && <IoEdit label="实际输出" value={r.actual ?? ""} readOnly />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {cases.length > 0 && (
          <button
            type="button"
            onClick={addCase}
            className="mt-1.5 flex h-7 w-full items-center justify-center gap-1 rounded-md border border-dashed text-[12px] opacity-70 hover:opacity-100"
            style={{ borderColor: "var(--vsc-border)" }}
          >
            <Plus className="size-3.5" /> 新建样例
          </button>
        )}
      </div>

      {/* 汇总 */}
      {cases.length > 0 && (
        <div className="flex h-8 shrink-0 items-center gap-3 border-t px-3 text-[12px]" style={{ borderColor: "var(--vsc-border)" }}>
          {running ? (
            <span className="flex min-w-0 items-center gap-1.5 truncate">
              <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} /> {stage || "运行中…"}
            </span>
          ) : results.length ? (
            <>
              <span className="flex items-center gap-1">
                <CircleCheck className="size-3.5 text-[color:var(--vsc-success)]" strokeWidth={1.75} />
                {passCount}
              </span>
              <span className="flex items-center gap-1">
                <CircleX className="size-3.5 text-[color:var(--vsc-error)]" strokeWidth={1.75} />
                {failCount}
              </span>
              <span className="opacity-70">
                {passCount}/{cases.length} 通过
              </span>
            </>
          ) : (
            <span className="opacity-70">{cases.length} 个样例 · 尚未运行</span>
          )}
          {!running && (
            <button type="button" className="vsc-btn ml-auto !h-6 !px-2.5 !text-[12px]" onClick={runAll} disabled={!cases.length}>
              <Play className="size-3" /> 全部运行
            </button>
          )}
        </div>
      )}
    </section>
  );
}

