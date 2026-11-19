'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BookOpen, CalendarDays, CheckCircle2, Clock3, CloudSun, ExternalLink,
  FileCode2, FileText, History, Languages, Layers, MapPin, RefreshCw, Trophy,
  Wind, XCircle,
} from 'lucide-react';

import { DifficultyBadge, PlatformBadge } from '@/components/Badges';
import { DEFAULT_CALENDAR_SITES, useSettings } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { contestSiteMeta } from '@/lib/contest-sites';
import { contestType } from '@/lib/contest-type';
import {
  formatContestDuration, fromClistContest, fromInternalContest, homeClistRange,
  mergeUpcomingContests, visibleUpcomingContests,
} from '@/lib/home-upcoming.mjs';
import { listFiles } from '@/lib/ide-workspace';
import { listHistory } from '@/lib/view-history';
import {
  groupHistoryContests, normalizeCfHandle, selectHistory, selectHomeContests,
  selectHomeProblems, weatherInfo, widgetLimit,
} from '@/lib/home-layout.mjs';
import { formatDateTime } from '@/lib/utils';

const boolAttr = (value) => value === true || value === '' || value === 'true' || value === '1';

async function fetchWithTimeout(url, signal, timeoutMs = 15_000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('请求超时，请检查网络后重试')), timeoutMs);
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function Empty({ children, href, action }) {
  return (
    <div className="text-muted-foreground rounded-xl border border-dashed px-4 py-7 text-center text-sm">
      <p>{children}</p>
      {href && <Link href={href} className="text-primary mt-2 inline-block text-xs underline-offset-4 hover:underline">{action || '前往查看'}</Link>}
    </div>
  );
}

function Loading({ rows = 3 }) {
  return (
    <div className="space-y-2" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="bg-muted h-14 animate-pulse rounded-xl border" />)}
    </div>
  );
}

export function HomeHero({ attrs }) {
  const compact = boolAttr(attrs.compact);
  return (
    <section className={compact ? 'py-6' : 'py-12 sm:py-16'}>
      <h1 className={`max-w-3xl font-bold tracking-tight ${compact ? 'text-3xl' : 'text-4xl sm:text-5xl'}`}>
        AC 题库 <span className="text-muted-foreground">AtCoder · Codeforces · 牛客</span>
      </h1>
      <p className="text-muted-foreground mt-4 max-w-2xl">
        {attrs.subtitle || '自动抓取竞赛题目：完整题面、样例数据、难度分级，并由 AI 翻译为简体中文。数据随 GitHub Actions 持续更新。'}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild><Link href="/problems" prefetch={false}><BookOpen className="size-4" />浏览题库</Link></Button>
        <Button asChild variant="outline"><Link href="/contests" prefetch={false}><Layers className="size-4" />查看比赛</Link></Button>
      </div>
    </section>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <Card><CardContent className="flex items-center gap-4 p-5">
      <div className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-lg"><Icon className="size-5" /></div>
      <div className="min-w-0"><div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div><div className="text-muted-foreground text-xs">{label}</div></div>
    </CardContent></Card>
  );
}

export function HomeStats({ data }) {
  const stats = data.stats;
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard icon={FileText} label="收录题目" value={Number(stats.problems).toLocaleString('zh-CN')} />
      <StatCard icon={Trophy} label="收录比赛" value={Number(stats.contests).toLocaleString('zh-CN')} />
      <StatCard icon={Languages} label="已翻译题面" value={Number(stats.translated).toLocaleString('zh-CN')} />
      <StatCard icon={Clock3} label="数据更新" value={data.generatedAt ? formatDateTime(data.generatedAt) : '—'} />
    </section>
  );
}

