'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { PlatformBadge } from '@/components/Badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSettings } from '@/components/settings';
import { contestType } from '@/lib/contest-type';
import { formatDateTime } from '@/lib/utils';

/** 首页「最新比赛」：按设置里选择的比赛类型过滤（默认全部）。 */
export default function RecentContests({ contests }) {
  const { settings } = useSettings();
  const enabled = new Set(settings.homeContestTypes);
  const list = contests.filter((c) => enabled.has(contestType(c))).slice(0, 6);

  if (!list.length) {
    return (
      <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
        当前设置的比赛类型下暂无比赛 —— 可在设置里勾选更多类型。
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((c) => (
          <Link
            key={`${c.platform}/${c.id}`}
            href={`/contests/${c.platform}/${encodeURIComponent(String(c.id))}`}
            className="group"
          >
            <Card className="h-full transition-colors group-hover:border-foreground/25">
              <CardContent className="space-y-2 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <PlatformBadge platform={c.platform} />
                  <span className="text-muted-foreground font-mono text-xs">
                    {formatDateTime(c.startTime)}
                  </span>
                </div>
                <div className="line-clamp-2 font-medium leading-snug">{c.titleZh || c.title}</div>
                <div className="text-muted-foreground text-xs">{c.problemCount} 道题目</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <div className="mt-4 text-right">
        <Button asChild variant="ghost" size="sm">
          <Link href="/contests" className="text-muted-foreground">
            全部比赛
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </>
  );
}
