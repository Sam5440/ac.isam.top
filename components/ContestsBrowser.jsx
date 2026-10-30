'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PlatformBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CONTEST_TYPES, contestType, contestTypeLabel } from '@/lib/contest-type';
import { formatDateTime } from '@/lib/utils';

/** 平台 × 类型两级筛选；类型枚举与设置弹窗共用 CONTEST_TYPES。 */
const TYPE_TABS = [
  { id: 'all', label: '全部' },
  ...CONTEST_TYPES,
];

export default function ContestsBrowser({ contests }) {
  const [platform, setPlatform] = useState('all');
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    let list = contests;
    if (platform !== 'all') list = list.filter((c) => c.platform === platform);
    if (type !== 'all') list = list.filter((c) => contestType(c) === type);
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
  }, [contests, platform, type, q]);

  // 只显示与当前平台匹配的类型标签
  const atcoderTypes = ['abc', 'arc', 'agc', 'other'];
  const nowcoderTypes = ['nc-weekly', 'nc-xiaobai', 'nc-practice', 'nc-challenge', 'nc-other'];
  const cfTypes = ['div1', 'div2', 'div3', 'div4', 'div12', 'other'];
  const visibleTypes = TYPE_TABS.filter((t) => {
    if (t.id === 'all') return true;
    if (platform === 'atcoder') return atcoderTypes.includes(t.id);
    if (platform === 'nowcoder') return nowcoderTypes.includes(t.id);
    if (platform === 'codeforces') return cfTypes.includes(t.id);
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-muted text-muted-foreground inline-flex rounded-lg p-0.5 text-sm">
            {[
              { id: 'all', label: '全部' },
              { id: 'atcoder', label: 'AtCoder' },
              { id: 'codeforces', label: 'Codeforces' },
              { id: 'nowcoder', label: '牛客' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setPlatform(t.id);
                  const keep = { all: null, atcoder: atcoderTypes, codeforces: cfTypes, nowcoder: nowcoderTypes };
                  const allow = keep[t.id];
                  if (allow && !allow.includes(type)) setType('all');
                }}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  platform === t.id ? 'bg-background text-foreground shadow-sm' : ''
                }`}
              >
                {t.label}
              </button>
            ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {visibleTypes.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.desc ?? '全部类型'}
              onClick={() => setType(t.id)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                type === t.id
                  ? 'border-primary/60 bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
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
              <Badge variant="outline" className="text-muted-foreground hidden sm:inline-flex">
                {contestTypeLabel(contestType(c))}
              </Badge>
              <span className="text-muted-foreground w-20 shrink-0 font-mono text-xs">
                {String(c.id)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {c.titleZh || c.title}
              </span>
              {c.ratedRange ? (
                <Badge variant="outline" className="text-muted-foreground hidden font-mono md:inline-flex">
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