export function HomeSection({ attrs, children }) {
  return (
    <section>
      {(attrs.title || attrs.href) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-xl font-semibold tracking-tight">{attrs.title}</h2>{attrs.subtitle && <p className="text-muted-foreground mt-1 text-xs">{attrs.subtitle}</p>}</div>
          {attrs.href && <Button asChild variant="ghost" size="sm"><Link href={attrs.href} prefetch={false} className="text-muted-foreground">{attrs.more || '查看更多'}<ArrowRight className="size-3.5" /></Link></Button>}
        </div>
      )}
      {children}
    </section>
  );
}

function ContestCompactList({ list, fetched }) {
  return (
    <Card><CardContent className="divide-y p-0">
      {list.map((contest) => (
        <Link key={`${contest.platform}/${contest.id}`} href={`/contests/${contest.platform}/${encodeURIComponent(String(contest.id))}`} className="hover:bg-accent/40 flex items-center gap-3 px-4 py-3 transition-colors">
          <PlatformBadge platform={contest.platform} fixed hideBelow="sm" />
          <span className="min-w-0 flex-1 truncate text-sm">{contest.titleZh || contest.title}</span>
          <span className="text-muted-foreground shrink-0 text-xs">{formatDateTime(fetched ? contest.fetchedAt : contest.startTime)}</span>
        </Link>
      ))}
    </CardContent></Card>
  );
}

function UpcomingSiteBadge({ resource }) {
  const meta = contestSiteMeta(resource);
  return <span className={`inline-flex h-5 min-w-6 shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold text-white ${meta.badge}`} title={meta.label}>{meta.short}</span>;
}

function UpcomingContestRow({ contest }) {
  const meta = contestSiteMeta(contest.resource);
  const className = 'hover:bg-accent/40 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors';
  const content = <>
    <UpcomingSiteBadge resource={contest.resource} />
    <span className="min-w-0 flex-1 basis-56">
      <span className="block truncate text-sm font-medium" title={contest.event}>{contest.event}</span>
      <span className="text-muted-foreground block text-xs">{meta.label}{contest.internal ? ` · ${contest.problemCount} 道题目` : ' · 官方网站'}</span>
    </span>
    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{formatDateTime(contest.start)}</span>
    <span className="text-muted-foreground hidden w-24 shrink-0 text-right text-xs sm:block">{contest.duration ? formatContestDuration(contest.duration) : '时长未知'}</span>
    <ExternalLink className="text-muted-foreground size-3.5 shrink-0" />
  </>;
  return contest.internal
    ? <Link href={contest.href} className={className}>{content}</Link>
    : <a href={contest.href} target="_blank" rel="noreferrer" className={className}>{content}</a>;
}

export function HomeUpcomingContests({ attrs, data, now }) {
  const { settings } = useSettings();
  const after = Math.min(60, Math.max(1, Number(settings.calendarDaysAfter) || 15));
  const [external, setExternal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError('');
    const range = homeClistRange(Date.now(), after);
    const params = new URLSearchParams({ ...range, limit: '500', order_by: 'start' });
    fetchWithTimeout(`/api/contests/clist?${params}`, controller.signal, 20_000)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || `请求失败（HTTP ${response.status}）`);
        if (alive) setExternal((Array.isArray(body.contests) ? body.contests : []).map(fromClistContest));
      })
      .catch((reason) => {
        if (alive && reason.name !== 'AbortError') setError(reason?.message || '比赛日程加载失败');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [after, attempt]);

  const selected = useMemo(
    () => new Set(Array.isArray(settings.calendarSites) ? settings.calendarSites : DEFAULT_CALENDAR_SITES),
    [settings.calendarSites],
  );
  const internal = useMemo(() => selectHomeContests(data, 'upcoming', now).map(fromInternalContest), [data, now]);
  const merged = useMemo(() => mergeUpcomingContests(internal, external ?? []), [internal, external]);
  const list = visibleUpcomingContests(merged, selected, attrs.platform, now).slice(0, widgetLimit(attrs.limit));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">未来 {after} 天 · 网站筛选请在<Link href="/calendar" className="mx-0.5 underline underline-offset-2 hover:text-foreground">比赛日历</Link>中设置</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)} disabled={loading} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs disabled:opacity-40">
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />刷新赛程
        </button>
      </div>
      {error && <div className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs text-amber-500">Clist 日程暂未更新：{error}{internal.length ? '，当前显示题库回退数据。' : '。'}</div>}
      {loading && external === null ? <Loading rows={4} /> : list.length ? (
        <Card><CardContent className="divide-y p-0">{list.map((contest) => <UpcomingContestRow key={contest.key} contest={contest} />)}</CardContent></Card>
      ) : (
        <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          <CalendarDays className="size-7 opacity-50" />
          <span>{selected.size === 0 ? '请在比赛日历中勾选要显示的比赛网站' : `未来 ${after} 天内，所选网站暂无比赛`}</span>
        </div>
      )}
    </div>
  );
}

