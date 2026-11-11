'use client';

/**
 * /calendar 比赛日历：周一首的周网格，覆盖「今天前 N 天 ~ 后 M 天」（设置 → 题面与翻译 → 比赛日历，
 * 默认 3 / 15 天），每格按开始时间列出当天全部比赛（不折叠为 +N more，名字过长自动换行）。
 * 顶部站点筛选可直接勾选（持久化到 settings.calendarSites，默认牛客 / 洛谷 / AtCoder / Codeforces）。
 * 数据经 /api/contests/clist 以 start__gte / start__lte 区间请求；窄屏退化为按日分组列表。
 */

import { CalendarDays, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/LoadingOverlay';
import { DEFAULT_CALENDAR_SITES, useSettings } from '@/components/settings';
import { toast } from '@/lib/toast';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// 常用站点：短标签 + 配色（徽章实色 / 条目浅底）
const KNOWN_SITES = {
  'ac.nowcoder.com': { label: '牛客', short: 'N', badge: 'bg-sky-600', tint: 'bg-sky-500/12 hover:bg-sky-500/20' },
  'luogu.com.cn': { label: '洛谷', short: '洛', badge: 'bg-violet-600', tint: 'bg-violet-500/12 hover:bg-violet-500/20' },
  'atcoder.jp': { label: 'AtCoder', short: 'AT', badge: 'bg-amber-700', tint: 'bg-amber-500/14 hover:bg-amber-500/22' },
  'codeforces.com': { label: 'Codeforces', short: 'CF', badge: 'bg-rose-600', tint: 'bg-rose-500/12 hover:bg-rose-500/20' },
  'leetcode.com': { label: 'LeetCode', short: 'LC', badge: 'bg-orange-500', tint: 'bg-orange-500/12 hover:bg-orange-500/20' },
  'codechef.com': { label: 'CodeChef', short: 'CC', badge: 'bg-stone-600', tint: 'bg-stone-500/12 hover:bg-stone-500/20' },
};

const OTHER_PALETTE = [
  { badge: 'bg-emerald-600', tint: 'bg-emerald-500/12 hover:bg-emerald-500/20' },
  { badge: 'bg-teal-600', tint: 'bg-teal-500/12 hover:bg-teal-500/20' },
  { badge: 'bg-indigo-600', tint: 'bg-indigo-500/12 hover:bg-indigo-500/20' },
  { badge: 'bg-pink-600', tint: 'bg-pink-500/12 hover:bg-pink-500/20' },
  { badge: 'bg-lime-700', tint: 'bg-lime-500/14 hover:bg-lime-500/22' },
  { badge: 'bg-cyan-700', tint: 'bg-cyan-500/12 hover:bg-cyan-500/20' },
];

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function siteMeta(resource) {
  const r = String(resource || '');
  if (KNOWN_SITES[r]) return KNOWN_SITES[r];
  const base = r.replace(/^(www|ac|contest|contests)\./, '');
  return {
    label: r,
    short: base.slice(0, 2).toUpperCase(),
    ...OTHER_PALETTE[hashCode(r) % OTHER_PALETTE.length],
  };
}

/** Date → 本地日期 key（YYYY-MM-DD）。 */
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Date → Clist 区间参数（UTC，无时区后缀）。 */
function clistTime(d) {
  return d.toISOString().slice(0, 19);
}

const TIME_FMT = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const FULL_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}天${h}小时` : `${d}天`;
  if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
  return `${m}分钟`;
}

const clampDays = (v, def, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : def;
};

function SiteBadge({ resource, className = '' }) {
  const meta = siteMeta(resource);
  return (
    <span
      className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[3px] px-0.5 text-[9px] font-bold leading-none text-white ${meta.badge} ${className}`}
    >
      {meta.short}
    </span>
  );
}

function EventItem({ c, now }) {
  const meta = siteMeta(c.resource);
  const start = new Date(c.start);
  const end = new Date(c.end);
  const past = end < now;
  const running = start <= now && now < end;
  return (
    <a
      href={c.href}
      target="_blank"
      rel="noreferrer"
      title={`${c.event}\n${meta.label} · ${FULL_FMT.format(start)} 开始 · 时长 ${formatDuration(c.duration)}`}
      className={`flex items-start gap-1 rounded px-1 py-0.5 text-[11.5px] leading-snug transition-colors ${meta.tint} ${
        past ? 'opacity-50' : ''
      } ${running ? 'ring-1 ring-emerald-500/70' : ''}`}
    >
      <SiteBadge resource={c.resource} className="mt-px" />
      <span className="min-w-0 break-words">
        <span className="mr-1 font-semibold tabular-nums">{TIME_FMT.format(start)}</span>
        {c.event}
      </span>
    </a>
  );
}

