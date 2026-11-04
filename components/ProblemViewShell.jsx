'use client';

/**
 * 题目页外壳与切换组件（比赛含 ≥2 题时显示）：
 *   ProblemTopBar    题目卡上方的本比赛题目横向条（设置 topSwitcher，默认开）
 *   ProblemLetterRail  视口左侧固定居中的题号竖条，仅显示题号（设置 letterRail，默认开）
 *   ProblemSwitcher  题目卡头部的 ← / 题目下拉 / → 切换条
 * 挂载编译器面板。
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';

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

function problemHref(platform, p) {
  return `/problems/${platform}/${encodeURIComponent(p.id)}`;
}

/** 题目卡上方：本比赛题目横向条（与题目列等宽，flex-wrap 自动换行）。 */
export function ProblemTopBar({ contest, current }) {
  const { settings } = useSettings();
  if (!settings.topSwitcher) return null;
  const problems = contest?.problemsList ?? [];
  if (problems.length <= 1) return null;
  return (
    <nav
      aria-label="本比赛题目"
      className="bg-card flex flex-wrap gap-1.5 rounded-xl border p-2"
    >
      {problems.map((p) => {
        const active = p.id === current.id;
        return (
          <Link
            key={p.id}
            href={problemHref(current.platform, p)}
            title={`${p.index}. ${p.titleZh || p.title}`}
            className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
              active ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-accent/40'
            }`}
          >
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-md font-mono text-xs font-bold ${
                active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {p.index}
            </span>
            <span className={`min-w-0 max-w-[11rem] truncate text-[13px] ${active ? 'font-medium' : ''}`}>
              {p.titleZh || p.title}
            </span>
            <DifficultyBadge difficulty={p.difficulty} platform={current.platform} />
            <TranslatedBadge translated={Boolean(p.statementZhMd)} />
          </Link>
        );
      })}
    </nav>
  );
}

/** 视口左侧：固定垂直居中的题号竖条（仅题号；窄屏隐藏，超长列表内部滚动）。 */
export function ProblemLetterRail({ contest, current }) {
  const { settings } = useSettings();
  if (!settings.letterRail) return null;
  const problems = contest?.problemsList ?? [];
  if (problems.length <= 1) return null;
  return (
    <nav
      aria-label="题号切换"
      className="fixed top-1/2 left-2 z-30 hidden max-h-[70vh] -translate-y-1/2 flex-col gap-1 overflow-y-auto xl:flex"
    >
      {problems.map((p) => {
        const active = p.id === current.id;
        return (
          <Link
            key={p.id}
            href={problemHref(current.platform, p)}
            title={`${p.index}. ${p.titleZh || p.title}`}
            className={`grid size-7 shrink-0 place-items-center rounded-md border font-mono text-xs font-bold transition-colors ${
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card/80 text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {p.index}
          </Link>
        );
      })}
    </nav>
  );
}

/** 题目切换条：← / 下拉选择 / →，置于题目卡头部（客户端路由切换）。 */
export function ProblemSwitcher({ contest, current }) {
  const router = useRouter();
  const problems = contest?.problemsList ?? [];
  if (problems.length <= 1) return null;
  const idx = problems.findIndex((p) => p.id === current.id);
  const prev = idx > 0 ? problems[idx - 1] : null;
  const next = idx >= 0 && idx < problems.length - 1 ? problems[idx + 1] : null;
  return (
    <div className="flex items-center gap-2">
      {prev ? (
        <Link
          href={problemHref(current.platform, prev)}
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
          if (p) router.push(problemHref(current.platform, p));
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
          href={problemHref(current.platform, next)}
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

/** 编译器面板（portal 渲染进 layout 的 #compiler-dock-root）。 */
export function ProblemCompiler({ contest, current }) {
  const problems = compilerProblems(contest?.problemsList ?? []);
  if (!problems.length) return null;
  return (
    <CompilerDock
      problems={problems}
      day={String(current.contestId)}
      currentCode={current.id}
    />
  );
}

/**
 * 布局外壳：题目列表已移至题目卡上方（ProblemTopBar）与左侧题号条
 * （ProblemLetterRail），主体保持单列。
 */
export default function ProblemViewShell({ children }) {
  return <div className="min-w-0">{children}</div>;
}