export function HomeContests({ attrs, data, now }) {
  const { settings } = useSettings();
  const kind = ['recent', 'latest', 'upcoming', 'fetched'].includes(attrs.kind) ? attrs.kind : 'recent';
  if (kind === 'upcoming') return <HomeUpcomingContests attrs={attrs} data={data} now={now} />;
  const limit = widgetLimit(attrs.limit);
  const enabled = new Set(settings.homeContestTypes || []);
  const list = selectHomeContests(data, kind, now)
    .filter((contest) => !attrs.platform || contest.platform === attrs.platform)
    .filter((contest) => enabled.size === 0 || enabled.has(contestType(contest)))
    .slice(0, limit);
  if (!list.length) return <Empty href="/contests" action="查看全部比赛">当前筛选条件下暂无比赛。</Empty>;
  if (boolAttr(attrs.compact)) return <ContestCompactList list={list} fetched={kind === 'fetched'} />;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {list.map((contest) => (
        <Link key={`${contest.platform}/${contest.id}`} href={`/contests/${contest.platform}/${encodeURIComponent(String(contest.id))}`} className="group">
          <Card className="h-full transition-colors group-hover:border-foreground/25"><CardContent className="space-y-2 p-5">
            <div className="flex flex-wrap items-center gap-2"><PlatformBadge platform={contest.platform} /><span className="text-muted-foreground font-mono text-xs">{formatDateTime(contest.startTime)}</span></div>
            <div className="line-clamp-2 font-medium leading-snug">{contest.titleZh || contest.title}</div>
            <div className="text-muted-foreground text-xs">{contest.problemCount || 0} 道题目{kind === 'fetched' ? ' · 按拉取时间排序' : ''}</div>
          </CardContent></Card>
        </Link>
      ))}
    </div>
  );
}

export function HomeProblems({ attrs, data }) {
  const kind = attrs.kind === 'fetched' ? 'fetched' : 'recent';
  const list = selectHomeProblems(data, kind)
    .filter((problem) => !attrs.platform || problem.platform === attrs.platform)
    .slice(0, widgetLimit(attrs.limit, 10));
  if (!list.length) return <Empty>暂无题目数据。</Empty>;
  return (
    <Card><CardContent className="divide-y p-0">
      {list.map((problem) => (
        <Link key={`${problem.platform}/${problem.id}`} href={`/problems/${problem.platform}/${encodeURIComponent(problem.id)}`} className="hover:bg-accent/40 flex items-center gap-3 px-4 py-3 transition-colors">
          <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-md font-mono text-sm font-bold">{problem.index}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{problem.titleZh || problem.title}<span className="text-muted-foreground ml-2 hidden font-mono text-xs sm:inline">{problem.id}</span></span>
          <PlatformBadge platform={problem.platform} fixed hideBelow="sm" />
          <DifficultyBadge difficulty={problem.difficulty} platform={problem.platform} fixed />
        </Link>
      ))}
    </CardContent></Card>
  );
}

function Judge({ value }) {
  if (value === 'ac') return <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-500"><CheckCircle2 className="size-3.5" />通过</span>;
  if (value === 'fail') return <span className="inline-flex shrink-0 items-center gap-1 text-xs text-red-500"><XCircle className="size-3.5" />未过</span>;
  return null;
}

