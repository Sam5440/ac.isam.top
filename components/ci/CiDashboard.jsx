'use client';

/**
 * /ci 抓取日志仪表盘（参考姊妹项目 ys_problem_web 的 /logs 设计）：
 *
 *  - 顶部状态栏：仓库存档 N 次运行 + GitHub Actions 实时同步（匿名 API，
 *    每 5 分钟自动刷新 + 手动按钮）；窗口切换 近 7 天 / 全部记录。
 *  - 统计卡片 ×5（带 Sparkline）：运行次数、新抓+回填题面、AI 翻译、
 *    积压待重试、平均耗时。
 *  - 图表行：ActivityChart（每日运行柱状，点击定位）+ Donut 成功率环。
 *  - RunOutputChart：单次运行产出对比柱状图，点击展开运行卡片。
 *  - 平台产出表（最新一次运行 + 窗口累计，atcoder/codeforces/nowcoder 拆分）。
 *  - 运行历史：时间线（彩色节点）+ 可展开运行卡片（抓取明细 / 未完成任务 /
 *    下次计划 / 错误明细），远端-only 的空跑/取消运行用轻量卡片。
 *
 * 数据：服务端 app/ci/page.jsx 读 data/ci-log.json（最近 30 次）传入；
 * 记录可能缺 runId/platforms 等新字段（旧数据），全部降级处理。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  GitCommitHorizontal,
  Languages,
  Layers,
  RefreshCw,
  ScrollText,
  Timer,
  XCircle,
} from 'lucide-react';

import { PlatformBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ActivityChart, Donut, RunOutputChart, Sparkline, RETENTION_DAYS, dayLabel, fmtDur, isoDay } from '@/components/ci/charts';

const DAY = 86_400_000;
const WINDOW_DAYS = 7;
const GH_REPO = 'Sam5440/ac.isam.top';
const WORKFLOW_FILE = 'fetch.yml';

const TRIGGER_LABEL = { schedule: '定时', workflow_dispatch: '手动', manual: '手动', push: '推送' };
const STATUS_META = {
  fetched: { label: '已抓取', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-500' },
  translated: { label: '已翻译', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' },
  skipped: { label: '跳过', cls: 'border-transparent bg-secondary text-secondary-foreground' },
  failed: { label: '失败', cls: 'border-red-500/40 bg-red-500/10 text-red-500' },
};
const PLATFORM_LABEL = { atcoder: 'AtCoder', codeforces: 'Codeforces', nowcoder: '牛客' };

/** 远端（GitHub Actions API）与本地存档合并：runId 精确匹配；无 runId 的旧
 *  存档按 startedAt ±3 分钟窗口匹配，避免同一轮出现两张卡片。 */
function mergeRemoteRuns(local, remoteRuns) {
  const byId = new Set(local.filter((r) => r.runId).map((r) => String(r.runId)));
  const byTime = local.filter((r) => !r.runId && r.startedAt).map((r) => Date.parse(r.startedAt));
  const near = (ts) => byTime.some((t) => Math.abs(t - ts) < 3 * 60_000);
  const synth = [];
  for (const r of remoteRuns || []) {
    if (!r.conclusion) continue;
    const startedAt = r.run_started_at || r.created_at;
    const ts = startedAt ? Date.parse(startedAt) : 0;
    if (byId.has(String(r.id)) || near(ts)) continue;
    const durMs = startedAt && r.updated_at ? Math.max(0, Date.parse(r.updated_at) - ts) : null;
    synth.push({
      runId: r.id,
      event: r.event,
      startedAt,
      url: r.html_url,
      failure: r.conclusion === 'failure',
      conclusion: r.conclusion,
      remoteOnly: true,
      noop: r.conclusion === 'success' && durMs != null && durMs < 5 * 60_000,
      durationMs: durMs,
    });
  }
  if (!synth.length) return local;
  return [...local, ...synth].sort((a, b) => ((a.startedAt || '') < (b.startedAt || '') ? 1 : -1));
}

/** 本地时区格式化（Intl 显式时区，服务端/客户端一致，避免 hydration mismatch）。 */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
const fmtDateTime = (iso) =>
  new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso));

