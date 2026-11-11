'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PlatformBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CONTEST_TYPES, contestType, contestTypeLabel } from '@/lib/contest-type';
import { formatDateTime } from '@/lib/utils';

/** 平台 × 类型两级筛选：站点为大类，类型标签按站点分组；类型枚举与设置弹窗共用 CONTEST_TYPES。 */
const SITES = [
  { id: 'atcoder', label: 'AtCoder' },
  { id: 'codeforces', label: 'Codeforces' },
  { id: 'nowcoder', label: '牛客' },
];
/** 组内已有站点名，"其他"类去掉站点前缀 */
const SHORT_LABEL = { 'atcoder-other': '其他', other: '其他', 'nc-other': '其他' };
const PAGE_SIZE = 50;

export default function ContestsBrowser({ contests }) {
  const [platform, setPlatform] = useState('all');
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

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

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const pageItems = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const goto = (n) => {
    setPage(n);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const groups = SITES.filter((s) => platform === 'all' || s.id === platform).map((s) => ({
    ...s,
    types: CONTEST_TYPES.filter((t) => t.platform === s.id),
  }));

  const chip = (active) =>
    `rounded-md border px-2.5 py-1 text-xs transition-colors ${
      active ? 'border-primary/60 bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-muted text-muted-foreground inline-flex rounded-lg p-0.5 text-sm">
          {[{ id: 'all', label: '全部' }, ...SITES].map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={platform === t.id}
              onClick={() => {
                setPlatform(t.id);
                setPage(1);
                if (t.id !== 'all' && type !== 'all' && CONTEST_TYPES.find((x) => x.id === type)?.platform !== t.id) {
                  setType('all');
                }
              }}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                platform === t.id ? 'bg-background text-foreground shadow-sm' : ''
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="搜索比赛名称或编号…"
            aria-label="搜索比赛名称或编号"
            className="pl-8"
          />
        </div>
        <Badge variant="secondary" className="shrink-0 tabular-nums sm:ml-auto">
          {filtered.length} 场
        </Badge>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            title="全部类型"
            aria-pressed={type === 'all'}
            onClick={() => {
              setType('all');
              setPage(1);
            }}
            className={chip(type === 'all')}
          >
            全部类型
          </button>
        </div>
        {groups.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground w-24 shrink-0 text-xs font-medium">{g.label}</span>
            {g.types.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.desc}
                aria-pressed={type === t.id}
                onClick={() => {
                  setType(t.id);
                  setPage(1);
                }}
                className={chip(type === t.id)}
              >
                {SHORT_LABEL[t.id] ?? t.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {filtered.length === 0 && (
            <div className="text-muted-foreground p-8 text-center text-sm">没有匹配的比赛</div>
          )}
          {pageItems.map((c) => (
            // 固定列网格：平台 | 类型 | 编号 | 标题(弹性) | rated | 开始时间 | 题数
            // 每列定宽，三个平台、各种类型标签长度不同时各行仍纵向对齐
            <Link
              key={`${c.platform}/${c.id}`}
              href={`/contests/${c.platform}/${encodeURIComponent(String(c.id))}`}
              className="contest-row hover:bg-accent/40 grid items-center gap-x-3 px-4 py-3 transition-colors"
            >
              <PlatformBadge platform={c.platform} fixed />
              <Badge variant="outline" className="text-muted-foreground hidden w-full justify-center truncate sm:inline-flex">
                {contestTypeLabel(contestType(c))}
              </Badge>
              <span className="text-muted-foreground hidden truncate font-mono text-xs sm:block">{String(c.id)}</span>
              <span className="min-w-0 truncate text-sm font-medium">{c.titleZh || c.title}</span>
              <span className="hidden justify-center md:flex">
                {c.ratedRange ? (
                  <Badge variant="outline" className="text-muted-foreground font-mono">
                    {c.ratedRange}
                  </Badge>
                ) : null}
              </span>
              <span className="text-muted-foreground hidden text-right text-xs tabular-nums md:block">
                {formatDateTime(c.startTime)}
              </span>
              <Badge variant="secondary" className="w-full justify-center tabular-nums">
                {c.problemCount} 题
              </Badge>
            </Link>
          ))}
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" disabled={cur <= 1} onClick={() => goto(cur - 1)}>
            上一页
          </Button>
          <span className="text-muted-foreground text-sm tabular-nums">
            {cur} / {pages}
          </span>
          <Button variant="outline" disabled={cur >= pages} onClick={() => goto(cur + 1)}>
            下一页
          </Button>
        </div>
      )}

      {filtered.length > 0 && (
        <p className="text-muted-foreground text-center text-xs">
          历史比赛由 CI 每次运行回填 10 题，逐步补全全部赛次。
        </p>
      )}
    </div>
  );
}