export function HomeHistory({ attrs }) {
  const [records, setRecords] = useState(null);
  useEffect(() => {
    let alive = true;
    listHistory({ minDwellMs: 0 }).then((rows) => { if (alive) setRecords(rows); });
    return () => { alive = false; };
  }, []);
  if (records === null) return <Loading />;
  const kind = attrs.kind === 'practiced' ? 'practiced' : 'viewed';
  const list = selectHistory(records, kind)
    .filter((record) => !attrs.platform || record.platform === attrs.platform)
    .slice(0, widgetLimit(attrs.limit));
  if (!list.length) return <Empty href="/problems" action="去题库看看">{kind === 'practiced' ? '还没有样例运行记录。' : '还没有题目浏览记录。'}</Empty>;
  return (
    <Card><CardContent className="divide-y p-0">
      {list.map((record) => (
        <Link key={`${record.platform}/${record.problemId}`} href={`/problems/${record.platform}/${encodeURIComponent(String(record.problemId))}`} className="hover:bg-accent/40 flex items-center gap-3 px-4 py-3 transition-colors">
          <History className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm">{record.titleZh || record.title || record.problemId}</span><span className="text-muted-foreground block text-xs">{record.platform} · {record.problemId} · {formatDateTime(kind === 'practiced' ? record.lastJudge?.at : record.lastSeen)}</span></span>
          <Judge value={record.lastJudge?.verdict} />
        </Link>
      ))}
    </CardContent></Card>
  );
}

export function HomeHistoryContests({ attrs }) {
  const [records, setRecords] = useState(null);
  useEffect(() => {
    let alive = true;
    listHistory({ minDwellMs: 0 }).then((rows) => { if (alive) setRecords(rows); });
    return () => { alive = false; };
  }, []);
  if (records === null) return <Loading />;
  const kind = attrs.kind === 'practiced' ? 'practiced' : 'viewed';
  const list = groupHistoryContests(records, kind)
    .filter((contest) => !attrs.platform || contest.platform === attrs.platform)
    .slice(0, widgetLimit(attrs.limit));
  if (!list.length) return <Empty href="/problems" action="开始刷题">{kind === 'practiced' ? '运行题目样例后，这里会按比赛聚合。' : '打开题目后，这里会按比赛聚合。'}</Empty>;
  return (
    <Card><CardContent className="divide-y p-0">
      {list.map((contest) => (
        <Link key={`${contest.platform}/${contest.id}`} href={`/contests/${contest.platform}/${encodeURIComponent(String(contest.id))}`} className="hover:bg-accent/40 flex items-center gap-3 px-4 py-3 transition-colors">
          <PlatformBadge platform={contest.platform} fixed hideBelow="sm" />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm">{contest.titleZh || contest.title}</span><span className="text-muted-foreground text-xs">{contest.problemCount} 题 · {formatDateTime(contest.lastAt)}</span></span>
          {contest.accepted > 0 && <span className="shrink-0 text-xs text-emerald-500">AC {contest.accepted}</span>}
        </Link>
      ))}
    </CardContent></Card>
  );
}

export function HomeFiles({ attrs }) {
  const [files, setFiles] = useState(null);
  useEffect(() => {
    let alive = true;
    listFiles().then((rows) => { if (alive) setFiles(rows); }).catch(() => { if (alive) setFiles([]); });
    return () => { alive = false; };
  }, []);
  if (files === null) return <Loading />;
  const list = [...files].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, widgetLimit(attrs.limit));
  if (!list.length) return <Empty href="/ide" action="打开 IDE">工作区还没有文件。</Empty>;
  return (
    <Card><CardContent className="divide-y p-0">
      {list.map((file) => (
        <Link key={file.path} href="/ide" className="hover:bg-accent/40 flex items-center gap-3 px-4 py-3 transition-colors" title={`在 IDE 中打开：${file.path}`}>
          <FileCode2 className="text-primary size-4 shrink-0" />
          <span className="min-w-0 flex-1"><span className="block truncate font-mono text-sm">{file.path}</span><span className="text-muted-foreground text-xs">{file.lang === 'python' ? 'Python' : 'C++'} · 编辑于 {formatDateTime(file.updatedAt)}</span></span>
          <ArrowRight className="text-muted-foreground size-3.5 shrink-0" />
        </Link>
      ))}
    </CardContent></Card>
  );
}

