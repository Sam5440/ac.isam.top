'use client';

import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { DifficultyBadge, PlatformBadge, TranslatedBadge } from '@/components/Badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { normalizeProblemQuery } from '@/lib/problem-query.mjs';

const PLATFORM_TABS = [
  { id: 'all', label: '全部' },
  { id: 'atcoder', label: 'AtCoder' },
  { id: 'codeforces', label: 'Codeforces' },
  { id: 'cf-gyms', label: 'CF Gym' },
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

export default function ProblemsBrowser({ initialPage }) {
  const [tab, setTab] = useState('all');
  const [band, setBand] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  const queryKey = `${tab}|${band}|${q}|${page}`;
  const [resultKey, setResultKey] = useState('all|all||1');

  useEffect(() => {
    const readUrl = () => {
      const query = normalizeProblemQuery(new URLSearchParams(window.location.search));
      setTab(query.platform); setBand(query.band); setQ(query.q); setPage(query.page);
    };
    readUrl();
    window.addEventListener('popstate', readUrl);
    return () => window.removeEventListener('popstate', readUrl);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const query = normalizeProblemQuery({ platform: tab, band, q, page });
    if (query.platform === 'all' && query.band === 'all' && !query.q && query.page === 1) {
      setResult(initialPage); setLoading(false); setError('');
    }
    const timer = setTimeout(async () => {
      const params = new URLSearchParams();
      if (query.platform !== 'all') params.set('platform', query.platform);
      if (query.band !== 'all') params.set('band', query.band);
      if (query.q) params.set('q', query.q);
      if (query.page > 1) params.set('page', String(query.page));
      const suffix = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${suffix ? `?${suffix}` : ''}`);
      if (!suffix) return;
      setLoading(true); setError('');
      try {
        const response = await fetch(`/api/problems?${suffix}`, { signal: ctrl.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!ctrl.signal.aborted) { setResult(data); setResultKey(queryKey); }
      } catch (err) {
        if (!ctrl.signal.aborted) setError(`题目加载失败：${err.message}`);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [tab, band, q, page, initialPage, retry, queryKey]);
  const showingCurrent = resultKey === queryKey;
  const shown = showingCurrent ? result : { ...result, items: [] };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-muted text-muted-foreground inline-flex rounded-lg p-0.5 text-sm">
          {PLATFORM_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTab(t.id); setPage(1); }}
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
          onChange={(e) => { setBand(e.target.value); setPage(1); }}
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
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            maxLength={200}
            placeholder="搜索题号 / 题名…"
            aria-label="搜索题号或题名"
            className="pl-8"
          />
          {q && (
            <button
              type="button"
              onClick={() => { setQ(''); setPage(1); }}
              className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2"
              aria-label="清除搜索"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Badge variant="secondary" className="ml-auto tabular-nums">
          {showingCurrent ? result.total : '…'} 题
        </Badge>
      </div>

      <div role="status" aria-live="polite" className="text-muted-foreground text-sm">
        {loading || !showingCurrent ? '题目加载中…' : error || `第 ${result.page} / ${result.pages} 页`}
        {error && <button type="button" onClick={() => setRetry((n) => n + 1)} className="ml-2 underline">重试</button>}
      </div>
      <Card aria-busy={loading || !showingCurrent}>
        <CardContent className="divide-y p-0">
          {showingCurrent && !loading && !error && result.total === 0 && (
            <div className="text-muted-foreground p-8 text-center text-sm">没有匹配的题目</div>
          )}
          {shown.items.map((p) => (
            <Link
              key={`${p.platform}/${p.id}`}
              href={`/problems/${p.platform}/${encodeURIComponent(p.id)}`}
              prefetch={false}
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
              <PlatformBadge platform={p.platform} fixed hideBelow="sm" />
              <DifficultyBadge difficulty={p.difficulty} platform={p.platform} fixed />
              <TranslatedBadge translated={Boolean(p.translated)} fixed hideBelow="sm" />
            </Link>
          ))}
        </CardContent>
      </Card>
      <div className="flex items-center justify-center gap-4">
        <Button variant="outline" disabled={loading || !showingCurrent || result.page <= 1} onClick={() => setPage(result.page - 1)}>上一页</Button>
        <span className="text-muted-foreground text-sm">{showingCurrent ? `${result.page} / ${result.pages}` : '…'}</span>
        <Button variant="outline" disabled={loading || !showingCurrent || result.page >= result.pages} onClick={() => setPage(result.page + 1)}>下一页</Button>
      </div>
    </div>
  );
}
