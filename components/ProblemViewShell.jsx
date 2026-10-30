'use client';

/**
 * 题目页外壳：读取设置里的「比赛题目页视图」——
 *   sidebar（默认）：主列 + 侧栏（本比赛全部题目列表，当前题高亮）
 *   full：整页阅读，侧栏隐藏
 * 并在题目卡顶部提供切换条（上一题 / 题目下拉 / 下一题），挂载编译器面板。
 */

import Link from 'next/link';

import CompilerDock from '@/components/compiler/CompilerDock';
import { DifficultyBadge, TranslatedBadge } from '@/components/Badges';
import { useSettings } from '@/components/settings';

function compilerProblems(problems) {
  return (problems ?? []).map((p) => ({
    code: p.id,
    title: p.titleZh || p.title,
    letter: p.index ?? null,
    examples: (p.samples ?? []).map((e) => ({ input: e.input ?? '', output: e.output ?? '' })),
    timeLimit: p.timeLimitMs ? `${p.timeLimitMs / 1000} s` : null,
    memoryLimit: p.memoryLimitMb ? `${p.memoryLimitMb} MB` : null,
    url: p.url,
  }));
}

/** 题目切换条：← / 下拉选择 / →，置于题目卡头部。 */
export function ProblemSwitcher({ contest, current }) {
  const problems = contest?.problemsList ?? [];
  if (problems.length <= 1) return null;
  const idx = problems.findIndex((p) => p.id === current.id);
  const prev = idx > 0 ? problems[idx - 1] : null;
  const next = idx >= 0 && idx < problems.length - 1 ? problems[idx + 1] : null;
  const href = (p) => `/problems/${current.platform}/${encodeURIComponent(p.id)}`;
  return (
    <div className="flex items-center gap-2">
      {prev ? (
        <Link
          href={href(prev)}
          className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md border px-2 py-1 text-xs transition-colors"
          title={`上一题：${prev.index}. ${prev.titleZh || prev.title}`}
        >
          ← {prev.index}
        </Link>
      ) : (
        <span className="rounded-md border px-2 py-1 text-xs opacity-30">←</span>
      )}
      <select
        value={idx}
        onChange={(e) => {
          const p = problems[Number(e.target.value)];
          if (p) window.location.href = href(p);
        }}
        aria-label="切换题目"
        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs"
      >
        {problems.map((p, i) => (
          <option key={p.id} value={i}>
            {p.index}. {p.titleZh || p.title}
          </option>
        ))}
      </select>
      {next ? (
        <Link
          href={href(next)}
          className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md border px-2 py-1 text-xs transition-colors"
          title={`下一题：${next.index}. ${next.titleZh || next.title}`}
        >
          {next.index} →
        </Link>
      ) : (
        <span className="rounded-md border px-2 py-1 text-xs opacity-30">→</span>
      )}
    </div>
  );
}

/** 侧栏：本比赛题目列表（整页模式下隐藏）。 */
export function ContestSidebar({ contest, current }) {
  const { settings } = useSettings();
  if (settings.contestView === 'full') return null;
  const problems = contest?.problemsList ?? [];
  if (!problems.length) return null;
  return (
    <aside className="space-y-4">
      <div className="bg-card rounded-xl border">
        <div className="text-muted-foreground border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wider">
          {contest?.titleZh || contest?.title || '本比赛题目'}
        </div>
        <div className="divide-y">
          {problems.map((p) => {
            const active = p.id === current.id;
            return (
              <Link
                key={p.id}
                href={`/problems/${current.platform}/${encodeURIComponent(p.id)}`}
                className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${
                  active ? 'bg-primary/10' : 'hover:bg-accent/40'
                }`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-md font-mono text-xs font-bold ${
                    active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {p.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[13px] ${active ? 'font-medium' : ''}`}>
                    {p.titleZh || p.title}
                  </span>
                </span>
                <DifficultyBadge difficulty={p.difficulty} platform={current.platform} />
                <TranslatedBadge translated={Boolean(p.statementZhMd)} />
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

/** 编译器面板（portal 渲染进 layout 的 #compiler-dock-root）。 */
export function ProblemCompiler({ contest, current }) {
  const problems = compilerProblems(contest?.problemsList ?? []);
  if (!problems.length) return null;
  return <CompilerDock problems={problems} day={String(current.contestId)} />;
}

/**
 * 布局外壳：sidebar 模式 = 双列；full 模式 = 单列整页。
 * children / sidebar 都是服务端渲染好的 React 节点。
 */
export default function ProblemViewShell({ children, sidebar }) {
  const { settings } = useSettings();
  const full = settings.contestView === 'full';
  return full ? (
    <div>{children}</div>
  ) : (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_270px]">{children}{sidebar}</div>
  );
}
