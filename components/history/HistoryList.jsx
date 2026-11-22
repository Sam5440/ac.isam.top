'use client';

/**
 * /history 浏览历史列表（工作项 3.2）：读 lib/view-history（IndexedDB，
 * 隐私模式静默降级内存）。表格/卡片（窄屏折叠为卡片）展示：标题链接、
 * 平台徽章、首次/最近访问、停留时长、最近判题状态；支持平台 / 判题状态 /
 * 关键词过滤；「清空历史」需 confirm 并 toast 反馈。
 */

import Link from 'next/link';
import { History, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { PlatformBadge } from '@/components/Badges';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/LoadingOverlay';
import { clearHistory, listHistory, MIN_DWELL_MS } from '@/lib/view-history';
import { platformOf, PLATFORMS } from '@/lib/platforms';
import { formatDateTime } from '@/lib/utils';
import { toast } from '@/lib/toast';

const SELECT_CLS =
  'border-input bg-background h-9 rounded-md border px-2.5 text-sm outline-none';

/** ms → mm:ss / h:mm:ss。 */
function formatDwell(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function JudgeBadge({ verdict }) {
  if (verdict === 'ac') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500">
        ✓ 已通过
      </span>
    );
  }
  if (verdict === 'fail') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
        ✗ 未通过
      </span>
    );
  }
  return <span className="text-muted-foreground inline-flex text-xs">未测</span>;
}

export default function HistoryList() {
  const [records, setRecords] = useState(null); // null = 加载中
  const [platform, setPlatform] = useState('all');
  const [judge, setJudge] = useState('all');
  const [q, setQ] = useState('');
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let alive = true;
    listHistory({ minDwellMs: MIN_DWELL_MS }).then((rows) => {
      if (alive) setRecords(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!records) return [];
    const kw = q.trim().toLowerCase();
    return records.filter((r) => {
      if (platform !== 'all' && r.platform !== platform) return false;
      if (judge !== 'all' && (r.lastJudge?.verdict ?? 'none') !== judge) return false;
      if (kw) {
        const hay = `${r.title ?? ''} ${r.titleZh ?? ''} ${r.problemId ?? ''}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [records, platform, judge, q]);

  const hasFilter = platform !== 'all' || judge !== 'all' || q.trim() !== '';

  const doClear = async () => {
    if (!window.confirm('确定清空全部浏览历史？该操作不可恢复。')) return;
    setClearing(true);
    try {
      await clearHistory();
      setRecords([]);
      toast.success('已清空浏览历史');
    } catch {
      toast.error('清空失败，请重试');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 过滤条：平台 / 判题状态 / 关键词 + 清空 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          aria-label="按平台筛选"
          className={SELECT_CLS}
        >
          <option value="all">全部平台</option>
          {PLATFORMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={judge}
          onChange={(e) => setJudge(e.target.value)}
          aria-label="按判题状态筛选"
          className={SELECT_CLS}
        >
          <option value="all">全部状态</option>
          <option value="ac">已通过</option>
          <option value="fail">未通过</option>
          <option value="none">未测</option>
        </select>
        {/* 搜索 + 清空在窄屏独占一行，避免搜索框被两个下拉框挤成一条缝 */}
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1 sm:max-w-md">
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题 / 题号"
              className="pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={doClear}
            disabled={clearing || !records?.length}
            className="text-destructive hover:text-destructive shrink-0"
          >
            <Trash2 className="size-4" />
            清空历史
          </Button>
        </div>
      </div>

      {/* 加载骨架 */}
      {records === null ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed py-14 text-sm">
          <History className="size-8 opacity-50" />
          {hasFilter ? (
            <span>没有符合筛选条件的历史记录</span>
          ) : (
            <span>还没有浏览记录 —— 去题库逛逛，停留超过 1 分钟的题目会出现在这里</span>
          )}
          {!hasFilter && (
            <Link href="/problems" className="text-primary underline-offset-4 hover:underline">
              前往题库
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {/* table-fixed + 明确列宽：题目列吃掉剩余宽度，标题才能真正 truncate；
              auto 布局下 max-w-0 会让标题被压成 0 宽、平台题号溢出到日期列（错位）。 */}
          <table className="w-full table-fixed text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">题目</th>
                <th className="hidden w-[9.5rem] px-3 py-2 text-left font-medium md:table-cell">首次访问</th>
                <th className="hidden w-[9.5rem] px-3 py-2 text-left font-medium md:table-cell">最近访问</th>
                <th className="w-[4.5rem] px-3 py-2 text-right font-medium">停留</th>
                <th className="w-[5rem] px-3 py-2 text-center font-medium">判题</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const label = platformOf(r.platform)?.label ?? r.platform;
                const name = r.titleZh || r.title || r.problemId;
                return (
                  <tr key={`${r.platform}:${r.problemId}`} className="border-t">
                    <td className="min-w-0 px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`hidden size-1.5 shrink-0 rounded-full sm:inline ${
                            platformOf(r.platform)?.dot ?? 'bg-muted-foreground'
                          }`}
                          title={label}
                        />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/problems/${r.platform}/${encodeURIComponent(String(r.problemId))}`}
                            title={name}
                            className="block truncate font-medium underline-offset-4 hover:underline"
                          >
                            {name}
                          </Link>
                          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                            <span className="max-w-full truncate font-mono">
                              {label} · {r.problemId}
                            </span>
                            {/* 窄屏补充信息（表格日期列隐藏时） */}
                            <span className="whitespace-nowrap md:hidden">
                              首次 {formatDateTime(r.firstSeen)}
                            </span>
                            <span className="whitespace-nowrap md:hidden">
                              最近 {formatDateTime(r.lastSeen)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="text-muted-foreground hidden whitespace-nowrap px-3 py-2.5 md:table-cell">
                      {formatDateTime(r.firstSeen)}
                    </td>
                    <td className="text-muted-foreground hidden whitespace-nowrap px-3 py-2.5 md:table-cell">
                      {formatDateTime(r.lastSeen)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {formatDwell(r.totalDwellMs)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <JudgeBadge verdict={r.lastJudge?.verdict} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {records !== null && filtered.length > 0 && (
        <p className="text-muted-foreground px-1 text-xs">
          共 {filtered.length} 条记录{records.length !== filtered.length ? `（总 ${records.length} 条）` : ''}
        </p>
      )}
    </div>
  );
}