export function HomeCfRating({ attrs }) {
  const { settings } = useSettings();
  const handle = normalizeCfHandle(attrs.handle || settings.homeCfHandle);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    if (!handle) { setState({ status: 'missing' }); return undefined; }
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchWithTimeout(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(handle)}`, controller.signal)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (body.status !== 'OK' || !body.result?.[0]) throw new Error(body.comment || '用户不存在');
        setState({ status: 'ready', user: body.result[0] });
      })
      .catch((error) => { if (error.name !== 'AbortError') setState({ status: 'error', message: error.message }); });
    return () => controller.abort();
  }, [handle, attempt]);
  return (
    <Card><CardContent className="flex min-h-36 flex-col justify-center p-5">
      <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground text-xs font-medium">CODEFORCES RATING</span>{handle && <button type="button" aria-label="刷新 Codeforces Rating" title="刷新" onClick={() => setAttempt((n) => n + 1)} className="text-muted-foreground hover:text-foreground"><RefreshCw className={`size-3.5 ${state.status === 'loading' ? 'animate-spin' : ''}`} /></button>}</div>
      {state.status === 'missing' && <div className="mt-3"><p className="font-medium">尚未设置 CF Handle</p><Link href="/settings#home" className="text-primary mt-2 inline-block text-xs underline">在首页布局设置中填写</Link></div>}
      {state.status === 'loading' && <div className="mt-4 space-y-2"><div className="bg-muted h-8 w-28 animate-pulse rounded" /><div className="bg-muted h-3 w-40 animate-pulse rounded" /></div>}
      {state.status === 'error' && <p className="mt-3 text-sm text-red-400">Rating 拉取失败：{state.message}</p>}
      {state.status === 'ready' && <div className="mt-2"><a href={`https://codeforces.com/profile/${encodeURIComponent(handle)}`} target="_blank" rel="noreferrer" className="group inline-flex items-end gap-2"><span className="text-4xl font-bold tracking-tight tabular-nums">{state.user.rating ?? '未定级'}</span><ExternalLink className="text-muted-foreground mb-1 size-4" /></a><p className="mt-1 truncate text-sm font-medium">{state.user.handle} · {state.user.rank || 'unrated'}</p><p className="text-muted-foreground text-xs">最高 {state.user.maxRating ?? '—'} · {state.user.maxRank || '—'}</p></div>}
    </CardContent></Card>
  );
}

