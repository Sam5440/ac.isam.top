import { ArrowLeft, Clock, ExternalLink, MemoryStick, Tag } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DifficultyBadge, PlatformBadge } from '@/components/Badges';
import SamplesSection from '@/components/SamplesSection';
import StatementBody from '@/components/StatementBody';
import ProblemViewShell, {
  ProblemCompiler,
  ProblemLetterRail,
  ProblemSwitcher,
  ProblemTopBar,
} from '@/components/ProblemViewShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAllProblems, getContest, getProblem, getProblemsOfContest, platformOf } from '@/lib/data';
import { pairSegments } from '@/lib/statement-segments';
import { tagZh } from '@/lib/tags';

export function generateStaticParams() {
  return getAllProblems().map((p) => ({ platform: p.platform, problemId: String(p.id) }));
}

export async function generateMetadata({ params }) {
  const { platform, problemId } = await params;
  const prob = findProblem(platform, problemId);
  if (!prob) return { title: '题目未找到' };
  return { title: `${prob.index}. ${prob.titleZh || prob.title}` };
}

/** 题号大小写不敏感查找（手输 20a 也能命中 20A）。返回全量记录。 */
function findProblem(platform, problemId) {
  const pid = String(problemId).toLowerCase();
  const summary = getAllProblems().find(
    (p) => p.platform === platform && String(p.id).toLowerCase() === pid,
  );
  return summary ? getProblem(platform, summary.id) : null;
}

function MetaItem({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

export default async function ProblemPage({ params }) {
  const { platform, problemId } = await params;
  const prob = findProblem(platform, problemId);
  if (!prob) notFound();

  const p = platformOf(platform);
  const contest = getContest(platform, prob.contestId);
  const contestProblems = contest ? getProblemsOfContest(contest) : [];
  // 客户端需要的轻量列表（切换条 / 侧栏 / 编译器）
  const problemsList = contestProblems.map((x) => ({
    id: x.id,
    platform,
    index: x.index,
    title: x.title,
    titleZh: x.titleZh ?? null,
    difficulty: x.difficulty ?? null,
    statementZhMd: Boolean(x.statementZhMd),
    samples: x.samples ?? [],
    timeLimitMs: x.timeLimitMs ?? null,
    memoryLimitMb: x.memoryLimitMb ?? null,
    url: x.url,
  }));
  const contestForClient = contest
    ? { id: contest.id, platform, title: contest.title, titleZh: contest.titleZh ?? null, problemsList }
    : null;

  const segments = pairSegments(prob.statementMd, prob.statementZhMd);

  return (
    <div className="space-y-6 py-10">
      <ProblemCompiler contest={contestForClient} current={prob} />

      <Button asChild variant="ghost" size="sm">
        <Link
          href={contest ? `/contests/${platform}/${encodeURIComponent(String(contest.id))}` : '/problems'}
          className="text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
          {contest ? contest.titleZh || contest.title : '题库'}
        </Link>
      </Button>

      <ProblemViewShell>
        <div className="min-w-0 space-y-6">
          <ProblemTopBar contest={contestForClient} current={prob} />
          <ProblemLetterRail contest={contestForClient} current={prob} />
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start gap-4">
                <div className="bg-primary text-primary-foreground grid size-12 shrink-0 place-items-center rounded-lg text-xl font-bold">
                  {prob.index}
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-xl leading-snug tracking-tight">
                    {prob.titleZh || prob.title}
                  </CardTitle>
                  {prob.titleZh && prob.titleZh !== prob.title ? (
                    <CardDescription className="mt-1 font-mono">{prob.title}</CardDescription>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <PlatformBadge platform={platform} />
                    <DifficultyBadge difficulty={prob.difficulty} platform={platform} />
                  </div>
                </div>
                <Button asChild size="sm" className="shrink-0">
                  <a href={prob.url} target="_blank" rel="noreferrer">
                    原题
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              </div>
              {contestForClient && (
                <div className="mt-3">
                  <ProblemSwitcher contest={contestForClient} current={prob} />
                </div>
              )}
            </CardHeader>
            <CardContent>
              {prob.statementMd ? (
                <StatementBody
                  code={prob.id}
                  segments={segments}
                  title={prob.title}
                  titleZh={prob.titleZh}
                  zhModel={prob.translateModel}
                />
              ) : (
                <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                  题面尚未拉取成功（{p?.label} 反爬或网络限制），将随下次 CI 自动重试；可点击右上角「原题」前往原站查看。
                </div>
              )}
            </CardContent>
          </Card>

          {prob.statementMd && <SamplesSection samples={prob.samples} />}
        </div>
      </ProblemViewShell>

      {/* 元信息（整页模式下收进主列底部；侧栏模式下也在此展示移动端友好） */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">题目信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <MetaItem icon={Tag} label="题号">
              <span className="font-mono text-sm">{prob.id}</span>
            </MetaItem>
            {contest ? (
              <MetaItem icon={ExternalLink} label="所属比赛">
                <Link
                  href={`/contests/${platform}/${encodeURIComponent(String(contest.id))}`}
                  className="text-primary line-clamp-2 underline-offset-4 hover:underline"
                >
                  {contest.titleZh || contest.title}
                </Link>
              </MetaItem>
            ) : null}
            {prob.timeLimitMs ? (
              <MetaItem icon={Clock} label="时间限制">
                {(prob.timeLimitMs / 1000).toFixed(prob.timeLimitMs % 1000 ? 1 : 0)} s
              </MetaItem>
            ) : null}
            {prob.memoryLimitMb ? (
              <MetaItem icon={MemoryStick} label="内存限制">
                {prob.memoryLimitMb} MB
              </MetaItem>
            ) : null}
          </CardContent>
        </Card>

        {prob.tags?.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">标签</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {prob.tags.map((t) => (
                <Badge key={t} variant="secondary" className="font-normal">
                  {tagZh(t)}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <p className="text-muted-foreground px-1 text-[11px] leading-5">
        题面与样例版权归 {p?.label} 及出题人所有；中文翻译由 AI 生成（
        {prob.translateModel || 'CI 管线'}），如有出入请以原文为准。
      </p>
    </div>
  );
}
