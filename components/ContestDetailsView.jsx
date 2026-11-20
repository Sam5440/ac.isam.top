import Link from 'next/link';
import { ArrowLeft, Clock, ExternalLink, Timer } from 'lucide-react';

import { DifficultyBadge, PlatformBadge, TranslatedBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';

const PLATFORM_NAMES = { atcoder: 'AtCoder', codeforces: 'Codeforces', 'cf-gyms': 'Gym', nowcoder: '牛客' };

export default function ContestDetailsView({ contest, problems, platform, isSimulator = false }) {
  const translatedCount = problems.filter((problem) => problem.statementZhMd || problem.translated).length;
  const backHref = isSimulator ? '/simulator' : '/contests';

  return (
    <div className="space-y-6 py-10">
      <Button asChild variant="ghost" size="sm">
        <Link href={backHref} className="text-muted-foreground">
          <ArrowLeft className="size-4" />
          {isSimulator ? '模拟赛工作台' : '全部比赛'}
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {isSimulator ? <Badge variant="secondary">自定义模拟赛</Badge> : <PlatformBadge platform={platform} />}
                {contest.ratedRange ? (
                  <Badge variant="outline" className="text-muted-foreground font-mono">rated {contest.ratedRange}</Badge>
                ) : null}
                <Badge variant="secondary" className="tabular-nums">
                  {problems.length} 题 · {translatedCount} 已翻译
                  {isSimulator && Number.isFinite(contest.totalPoints) ? ` · ${contest.totalPoints} 分` : ''}
                </Badge>
              </div>
              <CardTitle className="text-2xl leading-snug tracking-tight">{contest.titleZh || contest.title}</CardTitle>
              {contest.titleZh && contest.titleZh !== contest.title ? <CardDescription className="mt-1">{contest.title}</CardDescription> : null}
              <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{isSimulator ? '自定义题单' : formatDateTime(contest.startTime)}</span>
                {contest.durationSeconds ? (
                  <span className="inline-flex items-center gap-1"><Timer className="size-3.5" />{Math.round(contest.durationSeconds / 60)} 分钟</span>
                ) : null}
                <span className="font-mono">{isSimulator ? '模拟赛' : String(contest.id)}</span>
              </div>
            </div>
            {isSimulator ? null : (
              <Button asChild size="sm" className="shrink-0">
                <a href={contest.url} target="_blank" rel="noreferrer">{platform?.label ?? '原站'}<ExternalLink className="size-3.5" /></a>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {problems.length === 0 ? (
            <div className="text-muted-foreground p-8 text-center text-sm">题面尚未拉取，将随下次 CI 自动补充。</div>
          ) : (
            <div className="divide-y" aria-label="比赛题目">
              {problems.map((problem, i) => {
                const row = (
                  <>
                    <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md font-mono text-sm font-bold">
                      {isSimulator ? String(i + 1).padStart(2, '0') : problem.index}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        {isSimulator ? <Badge variant="outline" className="shrink-0">{PLATFORM_NAMES[problem.platform] || problem.platform}</Badge> : null}
                        <span className="truncate text-sm font-medium">{problem.alias || problem.titleZh || problem.title || problem.id}</span>
                        {isSimulator ? <Badge variant="secondary" className="shrink-0 tabular-nums">{problem.points} 分</Badge> : null}
                      </span>
                      <span className="text-muted-foreground block truncate font-mono text-xs">
                        {problem.alias && (problem.titleZh || problem.title) ? (problem.titleZh || problem.title) : problem.title || problem.id}
                      </span>
                    </span>
                    {isSimulator && problem.found === false ? (
                      <span className="text-amber-600 dark:text-amber-400 inline-flex shrink-0 items-center gap-1 text-xs">本站未收录 · 原题链接<ExternalLink className="size-3.5" /></span>
                    ) : !isSimulator ? <>
                      <DifficultyBadge difficulty={problem.difficulty} platform={problem.platform || platform} fixed />
                      <TranslatedBadge translated={Boolean(problem.statementZhMd || problem.translated)} fixed />
                    </> : null}
                  </>
                );

                if (isSimulator && problem.found === false) {
                  return <a key={`${problem.platform}:${problem.id}:${i}`} href={problem.originalUrl} target="_blank" rel="noreferrer" className="hover:bg-accent/40 flex items-center gap-3 px-6 py-3 transition-colors">{row}</a>;
                }
                return (
                  <Link key={isSimulator ? `${problem.platform}:${problem.id}:${i}` : problem.id}
                    href={`/problems/${problem.platform || platform}/${encodeURIComponent(problem.id)}`}
                    className="hover:bg-accent/40 flex items-center gap-3 px-6 py-3 transition-colors">{row}</Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
