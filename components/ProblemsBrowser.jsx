'use client';

import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { DifficultyBadge, PlatformBadge, TranslatedBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const PLATFORM_TABS = [
  { id: 'all', label: '全部' },
  { id: 'atcoder', label: 'AtCoder (ABC)' },
  { id: 'codeforces', label: 'Codeforces' },
  { id: 'nowcoder', label: '牛客' },
];

const RATING_BANDS = [
  { id: 'all', label: '全部难度' },
  { id: '0-1199', label: '入门 (<1200)' },
  { id: '1200-1599', label: 'Easy (1200+)' },
  { id: '1600-2099', label: 'Medium (1600+)' },
  { id: '2100-2399', label: 'Hard (2100+)' },
  { id: '2400-9999', label: '魔鬼 (2400+)' },
  { id: 'unrated', label: '未评级' },
];

function matchBand(d, band) {
  if (band === 'all') return true;
  if (band === 'unrated') return d == null;
  if (d == null) return false;
  // AtCoder 负难度（入门灰名,如 -305）先归一到 0,与 DifficultyBadge 的展示
  // 口径一致 —— 否则这批最简单的题在所有数值档位(含「入门」)都查不到。
  const v = Math.max(0, Math.round(d));
  const [lo, hi] = band.split('-').map(Number);
  return v >= lo && v <= hi;
}

export default function ProblemsBrowser({ problems }) {
  const [tab, setTab] = useState('all');
  const [band, setBand] = useState('all');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    let list = problems;
    if (tab !== 'all') list = list.filter((p) => p.platform === tab);
    list = list.filter((p) => matchBand(p.difficulty, band));
    const kw = q.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(kw) ||
          (p.titleZh || '').toLowerCase().includes(kw) ||
          p.id.toLowerCase().includes(kw) ||
          String(p.contestId).toLowerCase().includes(kw),
      );
    }
    return list;
  }, [problems, tab, band, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-muted text-muted-foreground inline-flex rounded-lg p-0.5 text-sm">
          {PLATFORM_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                tab === t.id ? 'bg-background text-foreground shadow-sm' : ''
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={band}
          onChange={(e) => setBand(e.target.value)}
          aria-label="按难度筛选"
          className="border-input bg-background h-9 rounded-md border px-2.5 text-sm outline-none"
        >
          {RATING_BANDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索题号 / 题名…"
            aria-label="搜索题号或题名"
            className="pl-8"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2"
              aria-label="清除搜索"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Badge variant="secondary" className="ml-auto tabular-nums">
          {filtered.length} 题
        </Badge>
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {filtered.length === 0 && (
            <div className="text-muted-foreground p-8 text-center text-sm">没有匹配的题目</div>
          )}
          {filtered.slice(0, 200).map((p) => (
            <Link
              key={`${p.platform}/${p.id}`}
              href={`/problems/${p.platform}/${encodeURIComponent(p.id)}`}
              className="hover:bg-accent/40 flex items-center gap-3 px-4 py-3 transition-colors"
            >
              <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md font-mono text-sm font-bold">
                {p.index}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.titleZh || p.title}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {p.title} · {String(p.contestId)}
                </span>
              </span>
              <PlatformBadge platform={p.platform} />
              <DifficultyBadge difficulty={p.difficulty} platform={p.platform} />
              <TranslatedBadge translated={Boolean(p.translated)} />
            </Link>
          ))}
          {filtered.length > 200 && (
            <div className="text-muted-foreground p-4 text-center text-xs">
              仅显示前 200 条，共 {filtered.length} 条 —— 请用筛选缩小范围
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