export function HomeWeather({ attrs }) {
  const { settings } = useSettings();
  const global = settings.homeWeather;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: 'loading' });
  const config = useMemo(() => ({
    city: attrs.city || global?.city || '北京',
    latitude: attrs.latitude ?? attrs.lat,
    longitude: attrs.longitude ?? attrs.lon,
    unit: attrs.unit === 'fahrenheit' ? 'fahrenheit' : attrs.unit === 'celsius' ? 'celsius' : global?.unit || 'celsius',
    useGlobalCoordinates: !attrs.city && attrs.latitude == null && attrs.lat == null,
  }), [attrs.city, attrs.latitude, attrs.lat, attrs.longitude, attrs.lon, attrs.unit, global]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    const load = async () => {
      let latitude = config.useGlobalCoordinates ? global?.latitude : config.latitude;
      let longitude = config.useGlobalCoordinates ? global?.longitude : config.longitude;
      let place = config.city;
      if (latitude == null || longitude == null || latitude === '' || longitude === '') {
        const response = await fetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(config.city)}&count=1&language=zh&format=json`, controller.signal);
        if (!response.ok) throw new Error(`地理编码 HTTP ${response.status}`);
        const body = await response.json();
        const result = body.results?.[0];
        if (!result) throw new Error(`找不到城市「${config.city}」`);
        latitude = result.latitude;
        longitude = result.longitude;
        place = [result.name, result.admin1, result.country].filter(Boolean).join(' · ');
      }
      const query = new URLSearchParams({
        latitude: String(latitude), longitude: String(longitude),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
        daily: 'temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '1',
        temperature_unit: config.unit,
      });
      const response = await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${query}`, controller.signal);
      if (!response.ok) throw new Error(`天气 HTTP ${response.status}`);
      const body = await response.json();
      if (!body.current) throw new Error('天气接口未返回当前天气');
      setState({ status: 'ready', weather: body, place });
    };
    load().catch((error) => { if (error.name !== 'AbortError') setState({ status: 'error', message: error.message }); });
    return () => controller.abort();
  }, [config, global?.latitude, global?.longitude, attempt]);
  const current = state.weather?.current;
  const [label] = weatherInfo(current?.weather_code);
  const unit = state.weather?.current_units?.temperature_2m || (config.unit === 'fahrenheit' ? '°F' : '°C');
  return (
    <Card><CardContent className="min-h-36 p-5">
      <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground flex items-center gap-1.5 text-xs"><MapPin className="size-3.5" />{state.place || config.city}</span><button type="button" aria-label="刷新天气" title="刷新天气" onClick={() => setAttempt((n) => n + 1)} className="text-muted-foreground hover:text-foreground"><RefreshCw className={`size-3.5 ${state.status === 'loading' ? 'animate-spin' : ''}`} /></button></div>
      {state.status === 'loading' && <div className="mt-4 space-y-2"><div className="bg-muted h-9 w-32 animate-pulse rounded" /><div className="bg-muted h-3 w-40 animate-pulse rounded" /></div>}
      {state.status === 'error' && <p className="mt-4 text-sm text-red-400">天气拉取失败：{state.message}</p>}
      {state.status === 'ready' && <div className="mt-2 flex items-end justify-between gap-3"><div><div className="flex items-center gap-2"><CloudSun className="text-primary size-7" /><span className="text-4xl font-bold tracking-tight tabular-nums">{Math.round(current.temperature_2m)}{unit}</span></div><p className="mt-1 text-sm">{label} · 体感 {Math.round(current.apparent_temperature)}{unit}</p></div><div className="text-muted-foreground text-right text-xs"><p className="flex items-center justify-end gap-1"><Wind className="size-3" />{current.wind_speed_10m} km/h</p><p className="mt-1">湿度 {current.relative_humidity_2m}%</p><p className="mt-1">{Math.round(state.weather.daily?.temperature_2m_min?.[0])}{unit} / {Math.round(state.weather.daily?.temperature_2m_max?.[0])}{unit}</p></div></div>}
    </CardContent></Card>
  );
}

export function HomeClock({ attrs }) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const hour = now ? Number(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(now)) : 12;
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  return (
    <section className={boolAttr(attrs.compact) ? '' : 'rounded-2xl border bg-card p-6'}>
      <p className="text-muted-foreground text-sm">{greeting}{attrs.name ? `，${attrs.name}` : ''}</p>
      <div className={`mt-1 font-bold tracking-tight tabular-nums ${boolAttr(attrs.compact) ? 'text-2xl' : 'text-4xl'}`}>{now ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now) : '--:--:--'}</div>
      <p className="text-muted-foreground mt-1 text-xs">{now ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now) : '北京时间'}</p>
    </section>
  );
}

export function HomeSiteUpdate({ data }) {
  return <div className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"><Clock3 className="size-3.5" />数据更新于 {formatDateTime(data.generatedAt)}</div>;
}
