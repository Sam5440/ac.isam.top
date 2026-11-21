'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, ExternalLink, Link2, Settings2 } from 'lucide-react';
import { DifficultyBadge, TranslatedBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import SimTimer from '@/components/simulator/SimTimer';
import { useSimContest } from '@/components/simulator/useSimContest';
import { simContestHref, simProblemHref } from '@/lib/sim-contest.mjs';

const PLATFORM_NAMES = { atcoder: 'AtCoder', codeforces: 'Codeforces', 'cf-gyms': 'Gym', nowcoder: '牛客' };

export default function SimulatorContestView({ contestId }) {
  const { status, contest, message, update } = useSimContest(contestId);
  const [includeAliases, setIncludeAliases] = useState(true);
  const [notice, setNotice] = useState('');
  if (status !== 'ready') return <div className="py-10"><Card><CardContent className="flex flex-col items-center gap-3 p-10 text-center">{status === 'loading' ? <p className="text-muted-foreground text-sm">正在载入自定义比赛…</p> : <><h1 className="text-lg font-semibold">无法打开模拟赛</h1><p className="text-muted-foreground text-sm">{message}</p><Button asChild variant="outline"><Link href="/simulator">返回模拟赛</Link></Button></>}</CardContent></Card></div>;
  const problems = contest.problems;
  const translated = problems.filter((p) => p.translated).length;
  const fetched = problems.filter((p) => p.fetched).length;
  const rated = problems.filter((p) => typeof p.difficulty === 'number' && Number.isFinite(p.difficulty));
  const rating = rated.length ? Math.round(rated.reduce((sum, p) => sum + p.difficulty, 0) / rated.length) : null;
  const copy = async () => {
    const url = `${location.origin}${simContestHref(contest, includeAliases)}`;
    try { await navigator.clipboard.writeText(url); setNotice('比赛链接已复制。'); } catch { setNotice(url); }
  };
  return <div className="space-y-6 py-10">
    <Button asChild variant="ghost" size="sm"><Link href="/simulator" className="text-muted-foreground"><ArrowLeft className="size-4" />全部模拟赛</Link></Button>
    <Card><CardHeader><div className="flex flex-wrap items-start gap-4"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap gap-2"><Badge variant="secondary">自定义模拟赛</Badge><Badge variant="secondary">{problems.length} 题 · {problems.reduce((sum, p) => sum + (Number(p.points) || 0), 0)} 分</Badge></div><CardTitle className="text-2xl leading-snug">{contest.name}</CardTitle><p className="text-muted-foreground mt-2 text-xs">{contest.minutes ? `${contest.minutes} 分钟` : '不限时'} · 本机保存</p></div><Button asChild size="sm" variant="outline"><Link href={`/simulator?edit=${encodeURIComponent(contest.id)}`}><Settings2 className="size-4" />比赛设置</Link></Button></div></CardHeader><CardContent className="flex flex-wrap items-center gap-3 border-t pt-4"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeAliases} onChange={(e) => setIncludeAliases(e.target.checked)} />分享时带上题目别名</label><Button size="sm" variant="outline" onClick={copy}><Link2 className="size-4" />复制当场链接</Button>{notice && <span role="status" className="text-muted-foreground break-all text-xs">{notice}</span>}</CardContent></Card>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_260px]"><div className="min-w-0 space-y-4"><SimTimer contest={contest} update={update} /><Card><CardContent className="divide-y p-0" aria-label="比赛题目">{problems.map((problem, index) => {
      const row = <><span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md font-mono text-sm font-bold">{index + 1}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium">{problem.alias || problem.titleZh || problem.title || problem.id}</span><Badge variant="outline">{PLATFORM_NAMES[problem.platform] || problem.platform}</Badge><Badge variant="secondary">{problem.points} 分</Badge></span><span className="text-muted-foreground mt-1 block truncate text-xs">{problem.id} · {problem.titleZh || problem.title || '原题名称未知'}</span></span>{problem.found === false ? <span className="text-amber-600 inline-flex shrink-0 items-center gap-1 text-xs">本站未收录 · 原题链接<ExternalLink className="size-3.5" /></span> : <span className="flex shrink-0 items-center gap-2"><DifficultyBadge difficulty={problem.difficulty} platform={problem.platform} /><TranslatedBadge translated={Boolean(problem.translated)} /></span>}</>;
      const className = 'hover:bg-accent/40 flex items-center gap-3 px-4 py-3 transition-colors sm:px-6';
      return problem.found === false ? <a key={problem.key || index} href={problem.originalUrl} target="_blank" rel="noreferrer" className={className}>{row}</a> : <Link key={problem.key || index} href={simProblemHref(contest, index)} className={className}>{row}</Link>;
    })}</CardContent></Card></div>
    <aside className="space-y-4"><Card><CardHeader><CardTitle className="text-sm">比赛信息</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><div className="flex justify-between gap-2"><span className="text-muted-foreground">翻译程度</span><span>{translated} / {problems.length}</span></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">抓取程度</span><span>{fetched} / {problems.length}</span></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">平均评级</span><span>{rating === null ? '未评级' : rating}</span></div><p className="text-muted-foreground text-xs">平均评级基于 {rated.length} 道有评级的题目。</p></CardContent></Card></aside></div>
  </div>;
}