function timelineDot(r) {
  if (r.failure) return 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.2)]';
  if (r.remoteOnly && r.conclusion === 'cancelled') return 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.2)]';
  if (r.remoteOnly) return 'bg-zinc-500 shadow-[0_0_0_3px_rgba(113,113,122,0.2)]';
  return 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]';
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? { label: status || '未知', cls: '' };
  return <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${meta.cls}`}>{meta.label}</Badge>;
}

function StatCard({ icon: Icon, label, value, sub, tone = 'emerald', spark }) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs font-medium">{label}</p>
          <span className="rounded-lg border p-1.5 border-emerald-500/40 bg-emerald-500/10">
            <Icon className={`size-3.5 text-${tone}-500`} />
          </span>
        </div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <p className="min-w-0 truncate text-2xl font-bold tracking-tight tabular-nums">{value}</p>
          {spark && <Sparkline data={spark} tone={tone} />}
        </div>
        {sub && <p className="text-muted-foreground mt-0.5 truncate text-[11px]">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/* ------------------------------- 运行卡片 -------------------------------- */

function RunCard({ run, expanded, onToggle, index }) {
  const s = run.stats || {};
  const platforms = run.platforms || null;
  const runUrl = run.runId
    ? `https://github.com/${GH_REPO}/actions/runs/${run.runId}`
    : run.url || null;
  const fetchedN = (run.fetched || []).length;

  return (
    <Card className="scroll-mt-24 overflow-hidden" id={`run-${run.runId || index}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-start gap-3 p-4 text-left">
        <span className={`mt-0.5 rounded-lg border p-1.5 ${run.failure ? 'border-red-500/40 bg-red-500/10' : 'border-emerald-500/40 bg-emerald-500/10'}`}>
          {run.failure ? <XCircle className="size-4 text-red-400" /> : <CheckCircle2 className="size-4 text-emerald-500" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">{TRIGGER_LABEL[run.trigger] || run.trigger || '运行'}</span>
            {run.runId ? (
              <span className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">run {run.runId}</span>
            ) : null}
            {run.sha && <span className="flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground"><GitCommitHorizontal className="size-3" />{run.sha}</span>}
            {run.failure && <span className="rounded-md border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400">有失败任务</span>}
          </span>
          <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px]">
            <span>{run.startedAt ? fmtDateTime(run.startedAt) : '—'}</span>
            {run.durationMs != null && (
              <span className="flex items-center gap-1"><Timer className="size-3" />{fmtDur(run.durationMs)}</span>
            )}
          </span>
          {!run.remoteOnly && (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {s.new > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-500">
                  <Download className="size-3" />新抓 {s.new} 题
                </span>
              )}
              {s.updated > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-500">
                  回填 {s.updated} 题
                </span>
              )}
              {s.translated > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-500">
                  <Languages className="size-3" />AI 翻译 {s.translated} 题
                </span>
              )}
              {s.failed > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500">
                  {s.failed} 题失败
                </span>
              )}
              {typeof s.pendingCount === 'number' && s.pendingCount > 0 && (
                <span className="text-muted-foreground rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px]">
                  积压 {s.pendingCount}
                </span>
              )}
              {run.translateQueue > 0 && (
                <span className="text-muted-foreground rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px]">
                  翻译队列 {run.translateQueue}
                </span>
              )}
              {!s.new && !s.updated && !s.translated && s.failed === 0 && (
                <span className="text-muted-foreground rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px]">无数据变更</span>
              )}
            </span>
          )}
        </span>
        <ChevronDown className={`text-muted-foreground mt-1 size-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && !run.remoteOnly && (
        <CardContent className="space-y-3 border-t pt-4">
          {/* 抓取明细 */}
          {fetchedN > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><Download className="text-primary size-3.5" />抓取明细（{fetchedN}）</p>
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
                    {run.fetched.slice(0, 50).map((x, i) => (
                      <tr key={`${x.platform}-${x.problemId}-${i}`} className="hover:bg-accent/40">
                        <td className="px-2 py-1"><PlatformBadge platform={x.platform} /></td>
                        <td className="px-2 py-1 font-mono text-[10px]">{x.problemId}</td>
                        <td className="max-w-[18rem] truncate px-2 py-1">{x.title || '—'}</td>
                        <td className="px-2 py-1 text-right"><StatusBadge status={x.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {fetchedN > 50 && <p className="text-muted-foreground border-t px-2 py-1 text-[10px]">…其余 {fetchedN - 50} 条略（完整记录见 data/ci-log.json）</p>}
              </div>
            </div>
          )}

          {/* 平台产出拆分 */}
          {platforms && (
            <div>
              <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold"><Layers className="size-3.5" />平台产出</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.entries(platforms).map(([p, v]) => (
                  <div key={p} className="rounded-lg border p-2.5 text-xs">
                    <PlatformBadge platform={p} />
                    <p className="mt-1.5 tabular-nums">
                      新抓 <b>{v.new}</b> · 回填 <b>{v.updated}</b>
                      {v.failed ? <span className="text-red-500"> · 失败 {v.failed}</span> : ''}
                      {v.contests ? <span className="text-muted-foreground"> · {v.contests} 场比赛</span> : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 未完成任务 / 下次计划 */}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                <Clock className="size-3.5 text-amber-500" />未完成任务
                <span className="text-muted-foreground font-normal">（下轮自动重试）</span>
              </p>
              {(run.incomplete || []).length === 0 ? (
                <p className="text-muted-foreground text-[11px]">没有未完成任务 —— 全部抓取顺利。</p>
              ) : (
                <ul className="space-y-1.5">
                  {run.incomplete.slice(0, 8).map((x, i) => (
                    <li key={i} className="flex items-center gap-2 text-[11px]">
                      <PlatformBadge platform={x.platform} />
                      <span className="font-mono text-[10px]">{x.problemId}</span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate">{x.reason}</span>
                    </li>
                  ))}
                  {(run.incomplete || []).length > 8 && (
                    <li className="text-muted-foreground text-[10px]">…共 {run.incomplete.length} 项</li>
                  )}
                </ul>
              )}
            </div>
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-semibold">下次计划（回填队列）</p>
              {(run.nextPlan || []).length === 0 ? (
                <p className="text-muted-foreground text-[11px]">队列为空。</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {run.nextPlan.slice(0, 20).map((x, i) => (
                    <Badge key={i} variant="outline" className="px-1 py-0 font-mono text-[10px]">
                      <span className="text-muted-foreground">{x.platform.slice(0, 2)}</span>
                      {x.problemId}
                      <span className="text-muted-foreground">×{x.attempts}</span>
                    </Badge>
                  ))}
                  {(run.nextPlan || []).length > 20 && (
                    <span className="text-muted-foreground text-[10px]">…{run.nextPlan.length} 项</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 错误明细 */}
          {(run.errors || []).length > 0 && (
            <details className="rounded-lg border">
              <summary className="text-muted-foreground flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium select-none hover:text-foreground">
                <XCircle className="size-3.5 text-red-500" />
                错误明细（{run.errors.length}）
              </summary>
              <div className="space-y-1.5 border-t px-3 py-2.5">
                {run.errors.map((e, i) => (
                  <div key={i} className="flex gap-2 text-[11px]">
                    <span className="text-muted-foreground shrink-0 font-mono">[{e.scope}]</span>
                    <span className="min-w-0 break-all">{e.message}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {runUrl && (
            <a href={runUrl} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 text-xs hover:underline">
              在 GitHub 上查看这次运行 <ArrowUpRight className="size-3" />
            </a>
          )}
        </CardContent>
      )}

      {expanded && run.remoteOnly && (
        <CardContent className="border-t pt-4 text-xs">
          <p className="text-muted-foreground">
            {run.conclusion === 'cancelled'
              ? '这次运行在并发队列中被新运行取代而取消，未产生数据提交。'
              : run.noop
                ? '空跑：本轮没有需要抓取或翻译的内容，未产生仓库提交。'
                : '这次运行没有对应的数据存档（可能是空跑或日志尚未同步）。'}
          </p>
          {run.url && (
            <a href={run.url} target="_blank" rel="noreferrer" className="text-primary mt-2 inline-flex items-center gap-1 hover:underline">
              在 GitHub 上查看 <ArrowUpRight className="size-3" />
            </a>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/* --------------------------------- 主组件 --------------------------------- */

export default function CiDashboard({ runs = [], actionsUrl }) {
  const [window7, setWindow7] = useState(false);
  const [expandedKey, setExpandedKey] = useState(null);
  const [remote, setRemote] = useState({ state: 'idle', runs: [] });
  const busyRef = useRef(false);

  // GitHub Actions 实时同步（匿名 API，公开仓库足够；5 分钟自动刷新）
  const syncRemote = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRemote((r) => ({ ...r, state: 'loading' }));
    try {
      const res = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=100`, {
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setRemote({ state: 'ready', runs: j.workflow_runs || [] });
    } catch {
      setRemote((r) => ({ ...r, state: 'error' }));
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    syncRemote();
    const t = setInterval(syncRemote, 300_000);
    return () => clearInterval(t);
  }, [syncRemote]);

  const merged = useMemo(() => mergeRemoteRuns(runs, remote.runs), [runs, remote.runs]);
  const remoteOnlyN = merged.length - runs.length;

  // SSR 稳定时间锚点 = 最新一次运行
  const anchorMs = useMemo(
    () => (merged.length && merged[0].startedAt ? Date.parse(merged[0].startedAt) : Date.parse('2026-01-01T00:00:00Z')),
    [merged],
  );
  const cutoff = anchorMs - (window7 ? WINDOW_DAYS : RETENTION_DAYS) * DAY;
  const visible = useMemo(
    () => merged.filter((r) => r.startedAt && Date.parse(r.startedAt) >= cutoff),
    [merged, cutoff],
  );
  const chrono = useMemo(() => [...visible].reverse(), [visible]);
  const chronoLogged = useMemo(() => chrono.filter((r) => !r.remoteOnly), [chrono]);

  const stats = useMemo(() => {
    const fail = visible.filter((r) => r.failure).length;
    const fetched = chronoLogged.reduce((a, r) => a + (r.stats?.new || 0) + (r.stats?.updated || 0), 0);
    const translated = chronoLogged.reduce((a, r) => a + (r.stats?.translated || 0), 0);
    const latest = chronoLogged[chronoLogged.length - 1];
    const pending = latest?.stats?.pendingCount;
    const durs = chronoLogged.map((r) => r.durationMs).filter((d) => Number.isFinite(d));
    const avgDur = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null;
    // 平台累计（窗口内）
    const platformTotals = { atcoder: 0, codeforces: 0, nowcoder: 0 };
    for (const r of chronoLogged) {
      for (const [p, v] of Object.entries(r.platforms || {})) {
        platformTotals[p] = (platformTotals[p] || 0) + (v.new || 0) + (v.updated || 0);
      }
    }
    return {
      fail,
      ok: visible.length - fail,
      fetched,
      translated,
      pending,
      avgDur,
      platformTotals,
      perRunFetched: chronoLogged.map((r) => (r.stats?.new || 0) + (r.stats?.updated || 0)),
      perRunTranslated: chronoLogged.map((r) => r.stats?.translated || 0),
    };
  }, [visible, chronoLogged]);

  const pick = (key) => {
    setExpandedKey((prev) => (prev === key ? prev : key));
    requestAnimationFrame(() => {
      document.getElementById(`run-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const pickDay = (dayKey) => {
    const r = visible.find((x) => x.startedAt && isoDay(Date.parse(x.startedAt)) === dayKey);
    if (r) pick(r.runId || r.startedAt);
  };

  if (!runs.length && remote.state === 'idle') {
    return null; // 页面壳的空态已处理
  }

  return (
    <div className="space-y-6">
      {/* 状态栏：存档数 + 远端同步状态 + 窗口切换 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>存档 {runs.length} 次运行 · 滚动保留 {RETENTION_DAYS} 天</span>
          {remote.state === 'loading' && (
            <span className="flex items-center gap-1"><RefreshCw className="size-3 animate-spin" />正在同步 GitHub Actions…</span>
          )}
          {remote.state === 'ready' && (
            <span className="flex items-center gap-1 text-emerald-500/90">
              <CheckCircle2 className="size-3" />
              已同步最近 {remote.runs.length} 次{remoteOnlyN > 0 ? ` · ${remoteOnlyN} 次无存档` : ''}
            </span>
          )}
          {remote.state === 'error' && (
            <span className="text-amber-500">GitHub Actions 同步失败（限流或网络），仅显示仓库存档</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            {[
              ['近 7 天', true],
              ['全部记录', false],
            ].map(([label, val]) => (
              <button
                key={label} type="button" onClick={() => setWindow7(val)}
                className={`rounded-md px-2.5 py-1 text-xs transition ${window7 === val ? 'bg-background text-foreground font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={syncRemote} title="重新同步 GitHub Actions 最近运行">
            <RefreshCw className={`size-3.5 ${remote.state === 'loading' ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      {visible.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard icon={Activity} label="运行次数" value={visible.length} sub={`正常 ${stats.ok} · 失败 ${stats.fail}`} />
          <StatCard icon={Download} label="新抓 + 回填题面" value={stats.fetched} sub="窗口内累计" tone="sky" spark={stats.perRunFetched} />
          <StatCard icon={Languages} label="AI 翻译" value={stats.translated} sub="窗口内累计" tone="violet" spark={stats.perRunTranslated} />
          <StatCard icon={ScrollText} label="积压待重试" value={stats.pending ?? '—'} sub="未达尝试上限的题面" tone="amber" />
          <StatCard icon={Timer} label="平均耗时" value={stats.avgDur ? fmtDur(stats.avgDur) : '—'} sub="抓取 → 翻译 → 建索引" tone="emerald" />
        </div>
      )}

      {/* 图表行 */}
      {visible.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent className="p-4">
              <p className="text-xs font-semibold">运行活动 · 近 {window7 ? WINDOW_DAYS : 30} 天</p>
              <p className="text-muted-foreground mb-2 text-[11px]">每日运行次数（绿=正常，红=有失败任务），点击柱子定位到对应运行</p>
              <ActivityChart runs={visible} anchorMs={anchorMs} windowDays={window7 ? WINDOW_DAYS : 30} onPickDay={pickDay} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex h-full flex-col justify-between gap-3 p-4">
              <div>
                <p className="text-xs font-semibold">成功率</p>
                <p className="text-muted-foreground text-[11px]">窗口内 {visible.length} 次运行</p>
              </div>
              <div className="flex justify-center py-1">
                <Donut success={stats.ok} fail={stats.fail} />
              </div>
              {stats.avgDur != null && <p className="text-muted-foreground text-center text-[11px]">平均耗时 {fmtDur(stats.avgDur)}</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 单次运行产出对比 */}
      {chronoLogged.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold">单次运行产出对比</p>
            <p className="text-muted-foreground mb-2 text-[11px]">每轮的新抓/回填题数与 AI 翻译题数（最近 40 轮，空跑画为圆点），点击柱子展开对应运行</p>
            <RunOutputChart runsChrono={chronoLogged} onPickRun={pick} />
          </CardContent>
        </Card>
      )}

      {/* 运行历史（时间线 + 可展开卡片） */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold">运行历史</h2>
          <span className="text-muted-foreground rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums">{visible.length}</span>
        </div>
        {visible.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="rounded-full border border-border bg-muted p-3">
                <ScrollText className="text-muted-foreground size-5" />
              </span>
              <p className="text-sm font-medium">窗口内暂无运行</p>
              <p className="text-muted-foreground max-w-sm text-xs">切换到「全部记录」查看更早的运行，或等待下一轮定时抓取。</p>
            </CardContent>
          </Card>
        ) : (
          <div className="relative space-y-4 pl-7">
            <span className="from-emerald-500/50 via-border pointer-events-none absolute top-4 bottom-4 left-[9px] w-px bg-gradient-to-b to-transparent" />
            {visible.map((r, i) => (
              <div key={r.runId || r.startedAt || i} className="relative">
                <span className={`absolute top-5 -left-7 h-[19px] w-[19px] rounded-full border-[5px] border-background ${timelineDot(r)}`} />
                <RunCard
                  run={r}
                  index={i}
                  expanded={expandedKey === (r.runId || r.startedAt)}
                  onToggle={() => setExpandedKey((prev) => (prev === (r.runId || r.startedAt) ? null : r.runId || r.startedAt))}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
