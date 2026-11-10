"use client";

/**
 * CPH 风格测试面板（/ide 左栏）：题目搜索选择（/api/problems）→ 全量题面
 * （/api/problems/<platform>/<problemId>）→ 样例列表 = 题目 samples 合并
 * 自定义样例（ysc-cp-samples-<code>）→ 运行全部 / 运行单个（父组件注入的
 * 运行链，与 CompilerDock 同一 wasm-clang / Pyodide 客户端）→ 结果卡
 * （verdict 徽章 + 耗时 + WA diff）。
 */

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Play, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/LoadingOverlay";
import { loadSampleCases } from "@/lib/compiler/samples";
import DiffView from "@/components/ide/DiffView";

const VERDICT_STYLES = {
  AC: "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400",
  WA: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  RE: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  TE: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

function verdictBadge(v) {
  const label = { AC: "通过", WA: "答案错误", RE: "运行时错误", TE: "超时" }[v] ?? v;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${VERDICT_STYLES[v] ?? "text-muted-foreground border-border"}`}
    >
      {v === "AC" ? <CheckCircle2 className="size-3" /> : v ? <XCircle className="size-3" /> : null}
      {v} · {label}
    </span>
  );
}

export default function TestPanel({
  problem,
  onProblemChange,
  cases,
  running,
  stage,
  onRunAll,
  onRunOne,
  timeoutSec = 10,
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // 自定义样例（localStorage，按题存储）：null = 未自定义
  const [custom, setCustom] = useState(null);
  const customKeyRef = useRef(null);

  // 搜索防抖
  useEffect(() => {
    const q = query.trim();
    if (!listOpen) return;
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/problems?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(data.items ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, listOpen]);

  // 切题时读取该题的自定义样例
  useEffect(() => {
    const key = problem ? `${problem.platform}:${problem.id}` : null;
    customKeyRef.current = key;
    setCustom(problem ? loadSampleCases(problem.id) : null);
  }, [problem]);

  // 样例列表 = 题目默认样例，自定义表存在时优先
  const defaultCases = (problem?.samples ?? []).map((s) => ({
    input: String(s?.input ?? ""),
    output: String(s?.output ?? ""),
  }));
  const samples = custom ?? defaultCases;

  const selectProblem = async (item) => {
    setListOpen(false);
    setQuery("");
    setLoading(true);
    try {
      const res = await fetch(`/api/problems/${item.platform}/${encodeURIComponent(item.id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onProblemChange(await res.json());
    } catch {
      onProblemChange(null);
    } finally {
      setLoading(false);
    }
  };

  const passCount = cases.filter((c) => c.verdict === "AC").length;

  return (
    <section
      aria-label="测试面板"
      className="flex max-h-[75vh] min-w-0 flex-col overflow-hidden rounded-lg border lg:max-h-[calc(100dvh-8rem)] lg:sticky lg:top-[4.5rem]"
    >
      <div className="border-b px-3 py-2 text-xs font-semibold tracking-wide">测试面板</div>

      {/* 题目选择器 */}
      <div className="border-b px-3 py-2">
        {problem ? (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] uppercase">
                {problem.platform}
              </span>
              <p className="min-w-0 truncate text-sm font-medium">{problem.titleZh || problem.title}</p>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {problem.id}
              {problem.timeLimitMs ? ` · ${problem.timeLimitMs / 1000}s` : ""}
              {problem.memoryLimitMb ? ` · ${problem.memoryLimitMb}MB` : ""}
              {" · "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => onProblemChange(null)}
              >
                换一题
              </button>
            </p>
          </div>
        ) : (
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setListOpen(true);
              }}
              onFocus={() => setListOpen(true)}
              placeholder="搜索题目（关键词 / 题号）"
              className="h-8 pl-7 text-xs"
              aria-label="搜索题目"
            />
            {(listOpen && (query.trim() || searching)) && (
              <div className="bg-popover absolute top-9 z-20 max-h-72 w-full overflow-auto rounded-md border shadow-lg">
                {searching ? (
                  <p className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-xs">
                    <Spinner className="size-3" /> 搜索中…
                  </p>
                ) : results.length ? (
                  results.map((r) => (
                    <button
                      key={`${r.platform}:${r.id}`}
                      type="button"
                      onClick={() => selectProblem(r)}
                      className="hover:bg-accent block w-full px-3 py-1.5 text-left text-xs"
                    >
                      <span className="text-muted-foreground mr-1.5">{r.platform}</span>
                      <span className="mr-1 font-mono">{r.id}</span>
                      {r.titleZh || r.title}
                    </button>
                  ))
                ) : (
                  <p className="text-muted-foreground px-3 py-2 text-xs">没有匹配的题目</p>
                )}
              </div>
            )}
            <p className="text-muted-foreground mt-2 text-xs leading-5">
              还没有选择题目。搜索并载入一道题，样例会自动进入下方列表；也可以直接用终端运行当前文件。
            </p>
          </div>
        )}
        {loading && (
          <p className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
            <Loader2 className="size-3 animate-spin" /> 题面加载中…
          </p>
        )}
      </div>

      {/* 样例列表 + 运行按钮 */}
      <div className="flex-1 overflow-auto px-3 py-2">
        {problem ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                {custom ? "自定义样例" : "题目样例"} · {samples.length} 个
              </p>
              <Button
                size="sm"
                className="h-7 px-2.5 text-xs"
                disabled={running || !samples.length}
                onClick={() => onRunAll(samples)}
              >
                {running ? <Spinner className="size-3" /> : <Play className="size-3" />}
                运行全部
              </Button>
            </div>
            {stage && running && <p className="text-muted-foreground mb-2 text-xs">{stage}</p>}
            {!samples.length && (
              <p className="text-muted-foreground text-xs">该题没有样例数据。</p>
            )}
            <ul className="space-y-2">
              {samples.map((s, i) => {
                const c = cases.find((x) => x.index === i);
                return (
                  <li key={i} className="rounded-md border p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">样例 {i + 1}</span>
                      <div className="flex items-center gap-1.5">
                        {c ? (
                          <>
                            {verdictBadge(c.verdict)}
                            {c.elapsedMs != null && (
                              <span className="text-muted-foreground text-[11px]">
                                {(c.elapsedMs / 1000).toFixed(2)}s
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">未测试</span>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-1.5 text-[11px]"
                          disabled={running}
                          onClick={() => onRunOne(i, samples)}
                          title="只运行这一个样例"
                        >
                          <Play className="size-2.5" />
                          单个
                        </Button>
                      </div>
                    </div>
                    {c?.note && <p className="text-muted-foreground mt-1 leading-5">{c.note}</p>}
                    {c && <DiffView result={c} />}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground text-xs leading-5">
            样例对拍需要先选择题目。运行结果会显示 verdict 徽章与耗时，WA 时可展开期望 / 实际输出的差异对比。
          </p>
        )}
      </div>

      {/* 汇总 */}
      {problem && cases.length > 0 && (
        <div className="border-t px-3 py-2 text-xs">
          通过 {passCount}/{cases.length}
          {passCount === cases.length && " 🎉"}
        </div>
      )}
    </section>
  );
}
