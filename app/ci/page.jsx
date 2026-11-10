/**
 * /ci 抓取日志页（工作项 3.3）：服务端组件读 data/ci-log.json
 * （scripts/fetch.mjs 每轮写入，最新运行在前），展示最近一次运行的
 * 摘要卡片、逐题抓取列表、未完成任务（下轮自动重试）、下次计划与
 * 错误明细（折叠），并提供 GitHub Actions 外链。
 */

import fs from 'node:fs';
import path from 'node:path';

import { ArrowUpRight, CircleAlert, Clock, FileText, Languages, RefreshCw, ScrollText } from 'lucide-react';

import { PlatformBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';

export const metadata = { title: '抓取日志' };

// 数据由 GitHub Actions 每小时抓取并提交，这里 5 分钟重新验证即可
export const revalidate = 300;

const CI_LOG_FILE = path.join(process.cwd(), 'data', 'ci-log.json');
const GITHUB_ACTIONS_URL = 'https://github.com/Sam5440/ac.isam.top/actions';

/** 摘要卡片（同 app/page.jsx 的 StatCard 形态）。 */
function StatCard({ icon: Icon, label, value }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-lg">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
          <div className="text-muted-foreground text-xs">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

/** 抓取状态徽章：fetched 新抓 / translated 已译 / skipped 跳过 / failed 失败。 */
const STATUS_META = {
  fetched: { label: '已抓取', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-500' },
  translated: { label: '已翻译', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' },
  skipped: { label: '跳过', cls: 'border-transparent bg-secondary text-secondary-foreground' },
  failed: { label: '失败', cls: 'border-red-500/40 bg-red-500/10 text-red-500' },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? { label: status || '未知', cls: '' };
  return <Badge variant="outline" className={meta.cls}>{meta.label}</Badge>;
}

/** ms → 「2 分 30 秒」/「45 秒」/「1 小时 5 分」。 */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

const TRIGGER_LABEL = { schedule: '定时触发', workflow_dispatch: '手动触发', manual: '手动运行' };

function CiLogContent({ log }) {
  const latest = log.runs[0];
  const stats = latest?.stats ?? {};
  const fetched = latest?.fetched ?? [];

  return (
    <div className="space-y-8">
      {/* 最近一次运行摘要 */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight">最近一次运行</h2>
          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <span>
              {TRIGGER_LABEL[latest?.trigger] ?? latest?.trigger ?? '—'} ·{' '}
              {latest?.startedAt ? formatDateTime(latest.startedAt) : '—'}
            </span>
            <Button asChild variant="ghost" size="sm">
              <a href={GITHUB_ACTIONS_URL} target="_blank" rel="noreferrer">
                GitHub Actions
                <ArrowUpRight className="size-3.5" />
              </a>
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Clock} label="运行耗时" value={formatDuration(latest?.durationMs)} />
          <StatCard icon={FileText} label="新抓题面" value={stats.new ?? 0} />
          <StatCard icon={RefreshCw} label="回填补抓" value={stats.updated ?? 0} />
          <StatCard icon={Languages} label="AI 翻译" value={stats.translated ?? 0} />
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          数据更新于 {log.updatedAt ? formatDateTime(log.updatedAt) : '—'}
          {typeof stats.failed === 'number' && stats.failed > 0
            ? ` · 本轮失败 ${stats.failed} 题`
            : ' · 本轮无失败'}
          {typeof stats.pendingCount === 'number' ? ` · 积压待重试 ${stats.pendingCount} 题` : ''}
        </p>
      </section>

      {/* 逐题抓取列表 */}
      <section>
        <h2 className="mb-4 text-xl font-semibold tracking-tight">本轮抓取明细</h2>
        {fetched.length === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            本轮没有逐题抓取记录（题面均已收录或仅执行了翻译/回填聚合统计）。
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="px-4 py-3 font-medium">平台</th>
                      <th className="px-4 py-3 font-medium">题目</th>
                      <th className="px-4 py-3 font-medium">标题</th>
                      <th className="px-4 py-3 text-right font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {fetched.map((x, i) => (
                      <tr key={`${x.platform}-${x.problemId}-${i}`} className="hover:bg-accent/40">
                        <td className="px-4 py-2.5">
                          <PlatformBadge platform={x.platform} />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{x.problemId}</td>
                        <td className="max-w-[24rem] truncate px-4 py-2.5">{x.title || '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <StatusBadge status={x.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* 未完成任务（下轮自动重试） */}
      <section>
        <h2 className="mb-4 text-xl font-semibold tracking-tight">
          未完成任务
          <span className="text-muted-foreground ml-2 text-sm font-normal">下轮自动重试</span>
        </h2>
        {(latest?.incomplete ?? []).length === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            没有未完成任务 —— 全部题面抓取顺利。
          </div>
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {latest.incomplete.map((x, i) => (
                <div key={`${x.platform}-${x.problemId}-${i}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <PlatformBadge platform={x.platform} />
                  <span className="font-mono text-xs">{x.problemId}</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{x.reason}</span>
                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500">
                    将重试
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {/* 下次计划（回填队列） */}
      {(latest?.nextPlan ?? []).length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold tracking-tight">
            下次计划
            <span className="text-muted-foreground ml-2 text-sm font-normal">历史回填队列（尝试次数少者优先）</span>
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap gap-2 p-4">
                {latest.nextPlan.map((x, i) => (
                  <Badge key={`${x.platform}-${x.problemId}-${i}`} variant="outline" className="font-mono text-xs">
                    <span className="text-muted-foreground">{x.platform.slice(0, 2)}</span>
                    {x.problemId}
                    <span className="text-muted-foreground">×{x.attempts}</span>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* 历史运行 */}
      {log.runs.length > 1 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold tracking-tight">历史运行</h2>
          <Card>
            <CardContent className="divide-y p-0">
              {log.runs.slice(1, 10).map((r, i) => {
                const s = r.stats ?? {};
                return (
                  <div key={r.startedAt ?? i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                    <span className="w-40 shrink-0">{r.startedAt ? formatDateTime(r.startedAt) : '—'}</span>
                    <span className="text-muted-foreground text-xs">{formatDuration(r.durationMs)}</span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      新抓 {s.new ?? 0} · 回填 {s.updated ?? 0} · 翻译 {s.translated ?? 0}
                      {s.failed ? ` · 失败 ${s.failed}` : ''}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      )}

      {/* 错误明细（折叠） */}
      {(latest?.errors ?? []).length > 0 && (
        <details className="rounded-xl border">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium select-none">
            <CircleAlert className="size-4 text-red-500" />
            错误明细（{latest.errors.length}）
          </summary>
          <div className="space-y-1.5 border-t px-4 py-3">
            {latest.errors.map((e, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="text-muted-foreground shrink-0 font-mono">[{e.scope}]</span>
                <span className="min-w-0 break-all">{e.message}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export default function CiPage() {
  let log = null;
  try {
    log = JSON.parse(fs.readFileSync(CI_LOG_FILE, 'utf8'));
  } catch {}
  const runs = Array.isArray(log?.runs) ? log.runs : [];

  return (
    <div className="space-y-6 py-10">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <ScrollText className="size-7" />
          抓取日志
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          GitHub Actions 每小时运行一次抓取与翻译管线（错峰 23 分），这里展示每轮的运行记录。
        </p>
      </div>
      {runs.length === 0 ? (
        <div className="py-16 text-center">
          <ScrollText className="text-muted-foreground mx-auto size-10" />
          <p className="mt-4 font-medium">暂无运行记录</p>
          <p className="text-muted-foreground mt-2 text-sm">
            抓取管线首次运行后，运行记录会写入 data/ci-log.json 并展示在这里。
          </p>
          <Button asChild variant="outline" className="mt-6">
            <a href={GITHUB_ACTIONS_URL} target="_blank" rel="noreferrer">
              查看 GitHub Actions
              <ArrowUpRight className="size-4" />
            </a>
          </Button>
        </div>
      ) : (
        <CiLogContent log={{ ...log, runs }} />
      )}
    </div>
  );
}
