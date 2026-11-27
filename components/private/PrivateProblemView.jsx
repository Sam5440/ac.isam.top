'use client';

/**
 * 私有化题目页：/contests/private/<id>/problems/<index>
 *
 * 与站内题目页共用同一条渲染链（ProblemViewShell / ProblemStatementViewer /
 * SamplesSection / ProblemIde），只是题面来自内存里的解密载荷。
 *
 * 语言模式：私有化题面的中英文是同一份载荷里的两段，直接给 pairSegments；
 * useProblemLang('private') 跟随全局设置（默认对照）。
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowLeft, Clock, ExternalLink, Lock, MemoryStick } from 'lucide-react';

import CopyProblemButton from '@/components/CopyProblemButton';
import ProblemStatementViewer from '@/components/ProblemStatementViewer';
import ProblemViewShell, { ProblemLetterRail, ProblemSwitcher, ProblemTopBar } from '@/components/ProblemViewShell';
import SamplesSection from '@/components/SamplesSection';
import ProblemIde from '@/components/ide/ProblemIde';
import VaultUnlock from '@/components/private/VaultUnlock';
import VaultShareActions from '@/components/private/VaultShareActions';
import VaultUnlocking from '@/components/private/VaultUnlocking';
import useAutoUnlock from '@/components/private/useAutoUnlock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { pairSegments } from '@/lib/statement-segments';

function problemHref(contestId, index) {
  return `/contests/private/${encodeURIComponent(contestId)}/problems/${encodeURIComponent(index)}`;
}

export default function PrivateProblemView({ contestId, entry, index }) {
  const state = useAutoUnlock(contestId, entry?.createdAt ?? null);
  const payload = state.status === 'unlocked' ? state.payload : null;
  const problems = payload?.problems ?? [];
  const position = problems.findIndex((p) => String(p.index).toLowerCase() === String(index).toLowerCase());
  const prob = position >= 0 ? problems[position] : null;

  const segments = useMemo(
    () => (prob ? pairSegments(prob.statementMd, prob.statementZhMd) : []),
    [prob],
  );

  // 编译器/IDE 需要整场题目列表（与站内题目页同口径）
  const problemsList = useMemo(() => problems.map((p) => ({
    id: p.id,
    platform: 'private',
    index: p.index,
    title: p.title,
    titleZh: p.titleZh ?? null,
    difficulty: p.difficulty ?? null,
    statementZhMd: Boolean(p.statementZhMd),
    samples: p.samples ?? [],
    timeLimitMs: p.timeLimitMs ?? null,
    memoryLimitMb: p.memoryLimitMb ?? null,
    url: p.url,
    href: problemHref(contestId, p.index),
  })), [problems, contestId]);

  const contestForClient = payload
    ? { id: contestId, platform: 'private', title: payload.title, titleZh: payload.titleZh ?? null, problemsList }
    : null;

  if (!payload) {
    return (
      <div className="space-y-6 py-10">
        <Button asChild variant="ghost" size="sm">
          <Link href="/contests/private" className="text-muted-foreground">
            <ArrowLeft className="size-4" />
            私有化
          </Link>
        </Button>
        <div className="mx-auto w-full max-w-2xl">
          {state.status === 'loading' ? (
            <VaultUnlocking label={entry?.label} />
          ) : (
            <VaultUnlock
              contestId={contestId}
              label={entry?.label}
              bytes={entry?.bytes}
              version={entry?.createdAt}
              stateError={state.status === 'error' ? state.error : ''}
            />
          )}
        </div>
      </div>
    );
  }

  if (!prob) {
    return (
      <div className="space-y-4 py-10">
        <p className="text-muted-foreground text-sm">这场私有化比赛里没有题号 {index}。</p>
        <Button asChild variant="outline">
          <Link href={`/contests/private/${encodeURIComponent(contestId)}`}>返回题目清单</Link>
        </Button>
      </div>
    );
  }

  const current = { ...problemsList[position], contestId };

  return (
    <ProblemViewShell rail={<ProblemLetterRail contest={contestForClient} current={current} />}>
      <ProblemIde
        contest={{ id: contestId, title: payload.title, titleZh: payload.titleZh ?? null }}
        problem={{
          id: prob.id,
          platform: 'private',
          contestId,
          index: prob.index,
          title: prob.title,
          titleZh: prob.titleZh ?? null,
        }}
        problemData={{
          ...prob,
          platform: 'private',
          contestId,
          contestTitle: payload.title,
          contestTitleZh: payload.titleZh ?? null,
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/contests/private/${encodeURIComponent(contestId)}`} className="text-muted-foreground">
            <ArrowLeft className="size-4" />
            {payload.titleZh || payload.title}
          </Link>
        </Button>
        <VaultShareActions contestId={contestId} />
      </div>

      <div className="min-w-0 space-y-6">
        <ProblemTopBar contest={contestForClient} current={current} />
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start gap-4">
              <div className="bg-primary text-primary-foreground grid size-12 shrink-0 place-items-center rounded-lg text-xl font-bold">
                {prob.index}
              </div>
              <div className="min-w-0 flex-1 basis-56">
                <CardTitle className="text-xl leading-snug tracking-tight break-words">
                  {prob.titleZh || prob.title}
                </CardTitle>
                {prob.titleZh && prob.titleZh !== prob.title ? (
                  <CardDescription className="mt-1 font-mono">{prob.title}</CardDescription>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="gap-1">
                    <Lock className="size-3" />
                    私有化
                  </Badge>
                  {prob.timeLimitMs ? (
                    <Badge variant="outline" className="text-muted-foreground gap-1 font-mono">
                      <Clock className="size-3" />
                      {prob.timeLimitMs / 1000} s
                    </Badge>
                  ) : null}
                  {prob.memoryLimitMb ? (
                    <Badge variant="outline" className="text-muted-foreground gap-1 font-mono">
                      <MemoryStick className="size-3" />
                      {prob.memoryLimitMb} MB
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <CopyProblemButton
                  platform="private"
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
                {prob.url ? (
                  <Button asChild size="sm">
                    <a href={prob.url} target="_blank" rel="noreferrer">
                      原题
                      <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="mt-3">
              <ProblemSwitcher contest={contestForClient} current={current} />
            </div>
          </CardHeader>
          <CardContent>
            <ProblemStatementViewer
              platform="private"
              code={`${contestId}:${prob.id}`}
              segments={segments}
              title={prob.title}
              titleZh={prob.titleZh}
              zhModel={prob.statementZhMd ? '官方中文' : undefined}
              hasPdf={false}
              hasText
              offlineOnly
            />
          </CardContent>
        </Card>

        {prob.statementMd && <SamplesSection platform="private" samples={prob.samples} />}
      </div>

      <p className="text-muted-foreground px-1 text-[11px] leading-5">
        题面在本地解密自仓库密文；请勿向未获授权的人转发。密码与明文都不会上传到服务器。
      </p>
    </ProblemViewShell>
  );
}