export default function CalendarView() {
  const { settings, setSettings } = useSettings();
  const before = clampDays(settings.calendarDaysBefore, 3, 30);
  const after = clampDays(settings.calendarDaysAfter, 15, 60);
  const selected = useMemo(
    () => new Set(Array.isArray(settings.calendarSites) ? settings.calendarSites : DEFAULT_CALENDAR_SITES),
    [settings.calendarSites],
  );

  const [now, setNow] = useState(() => new Date());
  const todayKey = dayKey(now);
  const rangeStart = useMemo(() => addDays(new Date(now), -before), [todayKey, before]);
  const rangeEnd = useMemo(() => addDays(new Date(now), after + 1), [todayKey, after]);

  const [contests, setContests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNow(new Date());
    try {
      const params = new URLSearchParams({
        start__gte: clistTime(rangeStart),
        start__lte: clistTime(rangeEnd),
        limit: '500',
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
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    load();
  }, [load]);

  // 站点列表：默认四站在前，其余按出现次数降序
  const sites = useMemo(() => {
    const count = new Map();
    for (const c of contests) count.set(c.resource, (count.get(c.resource) || 0) + 1);
    const others = [...count.keys()]
      .filter((r) => !DEFAULT_CALENDAR_SITES.includes(r))
      .sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b));
    return [...DEFAULT_CALENDAR_SITES, ...others].map((r) => ({ id: r, count: count.get(r) || 0 }));
  }, [contests]);

  const toggleSite = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSettings({ calendarSites: [...next] });
  };

  const visible = useMemo(
    () =>
      contests
        .filter((c) => selected.has(c.resource))
        .sort((a, b) => new Date(a.start) - new Date(b.start) || String(a.event).localeCompare(String(b.event))),
    [contests, selected],
  );

  const byDay = useMemo(() => {
    const map = new Map();
    for (const c of visible) {
      const k = dayKey(new Date(c.start));
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    }
    return map;
  }, [visible]);

  // 网格：从区间首日所在周的周一，到区间末日所在周的周日
  const cells = useMemo(() => {
    const first = rangeStart;
    const last = addDays(rangeEnd, -1);
    const gridStart = addDays(first, -((first.getDay() + 6) % 7));
    const gridEnd = addDays(last, 6 - ((last.getDay() + 6) % 7));
    const out = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
      out.push({ key: dayKey(d), date: d, inRange: d >= first && d <= last });
    }
    return out;
  }, [rangeStart, rangeEnd]);

  const lastDay = addDays(rangeEnd, -1);
  const rangeTitle = `${rangeStart.getMonth() + 1}月${rangeStart.getDate()}日 – ${
    lastDay.getMonth() + 1
  }月${lastDay.getDate()}日`;
  const agendaDays = cells.filter((c) => c.inRange && byDay.has(c.key));

  return (
    <div className="space-y-4">
      {/* 标题栏 + 站点筛选 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{rangeTitle}</h2>
          <span className="text-muted-foreground text-xs">
            前 {before} 天 · 后 {after} 天 ·{' '}
            <Link href="/settings#reading" className="underline underline-offset-2 hover:text-foreground">
              调整范围
            </Link>
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RotateCcw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="比赛网站筛选">
        {sites.map(({ id, count }) => {
          const on = selected.has(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => toggleSite(id)}
              title={id}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                on ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground opacity-70'
              }`}
            >
              <SiteBadge resource={id} />
              {siteMeta(id).label}
              <span className="text-muted-foreground tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-sm">
          <CalendarDays className="size-8 opacity-50" />
          <span className="max-w-[320px] text-center">{error}</span>
          <Button variant="outline" size="sm" onClick={load}>
            <RotateCcw className="size-4" />
            重试
          </Button>
        </div>
      ) : (
        <>
          {/* 宽屏：周网格 */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <div className="bg-muted/40 grid grid-cols-7 border-b text-center text-xs font-medium">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-2 [&:not(:last-child)]:border-r">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((cell, i) => {
                const isToday = cell.key === todayKey;
                const events = byDay.get(cell.key) || [];
                const showMonth = i === 0 || cell.date.getDate() === 1;
                return (
                  <div
                    key={cell.key}
                    className={`min-h-28 border-b p-1 [&:not(:nth-child(7n))]:border-r ${
                      cell.inRange ? '' : 'bg-muted/30'
                    } ${isToday ? 'bg-primary/5' : ''}`}
                  >
                    <div className="mb-1 flex justify-end px-0.5">
                      <span
                        className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs tabular-nums ${
                          isToday
                            ? 'bg-primary text-primary-foreground font-semibold'
                            : cell.inRange
                              ? 'text-foreground'
                              : 'text-muted-foreground/50'
                        }`}
                      >
                        {showMonth ? `${cell.date.getMonth() + 1}月${cell.date.getDate()}日` : cell.date.getDate()}
                      </span>
                    </div>
                    {loading && cell.inRange ? (
                      <Skeleton className="h-5 w-full" />
                    ) : (
                      cell.inRange && (
                        <div className="space-y-0.5">
                          {events.map((c) => (
                            <EventItem key={c.id} c={c} now={now} />
                          ))}
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 窄屏：按日分组列表 */}
          <div className="space-y-3 md:hidden">
            {loading ? (
              [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : agendaDays.length === 0 ? null : (
              agendaDays.map((cell) => (
                <div key={cell.key} className="rounded-lg border">
                  <div
                    className={`border-b px-3 py-1.5 text-xs font-medium ${
                      cell.key === todayKey ? 'bg-primary/10 text-primary' : 'bg-muted/40'
                    }`}
                  >
                    {cell.date.getMonth() + 1}月{cell.date.getDate()}日 {WEEKDAYS[(cell.date.getDay() + 6) % 7]}
                    {cell.key === todayKey && ' · 今天'}
                  </div>
                  <div className="space-y-1 p-1.5">
                    {byDay.get(cell.key).map((c) => (
                      <EventItem key={c.id} c={c} now={now} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {!loading && visible.length === 0 && (
            <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-sm">
              <CalendarDays className="size-8 opacity-50" />
              <span>{selected.size === 0 ? '请在上方勾选要显示的比赛网站' : '该时间范围内没有所选网站的比赛'}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
