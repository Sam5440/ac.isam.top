'use client';

/**
 * 私有化比赛详情：/contests/private/<id>
 *
 * 未解锁 → VaultUnlock 卡；解锁后 → 场次信息 + 题目清单（同站内比赛详情）。
 * 题目清单只做导航，题面在 /contests/private/<id>/problems/<index> 渲染。
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowLeft, ArrowRight, Clock, ExternalLink, FileLock2, Lock, Timer } from 'lucide-react';

import VaultUnlock from '@/components/private/VaultUnlock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBytes } from '@/lib/private-vault.mjs';
import { lockVault, usePrivateVault } from '@/lib/private-store';
import { formatDateTime } from '@/lib/utils';

export default function PrivateContestView({ contestId, entry }) {
  const state = usePrivateVault(contestId);
  const payload = state.status === 'unlocked' ? state.payload : null;
  const problems = useMemo(() => payload?.problems ?? [], [payload]);

  if (!payload) {
    return (
      <div className="space-y-6 py-10">
        <Button asChild variant="ghost" size="sm">
          <Link href="/contests/private" className="text-muted-foreground">
            <ArrowLeft className="size-4" />
            私有化
          </Link>
        </Button>
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{entry?.label ?? contestId}</h1>
            <p className="text-muted-foreground mt-1 font-mono text-xs">{contestId}</p>
          </div>
          <VaultUnlock
            contestId={contestId}
            label={entry?.label}
            bytes={entry?.bytes}
            version={entry?.createdAt}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/contests/private" className="text-muted-foreground">
            <ArrowLeft className="size-4" />
            私有化
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => lockVault(contestId)}>
          <Lock className="size-3.5" />
          重新上锁
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <FileLock2 className="size-3" />
                  私有化 · 本地解密
                </Badge>
                <Badge variant="secondary" className="tabular-nums">
                  {problems.length} 题
                </Badge>
                {entry?.bytes ? (
                  <Badge variant="outline" className="text-muted-foreground font-mono">
                    密文 {formatBytes(entry.bytes)}
                  </Badge>
                ) : null}
              </div>
              <CardTitle className="text-2xl leading-snug tracking-tight">{payload.titleZh || payload.title}</CardTitle>
              {payload.titleZh && payload.titleZh !== payload.title ? (
                <CardDescription className="mt-1">{payload.title}</CardDescription>
              ) : null}
              <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                {payload.startTime ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" />
                    {formatDateTime(payload.startTime)}
                  </span>
                ) : null}
                {payload.durationSeconds ? (
                  <span className="inline-flex items-center gap-1">
                    <Timer className="size-3.5" />
                    {Math.round(payload.durationSeconds / 60)} 分钟
                  </span>
                ) : null}
                <span className="font-mono">{contestId}</span>
              </div>
              {payload.note ? <p className="text-muted-foreground mt-3 text-sm leading-6">{payload.note}</p> : null}
            </div>
            {payload.source ? (
              <Button asChild size="sm" className="shrink-0">
                <a href={payload.source} target="_blank" rel="noreferrer">
                  原站
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y" aria-label="比赛题目">
            {problems.map((p) => (
              <Link
                key={p.id}
                href={`/contests/private/${encodeURIComponent(contestId)}/problems/${encodeURIComponent(p.index)}`}
                className="hover:bg-accent/40 flex items-center gap-3 px-6 py-3 transition-colors"
              >
                <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md font-mono text-sm font-bold">
                  {p.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.titleZh || p.title}</span>
                  <span className="text-muted-foreground block truncate font-mono text-xs">{p.title}</span>
                </span>
                {p.statementZhMd ? (
                  <Badge variant="outline" className="shrink-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
                    中文
                  </Badge>
                ) : null}
                <ArrowRight className="text-muted-foreground size-4 shrink-0" />
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-[11px] leading-5">
        题面已在你的浏览器内解密；密码与明文都不会发送到服务器，刷新页面后自动上锁。
      </p>
    </div>
  );
}
