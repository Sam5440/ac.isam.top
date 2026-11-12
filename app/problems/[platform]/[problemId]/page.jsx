import { ArrowLeft, Clock, ExternalLink, MemoryStick, Tag } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { DifficultyBadge, PlatformBadge } from '@/components/Badges';
import AiFab from '@/components/chat/AiFab';
import CopyProblemButton from '@/components/CopyProblemButton';
import SamplesSection from '@/components/SamplesSection';
import ProblemStatementViewer from '@/components/ProblemStatementViewer';
import ViewHistoryTracker from '@/components/ViewHistoryTracker';
import ProblemViewShell, {
  ProblemCompiler,
  ProblemLetterRail,
  ProblemSwitcher,
  ProblemTopBar,
} from '@/components/ProblemViewShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { findProblemSummary, getAllContests, getAllProblems, getContest, getProblem, getProblemsOfContest, platformOf } from '@/lib/data';
import { selectStaticProblems, staticLimit } from '@/lib/static-params.mjs';
import { pairSegments } from '@/lib/statement-segments';
import { tagZh } from '@/lib/tags';

// Historical pages are statically generated on first request and cached by Next/Vercel.
export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  if (process.env.AC_SKIP_SSG) return [];
  const count = staticLimit(process.env.AC_SSG_PROBLEMS, 400);
  return selectStaticProblems(getAllProblems(), getAllContests(), count)
    .map((p) => ({ platform: p.platform, problemId: String(p.id) }));
}

export async function generateMetadata({ params }) {
  const { platform, problemId } = await params;
  const prob = findProblem(platform, problemId);
  if (!prob) return { title: '题目未找到' };
  return { title: `${prob.index}. ${prob.titleZh || prob.title}` };
}

/** 题号大小写不敏感查找（手输 20a 也能命中 20A）。返回全量记录。 */
// React cache():generateMetadata 与页面各调一次，同一请求共享单题读取。
const findProblem = cache((platform, problemId) => {
  const pid = String(problemId).toLowerCase();
  const summary = findProblemSummary(platform, pid);
  return summary ? getProblem(platform, summary.id) : null;
});

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
  let prob = findProblem(platform, problemId);
  if (!prob) notFound();

  // 规则：gym 题与站内 codeforces 题库同名题唯一命中时（reuseOf），题面/样例/翻译
  // 直接复用原题记录渲染，仓库不重复保存一份题面。
  if (prob.reuseOf) {
    const src = getProblem('codeforces', prob.reuseOf);
    if (src) {
      prob = {
        ...prob,
        titleZh: prob.titleZh ?? src.titleZh ?? null,
        statementMd: src.statementMd ?? null,
        statementZhMd: src.statementZhMd ?? null,
        samples: src.samples ?? [],
        timeLimitMs: prob.timeLimitMs ?? src.timeLimitMs ?? null,
        memoryLimitMb: prob.memoryLimitMb ?? src.memoryLimitMb ?? null,
        tags: prob.tags?.length ? prob.tags : (src.tags ?? []),
        translateModel: prob.translateModel ?? src.translateModel ?? null,
      };
    }
  }

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
      <ProblemViewShell rail={<ProblemLetterRail contest={contestForClient} current={prob} />}>
      <ProblemCompiler contest={contestForClient} current={prob} />
      {/* AI 对话悬浮窗（右下角，可在设置中关闭） */}
      <AiFab
        problem={{
          id: prob.id,
          platform,
          index: prob.index,
          title: prob.title,
          titleZh: prob.titleZh ?? null,
          statementMd: prob.statementMd ?? '',
          samples: prob.samples ?? [],
          timeLimitMs: prob.timeLimitMs ?? null,
          memoryLimitMb: prob.memoryLimitMb ?? null,
          url: prob.url,
        }}
      />

      {/* 浏览历史埋点：停留时长 + 最近判题状态（lib/view-history） */}
      <ViewHistoryTracker
        platform={platform}
        problemId={prob.id}
        title={prob.title}
        titleZh={prob.titleZh ?? null}
        url={prob.url}
      />

      <Button asChild variant="ghost" size="sm">
        <Link
          href={contest ? `/contests/${platform}/${encodeURIComponent(String(contest.id))}` : '/problems'}
          className="text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
          {contest ? contest.titleZh || contest.title : '题库'}
        </Link>
      </Button>

      <div className="min-w-0 space-y-6">
        <ProblemTopBar contest={contestForClient} current={prob} />
        <Card>
          <CardHeader>
              <div className="flex flex-wrap items-start gap-4">
                <div className="bg-primary text-primary-foreground grid size-12 shrink-0 place-items-center rounded-lg text-xl font-bold">
                  {prob.index}
                </div>
                {/* basis-56:给标题盒一个真实 flex-basis,窄屏下 flex-wrap 才能
                    真正换行(旧 flex-1 的 basis:0% 恒不换行,标题被压到近 0 宽
                    后溢出绘制盖住右侧按钮 —— 审查 2026-11-09 编译-13 根因) */}
                <div className="min-w-0 flex-1 basis-56">
                  <CardTitle className="text-xl leading-snug tracking-tight break-words">
                    {prob.titleZh || prob.title}
                  </CardTitle>
                  {prob.titleZh && prob.titleZh !== prob.title ? (
                    <CardDescription className="mt-1 font-mono">{prob.title}</CardDescription>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <PlatformBadge platform={platform} />
                    <DifficultyBadge difficulty={prob.difficulty} platform={platform} />
                    {prob.reuseOf ? (
                      <Link
                        href={`/problems/codeforces/${prob.reuseOf}`}
                        title="题面复用自站内 Codeforces 题库"
                        className="text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors hover:bg-muted"
                      >
                        复用 {prob.reuseOf}
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {prob.statementMd ? (
                    <CopyProblemButton
                      platform={platform}
                      index={prob.index}
                      title={prob.title}
                      titleZh={prob.titleZh}
                      url={prob.url}
                      timeLimitMs={prob.timeLimitMs}
                      memoryLimitMb={prob.memoryLimitMb}
                      statementMd={prob.statementMd}
                      statementZhMd={prob.statementZhMd ?? null}
                      samples={prob.samples ?? []}
                    />
                  ) : null}
                  <Button asChild size="sm">
                    <a href={prob.url} target="_blank" rel="noreferrer">
                      原题
                      <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                </div>
              </div>
              {contestForClient && (
                <div className="mt-3">
                  <ProblemSwitcher contest={contestForClient} current={prob} />
                </div>
              )}
            </CardHeader>
            <CardContent>
              {prob.statementMd || prob.statementPdf ? (
                <ProblemStatementViewer
                  platform={platform}
                  code={prob.id}
                  segments={segments}
                  title={prob.title}
                  titleZh={prob.titleZh}
                  zhModel={prob.translateModel}
                  hasPdf={Boolean(prob.statementPdf)}
                  hasText={Boolean(prob.statementMd)}
                  pdfUrl={prob.statementPdf}
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
    </ProblemViewShell>
  );
}
