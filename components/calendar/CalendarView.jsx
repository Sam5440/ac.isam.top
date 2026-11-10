'use client';

/**
 * /calendar 比赛日历（工作项 3.4）：月历网格（6×7，周一首）+ 当日事件点，
 * 月份切换按跨度重算 start_time__during 窗口重新请求 /api/contests/clist；
 * 右侧/下方「即将开始」列表：资源徽章、本地时区起止、时长、外链；
 * 点击日期过滤列表到当天。空/失败：toast.error + 内联空态 + 重试。
 */

import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/LoadingOverlay';
import { toast } from '@/lib/toast';

// 周一为一周之首的表头
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

// 资源 → 点色小调色板（稳定 hash 取色，避免每次渲染漂移）
const DOT_COLORS = [
  'bg-red-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-pink-500',
];

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function resourceColor(resource) {
  return DOT_COLORS[hashCode(String(resource || '')) % DOT_COLORS.length];
}

/** 秒 → 「2h30m」/「45m」/「2d3h」。 */
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return m > 0 ? `${d}d${h}h` : h > 0 ? `${d}d${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${m}m`;
}

/** ISO UTC → 本地时区短文本（Intl.DateTimeFormat，跟随用户 locale）。 */
function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** ISO UTC → 本地日期 key（YYYY-MM-DD），日历分桶与点击过滤共用。 */
function dayKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 月份跨度 → start_time__during 窗口文案（涵盖当月起点的整月及前后缓冲）。 */
function duringWindowFor(year, month) {
  const first = new Date(year, month, 1);
  // 当月起点的下下月 1 号 - 当月 1 号 = 覆盖本月的整窗口（含跨月缓冲 0 天）
  const nextNext = new Date(year, month + 2, 1);
  const days = Math.ceil((nextNext - first) / 86400000);
  return `${days} days`;
}

const MONTH_FMT = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' });

export default function CalendarView() {
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [contests, setContests] = useState(null); // null = 加载中
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null); // dayKey | null

  const during = duringWindowFor(view.y, view.m);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        upcoming: 'true',
        start_time__during: during,
        limit: '100',
        order_by: 'start',
      });
      const res = await fetch(`/api/contests/clist?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `请求失败（HTTP ${res.status}）`);
      setContests(Array.isArray(body.contests) ? body.contests : []);
    } catch (e) {
      setError(e?.message || '加载失败');
      toast.error(e?.message || '比赛日程加载失败');
    } finally {
      setLoading(false);
    }
  }, [during]);

  useEffect(() => {
    load();
  }, [load]);

  const moveMonth = (delta) => {
    setSelectedDay(null);
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  // 6×7 网格：周一为首列，从本月 1 号所在周的周一开始
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7; // 周一=0 … 周日=6
    const start = new Date(view.y, view.m, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return {
        key: dayKey(d.toISOString()),
        date: d,
        inMonth: d.getMonth() === view.m,
      };
    });
  }, [view]);

  // dayKey → 当日赛事
  const byDay = useMemo(() => {
    const map = new Map();
    for (const c of contests || []) {
      const k = dayKey(c.start);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    }
    return map;
  }, [contests]);

  const dayList = selectedDay ? byDay.get(selectedDay) || [] : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* 月历 */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => moveMonth(-1)} aria-label="上一月">
            <ChevronLeft className="size-4" />
          </Button>
          <div className="text-sm font-semibold">{MONTH_FMT.format(new Date(view.y, view.m, 1))}</div>
          <Button variant="ghost" size="icon" onClick={() => moveMonth(1)} aria-label="下一月">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 border-t text-center text-xs">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-muted-foreground py-1.5 font-medium">
              周{w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-t">
          {cells.map((cell) => {
            const isToday = dayKey(cell.date.toISOString()) === dayKey(today.toISOString());
            const events = byDay.get(cell.key) || [];
            const selected = selectedDay === cell.key;
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => setSelectedDay(selected ? null : cell.key)}
                aria-pressed={selected}
                className={`relative flex h-16 flex-col items-center justify-start gap-1 border-b border-r px-1 pt-1.5 text-xs last:border-r-0 [&:nth-child(7n)]:border-r-0 ${
                  cell.inMonth ? '' : 'text-muted-foreground/40'
                } ${selected ? 'bg-accent' : ''}`}
              >
                <span
                  className={`inline-flex size-6 items-center justify-center rounded-full font-medium ${
                    isToday ? 'bg-primary text-primary-foreground' : ''
                  }`}
                >
                  {cell.date.getDate()}
                </span>
                <span className="flex max-w-full flex-wrap justify-center gap-0.5">
                  {events.slice(0, 3).map((c) => (
                    <span
                      key={c.id}
                      className={`size-1.5 rounded-full ${resourceColor(c.resource)}`}
                      title={c.event}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 赛事列表 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {selectedDay ? `${selectedDay} 的赛事` : '即将开始'}
          </h2>
          {selectedDay && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>
              查看全部
            </Button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-sm">
            <CalendarDays className="size-8 opacity-50" />
            <span className="max-w-[280px] text-center">{error}</span>
            <Button variant="outline" size="sm" onClick={load}>
              <RotateCcw className="size-4" />
              重试
            </Button>
          </div>
        ) : (dayList || contests).length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-sm">
            <CalendarDays className="size-8 opacity-50" />
            <span>{selectedDay ? '这一天没有比赛' : '近期没有检索到比赛日程'}</span>
          </div>
        ) : (
          <ul className="space-y-2">
            {(dayList || contests).map((c) => (
              <li key={c.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={c.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {c.event}
                    <ExternalLink className="ml-1 inline size-3 align-super opacity-60" />
                  </a>
                  <span
                    className={`mt-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${resourceColor(c.resource)}`}
                  >
                    {c.resource}
                  </span>
                </div>
                <div className="text-muted-foreground mt-1.5 text-xs">
                  {fmtTime(c.start)} — {fmtTime(c.end)} · {formatDuration(c.duration)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
