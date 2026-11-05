import { ArrowLeft, Clock, ExternalLink, Timer } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DifficultyBadge, PlatformBadge, TranslatedBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getContest, getContests, getProblemsOfContest, platformOf } from '@/lib/data';
import { formatDateTime } from '@/lib/utils';

export function generateStaticParams() {
  // 本地验证跳过全量预渲染(AC_SKIP_SSG=1),生产保持全量——见题目页同名注释
  if (process.env.AC_SKIP_SSG) return [];
  const params = [];
  for (const platform of ['atcoder', 'codeforces']) {
    for (const c of getContests(platform)) {
      params.push({ platform, contestId: String(c.id) });
    }
  }
  return params;
}

export async function generateMetadata({ params }) {
  const { platform, contestId } = await params;
  const contest = getContest(platform, contestId);
  if (!contest) return { title: '比赛未找到' };
  return { title: contest.titleZh || contest.title };
}

export default async function ContestPage({ params }) {
  const { platform, contestId } = await params;
  const contest = getContest(platform, contestId);
  if (!contest) notFound();
  const p = platformOf(platform);
  const problems = getProblemsOfContest(contest);
  const translatedCount = problems.filter((x) => x.statementZhMd).length;

  return (
    <div className="space-y-6 py-10">
      <Button asChild variant="ghost" size="sm">
        <Link href="/contests" className="text-muted-foreground">
          <ArrowLeft className="size-4" />
          全部比赛
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <PlatformBadge platform={platform} />
                {contest.ratedRange ? (
                  <Badge variant="outline" className="text-muted-foreground font-mono">
                    rated {contest.ratedRange}
                  </Badge>
                ) : null}
                <Badge variant="secondary" className="tabular-nums">
                  {problems.length} 题 · {translatedCount} 已翻译
                </Badge>
              </div>
              <CardTitle className="text-2xl leading-snug tracking-tight">
                {contest.titleZh || contest.title}
              </CardTitle>
              {contest.titleZh && contest.titleZh !== contest.title ? (
                <CardDescription className="mt-1">{contest.title}</CardDescription>
              ) : null}
              <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {formatDateTime(contest.startTime)}
                </span>
                {contest.durationSeconds ? (
                  <span className="inline-flex items-center gap-1">
                    <Timer className="size-3.5" />
                    {Math.round(contest.durationSeconds / 60)} 分钟
                  </span>
                ) : null}
                <span className="font-mono">{String(contest.id)}</span>
              </div>
            </div>
            <Button asChild size="sm" className="shrink-0">
              <a href={contest.url} target="_blank" rel="noreferrer">
                {p?.label ?? '原站'}
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {problems.length === 0 ? (
            <div className="text-muted-foreground p-8 text-center text-sm">
              题面尚未拉取，将随下次 CI 自动补充。
            </div>
          ) : (
            <div className="divide-y">
              {problems.map((prob) => (
                <Link
                  key={prob.id}
                  href={`/problems/${platform}/${encodeURIComponent(prob.id)}`}
                  className="hover:bg-accent/40 flex items-center gap-3 px-6 py-3 transition-colors"
                >
                  <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md font-mono text-sm font-bold">
                    {prob.index}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {prob.titleZh || prob.title}
                    </span>
                    <span className="text-muted-foreground block truncate font-mono text-xs">
                      {prob.title}
                    </span>
                  </span>
                  <DifficultyBadge difficulty={prob.difficulty} platform={platform} />
                  <TranslatedBadge translated={Boolean(prob.statementZhMd)} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
