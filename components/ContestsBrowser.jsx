'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PlatformBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/utils';

const TABS = [
  { id: 'all', label: '全部' },
  { id: 'atcoder', label: 'AtCoder (ABC)' },
  { id: 'codeforces', label: 'Codeforces' },
];

export default function ContestsBrowser({ contests }) {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    let list = contests;
    if (tab !== 'all') list = list.filter((c) => c.platform === tab);
    const kw = q.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(kw) ||
          (c.titleZh || '').toLowerCase().includes(kw) ||
          String(c.id).toLowerCase().includes(kw),
      );
    }
    return list;
  }, [contests, tab, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-muted text-muted-foreground inline-flex rounded-lg p-0.5 text-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                tab === t.id ? 'bg-background text-foreground shadow-sm' : ''
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索比赛名称或编号…"
            className="pl-8"
          />
        </div>
        <Badge variant="secondary" className="ml-auto tabular-nums">
          {filtered.length} 场
        </Badge>
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {filtered.length === 0 && (
            <div className="text-muted-foreground p-8 text-center text-sm">没有匹配的比赛</div>
          )}
          {filtered.map((c) => (
            <Link
              key={`${c.platform}/${c.id}`}
              href={`/contests/${c.platform}/${encodeURIComponent(String(c.id))}`}
              className="hover:bg-accent/40 flex flex-wrap items-center gap-3 px-4 py-3 transition-colors"
            >
              <PlatformBadge platform={c.platform} />
              <span className="text-muted-foreground w-24 shrink-0 font-mono text-xs">
                {String(c.id)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {c.titleZh || c.title}
              </span>
              {c.ratedRange ? (
                <Badge variant="outline" className="text-muted-foreground hidden font-mono sm:inline-flex">
                  {c.ratedRange}
                </Badge>
              ) : null}
              <span className="text-muted-foreground hidden w-36 shrink-0 text-right text-xs md:inline">
                {formatDateTime(c.startTime)}
              </span>
              <Badge variant="secondary" className="tabular-nums">
                {c.problemCount} 题
              </Badge>
            </Link>
          ))}
        </CardContent>
      </Card>

      {filtered.length > 0 && (
        <p className="text-muted-foreground text-center text-xs">
          历史比赛由 CI 每次运行回填 10 题，逐步补全全部赛次。
        </p>
      )}
    </div>
  );
}
