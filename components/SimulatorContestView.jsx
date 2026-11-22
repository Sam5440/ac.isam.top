'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Link2, Settings2 } from 'lucide-react';
import { DifficultyBadge, TranslatedBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import SimTimer from '@/components/simulator/SimTimer';
import { useSimContest } from '@/components/simulator/useSimContest';
import {
  normalizeShareMode,
  normalizeSimSort,
  orderSimProblems,
  simContestHref,
  simProblemHref,
  simProblemLabel,
} from '@/lib/sim-contest.mjs';
import { formatDate } from '@/lib/utils';

const PLATFORM_NAMES = { atcoder: 'AtCoder', codeforces: 'Codeforces', 'cf-gyms': 'Gym', nowcoder: '牛客' };

const SORT_BUTTONS = [
  { by: 'original', label: '原始顺序', hint: '按题单录入顺序' },
  { by: 'time', label: '出现时间', hint: '按原比赛开始时间排序' },
  { by: 'difficulty', label: '难度', hint: '按题目难度评级排序' },
];

const SEGMENT_CLS = 'inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors';
const SEGMENT_ON = 'bg-primary text-primary-foreground';
const SEGMENT_OFF = 'text-muted-foreground hover:text-foreground';

export default function SimulatorContestView({ contestId }) {
  const { status, contest, message, update } = useSimContest(contestId);
  const [includeAliases, setIncludeAliases] = useState(true);
  const [notice, setNotice] = useState('');
  if (status !== 'ready') return <div className="py-10"><Card><CardContent className="flex flex-col items-center gap-3 p-10 text-center">{status === 'loading' ? <p className="text-muted-foreground text-sm">正在载入自定义比赛…</p> : <><h1 className="text-lg font-semibold">无法打开模拟赛</h1><p className="text-muted-foreground text-sm">{message}</p><Button asChild variant="outline"><Link href="/simulator">返回模拟赛</Link></Button></>}</CardContent></Card></div>;
  const problems = contest.problems;
  const shareMode = normalizeShareMode(contest.shareMode);
  const sort = normalizeSimSort(contest.sort);
  const ordered = orderSimProblems(problems, sort);
  const translated = problems.filter((p) => p.translated).length;
  const fetched = problems.filter((p) => p.fetched).length;
  const rated = problems.filter((p) => typeof p.difficulty === 'number' && Number.isFinite(p.difficulty));
  const rating = rated.length ? Math.round(rated.reduce((sum, p) => sum + p.difficulty, 0) / rated.length) : null;
  const setMode = (mode) => {
    update((old) => ({ ...old, shareMode: mode }));
    history.replaceState(history.state, '', simContestHref(contest, includeAliases, mode));
  };
  const toggleAliases = (checked) => {
    setIncludeAliases(checked);
    history.replaceState(history.state, '', simContestHref(contest, checked, shareMode));
  };
  // 点已激活的排序项切换正/反序，点其它项则以正序启用。
  const setSort = (by) => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    const next = normalizeSimSort({ by, dir });
    update((old) => ({ ...old, sort: next }));
    history.replaceState(history.state, '', simContestHref({ ...contest, sort: next }, includeAliases, shareMode));
  };
  const copy = async () => {
    const url = `${location.origin}${simContestHref(contest, includeAliases, shareMode)}`;
    try { await navigator.clipboard.writeText(url); setNotice(shareMode === 'base64' ? '兼容链接（Base64）已复制，经过短链接也不会丢失字符。' : '比赛链接已复制。'); } catch { setNotice(url); }
  };
  return <div className="space-y-6 py-10">
    <Button asChild variant="ghost" size="sm"><Link href="/simulator" className="text-muted-foreground"><ArrowLeft className="size-4" />全部模拟赛</Link></Button>
    <Card><CardHeader><div className="flex flex-wrap items-start gap-4"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap gap-2"><Badge variant="secondary">自定义模拟赛</Badge><Badge variant="secondary">{problems.length} 题 · {problems.reduce((sum, p) => sum + (Number(p.points) || 0), 0)} 分</Badge></div><CardTitle className="text-2xl leading-snug">{contest.name}</CardTitle><p className="text-muted-foreground mt-2 text-xs">{contest.minutes ? `${contest.minutes} 分钟` : '不限时'} · 本机保存</p></div><Button asChild size="sm" variant="outline"><Link href={`/simulator?edit=${encodeURIComponent(contest.id)}`}><Settings2 className="size-4" />比赛设置</Link></Button></div></CardHeader><CardContent className="flex flex-wrap items-center gap-3 border-t pt-4"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeAliases} onChange={(e) => toggleAliases(e.target.checked)} />分享时带上题目别名</label><div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="分享链接模式"><button type="button" aria-pressed={shareMode === 'url'} onClick={() => setMode('url')} className={`${SEGMENT_CLS} ${shareMode === 'url' ? SEGMENT_ON : SEGMENT_OFF}`}>普通</button><button type="button" aria-pressed={shareMode === 'base64'} onClick={() => setMode('base64')} className={`${SEGMENT_CLS} ${shareMode === 'base64' ? SEGMENT_ON : SEGMENT_OFF}`}>兼容（Base64）</button></div><Button size="sm" variant="outline" onClick={copy}><Link2 className="size-4" />复制当场链接</Button>{notice && <span role="status" className="text-muted-foreground break-all text-xs">{notice}</span>}</CardContent></Card>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_260px]"><div className="min-w-0 space-y-4"><SimTimer contest={contest} update={update} /><Card><CardContent className="p-0"><div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-6"><span className="text-muted-foreground text-xs">排序</span><div className="flex flex-wrap rounded-md border p-0.5 text-xs" role="group" aria-label="题目排序">{SORT_BUTTONS.map(({ by, label, hint }) => {
      const active = sort.by === by;
      return <button key={by} type="button" title={hint} aria-pressed={active} onClick={() => setSort(by)} className={`${SEGMENT_CLS} ${active ? SEGMENT_ON : SEGMENT_OFF}`}>{label}{active && by !== 'original' && (sort.dir === 'asc' ? <ArrowUp className="size-3" aria-label="正序" /> : <ArrowDown className="size-3" aria-label="反序" />)}</button>;
    })}</div><span className="text-muted-foreground text-xs">{sort.by === 'original' ? '题号随显示位置重排，原题号始终保留' : sort.by === 'time' ? (sort.dir === 'asc' ? '由早到晚 · 再次点击切换' : '由晚到早 · 再次点击切换') : (sort.dir === 'asc' ? '由易到难 · 再次点击切换' : '由难到易 · 再次点击切换')}</span></div><div className="divide-y" aria-label="比赛题目">{ordered.map(({ problem, sourceIndex }, position) => {
      const row = <><span className="bg-muted text-muted-foreground grid h-9 min-w-9 shrink-0 place-items-center rounded-md px-1 font-mono text-sm font-bold">{simProblemLabel(position)}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium">{problem.alias || problem.titleZh || problem.title || problem.id}</span><Badge variant="outline">{PLATFORM_NAMES[problem.platform] || problem.platform}</Badge><Badge variant="secondary">{problem.points} 分</Badge></span><span className="text-muted-foreground mt-1 block truncate text-xs">{problem.id} · {problem.titleZh || problem.title || '原题名称未知'}{sort.by === 'time' && problem.startTime ? ` · ${formatDate(problem.startTime)}` : ''}</span></span>{problem.found === false ? <span className="text-amber-600 inline-flex shrink-0 items-center gap-1 text-xs">本站未收录 · 原题链接<ExternalLink className="size-3.5" /></span> : <span className="flex shrink-0 items-center gap-2"><DifficultyBadge difficulty={problem.difficulty} platform={problem.platform} /><TranslatedBadge translated={Boolean(problem.translated)} /></span>}</>;
      const className = 'hover:bg-accent/40 flex items-center gap-3 px-4 py-3 transition-colors sm:px-6';
      return problem.found === false ? <a key={problem.key || sourceIndex} href={problem.originalUrl} target="_blank" rel="noreferrer" className={className}>{row}</a> : <Link key={problem.key || sourceIndex} href={simProblemHref(contest, sourceIndex, true, shareMode)} className={className}>{row}</Link>;
    })}</div></CardContent></Card></div>
    <aside className="space-y-4"><Card><CardHeader><CardTitle className="text-sm">比赛信息</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><div className="flex justify-between gap-2"><span className="text-muted-foreground">翻译程度</span><span>{translated} / {problems.length}</span></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">抓取程度</span><span>{fetched} / {problems.length}</span></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">平均评级</span><span>{rating === null ? '未评级' : rating}</span></div><p className="text-muted-foreground text-xs">平均评级基于 {rated.length} 道有评级的题目。</p></CardContent></Card></aside></div>
  </div>;
}