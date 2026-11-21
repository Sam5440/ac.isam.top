'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clock, ExternalLink, MemoryStick, Tag } from 'lucide-react';
import { DifficultyBadge, PlatformBadge } from '@/components/Badges';
import AiFab from '@/components/chat/AiFab';
import CopyProblemButton from '@/components/CopyProblemButton';
import ProblemStatementViewer from '@/components/ProblemStatementViewer';
import ProblemViewShell, { ProblemCompiler, ProblemLetterRail, ProblemSwitcher, ProblemTopBar } from '@/components/ProblemViewShell';
import SamplesSection from '@/components/SamplesSection';
import ViewHistoryTracker from '@/components/ViewHistoryTracker';
import SimTimer from '@/components/simulator/SimTimer';
import { useSimContest } from '@/components/simulator/useSimContest';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { originalProblemUrl, simContestHref, simProblemHref } from '@/lib/sim-contest.mjs';
import { pairSegments } from '@/lib/statement-segments';
import { tagZh } from '@/lib/tags';

export default function SimulatorProblemView({ contestId, number }) {
  const { status, contest, message, update } = useSimContest(contestId);
  const index = /^\d+$/.test(number) ? Number(number) - 1 : -1;
  const entry = contest?.problems[index];
  const entryKey = `${entry?.platform}:${entry?.id}`;
  const [result, setResult] = useState({ status: 'loading' });
  useEffect(() => {
    if (!entry) return;
    const controller = new AbortController();
    setResult({ status: 'loading' });
    fetch(`/api/problems/${entry.platform}/${encodeURIComponent(entry.id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? '本站尚未收录这道题。' : '题面暂时无法加载。');
        return response.json();
      })
      .then((problem) => setResult({ status: 'ready', problem, key: `${entry.platform}:${entry.id}` }))
      .catch((error) => { if (error.name !== 'AbortError') setResult({ status: 'error', message: error.message, key: `${entry.platform}:${entry.id}` }); });
    return () => controller.abort();
  }, [entry?.platform, entry?.id]);
  const problem = result.key === entryKey ? result.problem : null;
  const segments = useMemo(() => problem ? pairSegments(problem.statementMd, problem.statementZhMd) : [], [problem]);
  const problemsList = useMemo(() => (contest?.problems || []).map((item, i) => ({
    ...item,
    navKey: i,
    index: String(i + 1),
    title: item.alias || item.titleZh || item.title || item.id,
    titleZh: null,
    statementZhMd: Boolean(item.translated),
    href: simProblemHref(contest, i),
    ...(i === index && problem ? { samples: problem.samples, timeLimitMs: problem.timeLimitMs, memoryLimitMb: problem.memoryLimitMb, url: problem.url } : {}),
  })), [contest?.problems, contest?.id, contest?.name, contest?.minutes, index, problem]);
  if (status !== 'ready') return <div className="text-muted-foreground py-16 text-center">{status === 'loading' ? '正在载入模拟赛…' : message}</div>;
  if (!entry) return <div className="space-y-4 py-10"><p>比赛中没有这道题。</p><Button asChild variant="outline"><Link href={simContestHref(contest)}>返回模拟赛</Link></Button></div>;
  const current = { ...problemsList[index], contestId: contest.id };
  const contestContext = { id: contest.id, platform: 'sim', title: contest.name, problemsList };
  const url = problem?.url || entry.originalUrl || originalProblemUrl(entry.platform, entry.id);
  return <ProblemViewShell rail={<ProblemLetterRail contest={contestContext} current={current} />}>
    <ProblemCompiler contest={contestContext} current={current} />
    {problem && <><AiFab problem={{ ...problem, platform: entry.platform }} /><ViewHistoryTracker platform={entry.platform} problemId={problem.id} title={problem.title} titleZh={problem.titleZh ?? null} contestId={problem.contestId} url={problem.url} /></>}
    <Button asChild variant="ghost" size="sm"><Link href={simContestHref(contest)} className="text-muted-foreground"><ArrowLeft className="size-4" />返回模拟赛 · {contest.name}</Link></Button>
    <div className="min-w-0 space-y-6">
      <SimTimer contest={contest} update={update} problemKey={entry.key} />
      <ProblemTopBar contest={contestContext} current={current} />
      <Card><CardHeader><div className="flex flex-wrap items-start gap-4"><div className="bg-primary text-primary-foreground grid size-12 shrink-0 place-items-center rounded-lg text-xl font-bold">{index + 1}</div><div className="min-w-0 flex-1 basis-56"><CardTitle className="text-xl leading-snug break-words">{entry.alias || problem?.titleZh || problem?.title || entry.titleZh || entry.title || entry.id}</CardTitle><CardDescription className="mt-1">{entry.id} · {problem?.titleZh || problem?.title || entry.titleZh || entry.title || '原题名称未知'}</CardDescription><div className="mt-3 flex flex-wrap gap-2"><PlatformBadge platform={entry.platform} /><DifficultyBadge difficulty={problem?.difficulty ?? entry.difficulty} platform={entry.platform} /><Badge variant="secondary">{entry.points} 分</Badge></div></div><div className="flex shrink-0 gap-2">{problem?.statementMd && <CopyProblemButton platform={entry.platform} index={problem.index} title={problem.title} titleZh={problem.titleZh} url={problem.url} timeLimitMs={problem.timeLimitMs} memoryLimitMb={problem.memoryLimitMb} statementMd={problem.statementMd} statementZhMd={problem.statementZhMd ?? null} samples={problem.samples ?? []} />}<Button asChild size="sm"><a href={url} target="_blank" rel="noreferrer">原题<ExternalLink className="size-3.5" /></a></Button></div></div><div className="mt-3"><ProblemSwitcher contest={contestContext} current={current} /></div></CardHeader>
        <CardContent>{result.key === entryKey && result.status === 'error' ? <p className="text-muted-foreground text-sm">{result.message} 可通过右上角原题链接查看。</p> : !problem ? <p className="text-muted-foreground text-sm">正在加载题面…</p> : problem.statementMd || problem.statementPdf ? <ProblemStatementViewer platform={entry.platform} code={problem.id} segments={segments} title={problem.title} titleZh={problem.titleZh} zhModel={problem.translateModel} hasPdf={Boolean(problem.statementPdf)} hasText={Boolean(problem.statementMd)} pdfUrl={problem.statementPdf} /> : <p className="text-muted-foreground text-sm">题面尚未拉取成功，可通过原题链接查看。</p>}</CardContent>
      </Card>
      {problem?.statementMd && <SamplesSection platform={entry.platform} samples={problem.samples} />}
      {problem && <div className="grid gap-4 sm:grid-cols-2"><Card><CardHeader className="pb-3"><CardTitle className="text-sm">题目信息</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex items-center gap-2"><Tag className="text-muted-foreground size-4" />{problem.id}</div>{problem.timeLimitMs && <div className="flex items-center gap-2"><Clock className="text-muted-foreground size-4" />{problem.timeLimitMs / 1000} s</div>}{problem.memoryLimitMb && <div className="flex items-center gap-2"><MemoryStick className="text-muted-foreground size-4" />{problem.memoryLimitMb} MB</div>}</CardContent></Card>{problem.tags?.length > 0 && <Card><CardHeader className="pb-3"><CardTitle className="text-sm">标签</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-1.5">{problem.tags.map((tag) => <Badge key={tag} variant="secondary">{tagZh(tag)}</Badge>)}</CardContent></Card>}</div>}
    </div>
  </ProblemViewShell>;
}
