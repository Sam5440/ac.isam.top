'use client';

import { useEffect, useState } from 'react';
import { Flag, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clockSnapshot, formatElapsed } from '@/lib/sim-contest.mjs';

export default function SimTimer({ contest, update, problemKey = null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const clock = clockSnapshot(contest, now);
  useEffect(() => {
    if (clock.expired && contest.runningSince) update((old) => ({ ...old, ...clockSnapshot(old, Date.now()), runningSince: null, activeProblemSince: null }));
  }, [clock.expired, contest.runningSince, update]);
  const start = () => update((old) => {
    const time = Date.now();
    return { ...old, startedAt: old.startedAt || time, runningSince: time, activeProblemSince: old.activeProblem ? time : null };
  });
  const pause = () => update((old) => ({ ...old, ...clockSnapshot(old, Date.now()), runningSince: null, activeProblemSince: null }));
  const reset = () => {
    if (!window.confirm('重置本场比赛和各题计时及完成状态？')) return;
    update((old) => ({ ...old, elapsedMs: 0, runningSince: null, startedAt: null, activeProblem: null, activeProblemSince: null, problemTimes: {}, completed: {} }));
  };
  const activate = () => update((old) => {
    const time = Date.now();
    const snapshot = clockSnapshot(old, time);
    if (!old.runningSince || snapshot.expired) return old;
    const activeProblem = old.activeProblem === problemKey ? null : problemKey;
    return { ...old, problemTimes: snapshot.problemTimes, activeProblem, activeProblemSince: activeProblem ? time : null };
  });
  const complete = () => update((old) => {
    const time = Date.now();
    const snapshot = clockSnapshot(old, time);
    return { ...old, problemTimes: snapshot.problemTimes, activeProblem: old.activeProblem === problemKey ? null : old.activeProblem, activeProblemSince: old.activeProblem === problemKey ? null : old.activeProblemSince && old.runningSince ? time : old.activeProblemSince, completed: { ...old.completed, [problemKey]: !old.completed?.[problemKey] } };
  });
  return <section aria-label="比赛计时器" className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 sm:px-4">
    <div><span className="text-muted-foreground block text-xs">比赛计时{contest.minutes ? ` · 限时 ${contest.minutes} 分钟` : ''}</span><output aria-label="比赛计时" className="font-mono text-xl font-semibold tabular-nums">{formatElapsed(clock.elapsedMs)}</output></div>
    {contest.minutes > 0 && <span className="text-muted-foreground text-xs">{clock.expired ? '时间到' : `剩余 ${formatElapsed(contest.minutes * 60000 - clock.elapsedMs)}`}</span>}
    {!contest.runningSince ? <Button size="sm" disabled={clock.expired || !contest.problems.length} onClick={start}><Play className="size-3.5" />{clock.elapsedMs ? '继续比赛' : '开始比赛'}</Button> : <Button size="sm" variant="outline" onClick={pause}><Pause className="size-3.5" />暂停计时</Button>}
    <Button size="sm" variant="ghost" onClick={reset}><RotateCcw className="size-3.5" />重置</Button>
    {problemKey && <div className="flex flex-wrap items-center gap-2 sm:ml-auto"><span className="text-muted-foreground text-xs">本题 <span className="font-mono tabular-nums">{formatElapsed(clock.problemTimes[problemKey] || 0)}</span></span><Button size="sm" variant="outline" disabled={!contest.runningSince || clock.expired} onClick={activate}>{contest.activeProblem === problemKey ? '暂停本题' : '开始本题'}</Button><Button size="sm" variant="ghost" onClick={complete}><Flag className="size-3.5" />{contest.completed?.[problemKey] ? '撤销完成' : '标记完成'}</Button></div>}
  </section>;
}
