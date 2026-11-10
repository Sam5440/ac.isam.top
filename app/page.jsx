import { ArrowRight, BookOpen, Clock, FileText, Languages, Layers, Trophy } from 'lucide-react';
import Link from 'next/link';

import { DifficultyBadge, PlatformBadge } from '@/components/Badges';
import RecentContests from '@/components/RecentContests';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getIndex } from '@/lib/data';
import { formatDateTime } from '@/lib/utils';

function StatCard({ icon: Icon, label, value }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-lg">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
          <div className="text-muted-foreground text-xs">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const idx = getIndex();
  if (!idx || !idx.stats?.problems) {
    return (
      <div className="py-24 text-center">
        <h1 className="text-2xl font-semibold">暂无数据</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          请先运行 <code className="bg-muted rounded px-1.5 py-0.5 font-mono">npm run fetch:init</code>{' '}
          拉取题库数据。
        </p>
      </div>
    );
  }

  const { stats, recentContests = [], recentProblems = [] } = idx;

  return (
    <div className="space-y-12 pb-12">
      {/* Hero */}
      <section className="py-12 sm:py-16">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          AC 题库 <span className="text-muted-foreground">AtCoder · Codeforces · 牛客</span>
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl">
          自动抓取 AtCoder、Codeforces 与牛客竞赛的题目：完整题面、样例数据、难度分级，
          并由 AI 翻译为简体中文。数据随 GitHub Actions 持续更新。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/problems" prefetch={false}>
              <BookOpen className="size-4" />
              浏览题库
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/contests" prefetch={false}>
              <Layers className="size-4" />
              查看比赛
            </Link>
          </Button>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={FileText} label="收录题目" value={stats.problems} />
        <StatCard icon={Trophy} label="收录比赛" value={stats.contests} />
        <StatCard icon={Languages} label="已翻译题面" value={stats.translated} />
        <StatCard
          icon={Clock}
          label="数据更新"
          value={idx.generatedAt ? formatDateTime(idx.generatedAt) : '—'}
        />
      </section>

      {/* Recent contests（类型由设置过滤，见 components/RecentContests.jsx） */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">最新比赛</h2>
        </div>
        <RecentContests contests={recentContests} />
      </section>

      {/* Recent problems */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">最近收录</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/problems" prefetch={false} className="text-muted-foreground">
              进入题库
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
        <Card>
          <CardContent className="divide-y p-0">
            {recentProblems.slice(0, 10).map((p) => (
              <Link
                key={`${p.platform}/${p.id}`}
                href={`/problems/${p.platform}/${encodeURIComponent(p.id)}`}
                className="hover:bg-accent/40 flex items-center gap-3 px-4 py-3 transition-colors"
              >
                <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-md font-mono text-sm font-bold">
                  {p.index}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.titleZh || p.title}
                  <span className="text-muted-foreground ml-2 hidden font-mono text-xs sm:inline">
                    {p.id}
                  </span>
                </span>
                <PlatformBadge platform={p.platform} />
                <DifficultyBadge difficulty={p.difficulty} platform={p.platform} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
