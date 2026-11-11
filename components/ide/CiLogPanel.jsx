"use client";

/**
 * CI 日志面板（/ide 底部「CI 日志」标签页）：把 /ci 页的核心信息浓缩进
 * IDE——摘要统计卡 + 本轮抓取明细 + 未完成任务 / 下次计划 + 错误明细。
 * 数据由服务端 app/ide/page.jsx 读 data/ci-log.json 传入（最近 20 次）。
 */

import { useMemo, useState } from "react";
import { ArrowUpRight, CircleAlert, Clock, FileText, Languages, RefreshCw } from "lucide-react";

import { PlatformBadge } from "@/components/Badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/LoadingOverlay";

const STATUS_META = {
  fetched: { label: "已抓取", cls: "border-sky-500/40 bg-sky-500/10 text-sky-500" },
  translated: { label: "已翻译", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" },
  skipped: { label: "跳过", cls: "border-transparent bg-secondary text-secondary-foreground" },
  failed: { label: "失败", cls: "border-red-500/40 bg-red-500/10 text-red-500" },
};

const TRIGGER_LABEL = { schedule: "定时", workflow_dispatch: "手动", manual: "手动" };

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}时${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function Stat({ icon: Icon, label, value, tone = "" }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5">
      <Icon className={`size-3.5 shrink-0 ${tone || "text-primary"}`} />
      <div className="min-w-0 leading-tight">
        <div className="text-sm font-semibold tabular-nums">{value}</div>
        <div className="text-muted-foreground text-[10px]">{label}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? { label: status || "未知", cls: "" };
  return <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${meta.cls}`}>{meta.label}</Badge>;
}

export default function CiLogPanel({ runs = [], actionsUrl }) {
  const latest = runs[0];
  const stats = latest?.stats ?? {};
  const fetched = latest?.fetched ?? [];
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? fetched : fetched.slice(0, 20);

  const platformCounts = useMemo(() => {
    const m = {};
    for (const x of fetched) m[x.platform] = (m[x.platform] || 0) + 1;
    return m;
  }, [fetched]);

  if (!runs.length) {
    return (
      <div className="text-muted-foreground grid h-full place-items-center p-6 text-center text-xs">
        <div>
          <p>暂无 CI 运行记录。</p>
          <p className="mt-1">抓取管线（GitHub Actions，每小时）首次运行后，记录会写入 data/ci-log.json。</p>
          {actionsUrl && (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <a href={actionsUrl} target="_blank" rel="noreferrer">
                查看 GitHub Actions
                <ArrowUpRight className="size-3" />
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-xs">
      {/* 摘要统计 */}
      <div className="flex flex-wrap items-center gap-2">
        <Stat icon={Clock} label="耗时" value={fmtDuration(latest?.durationMs)} />
        <Stat icon={FileText} label="新抓" value={stats.new ?? 0} tone="text-sky-500" />
        <Stat icon={RefreshCw} label="回填" value={stats.updated ?? 0} tone="text-violet-500" />
        <Stat icon={Languages} label="翻译" value={stats.translated ?? 0} tone="text-emerald-500" />
        {stats.failed > 0 && <Stat icon={CircleAlert} label="失败" value={stats.failed} tone="text-red-500" />}
        <span className="text-muted-foreground ml-auto text-[10px]">
          {TRIGGER_LABEL[latest?.trigger] ?? latest?.trigger} · {fmtTime(latest?.startedAt)}
          {typeof stats.pendingCount === "number" ? ` · 积压 ${stats.pendingCount}` : ""}
          {actionsUrl && (
            <a href={actionsUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 underline underline-offset-2">
              Actions <ArrowUpRight className="size-2.5" />
            </a>
          )}
        </span>
      </div>

      {/* 本轮抓取明细（截断可展开） */}
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground bg-muted/50 border-b text-left text-[10px]">
              <th className="px-2 py-1.5 font-medium">平台</th>
              <th className="px-2 py-1.5 font-medium">题目</th>
              <th className="px-2 py-1.5 font-medium">标题</th>
              <th className="px-2 py-1.5 text-right font-medium">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((x, i) => (
              <tr key={`${x.platform}-${x.problemId}-${i}`} className="hover:bg-accent/40">
                <td className="px-2 py-1"><PlatformBadge platform={x.platform} /></td>
                <td className="px-2 py-1 font-mono text-[10px]">{x.problemId}</td>
                <td className="max-w-[16rem] truncate px-2 py-1">{x.title || "—"}</td>
                <td className="px-2 py-1 text-right"><StatusBadge status={x.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {fetched.length > 20 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-muted-foreground hover:text-foreground w-full border-t py-1.5 text-[11px] hover:bg-accent/40"
          >
            {showAll ? "收起" : `展开全部 ${fetched.length} 条`}
          </button>
        )}
      </div>

      {/* 未完成 / 下次计划 / 错误 —— 三列摘要 */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border p-2">
          <p className="mb-1.5 flex items-center gap-1 font-medium">
            <CircleAlert className="size-3 text-amber-500" />
            未完成任务
            <span className="text-muted-foreground font-normal">（下轮自动重试）</span>
          </p>
          {(latest?.incomplete ?? []).length === 0 ? (
            <p className="text-muted-foreground text-[11px]">没有未完成任务 —— 全部抓取顺利。</p>
          ) : (
            <ul className="space-y-1">
              {latest.incomplete.slice(0, 6).map((x, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px]">{x.problemId}</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px]">{x.reason}</span>
                </li>
              ))}
              {latest.incomplete.length > 6 && (
                <li className="text-muted-foreground text-[10px]">…共 {latest.incomplete.length} 项</li>
              )}
            </ul>
          )}
        </div>
        <div className="rounded-lg border p-2">
          <p className="text-muted-foreground mb-1.5 font-medium">下次计划（回填队列）</p>
          {(latest?.nextPlan ?? []).length === 0 ? (
            <p className="text-muted-foreground text-[11px]">队列为空。</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {latest.nextPlan.slice(0, 12).map((x, i) => (
                <Badge key={i} variant="outline" className="px-1 py-0 font-mono text-[10px]">
                  <span className="text-muted-foreground">{x.platform.slice(0, 2)}</span>
                  {x.problemId}
                  <span className="text-muted-foreground">×{x.attempts}</span>
                </Badge>
              ))}
              {latest.nextPlan.length > 12 && (
                <span className="text-muted-foreground text-[10px]">…{latest.nextPlan.length} 项</span>
              )}
            </div>
          )}
        </div>
        <div className="rounded-lg border p-2">
          <p className="text-muted-foreground mb-1.5 font-medium">错误明细</p>
          {(latest?.errors ?? []).length === 0 ? (
            <p className="text-muted-foreground text-[11px]">本轮无错误。</p>
          ) : (
            <ul className="max-h-24 space-y-1 overflow-y-auto">
              {latest.errors.slice(0, 6).map((e, i) => (
                <li key={i} className="flex gap-1.5 text-[10px]">
                  <span className="text-muted-foreground shrink-0 font-mono">[{e.scope}]</span>
                  <span className="min-w-0 break-all">{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 历史运行（压缩单行） */}
      {runs.length > 1 && (
        <div className="rounded-lg border">
          <div className="text-muted-foreground border-b px-2 py-1 text-[10px]">历史运行</div>
          <ul className="divide-y text-[11px]">
            {runs.slice(1, 6).map((r, i) => {
              const s = r.stats ?? {};
              return (
                <li key={r.startedAt ?? i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1">
                  <span className="w-28 shrink-0 tabular-nums">{fmtTime(r.startedAt)}</span>
                  <span className="text-muted-foreground">{fmtDuration(r.durationMs)}</span>
                  <span className="text-muted-foreground ml-auto">
                    新抓 {s.new ?? 0} · 回填 {s.updated ?? 0} · 翻译 {s.translated ?? 0}
                    {s.failed ? ` · 失败 ${s.failed}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
