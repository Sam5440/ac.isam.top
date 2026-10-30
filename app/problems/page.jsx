import ProblemsBrowser from '@/components/ProblemsBrowser';
import { getAllProblems } from '@/lib/data';

export const metadata = {
  title: '题库',
};

export default function ProblemsPage() {
  const problems = getAllProblems()
    .map((p) => ({
      id: p.id,
      platform: p.platform,
      contestId: p.contestId,
      index: p.index,
      title: p.title,
      titleZh: p.titleZh,
      difficulty: p.difficulty,
      translated: Boolean(p.statementZhMd),
    }))
    .sort((a, b) => {
      if (a.platform !== b.platform) return a.platform < b.platform ? 1 : -1;
      if (String(a.contestId) !== String(b.contestId)) {
        return String(b.contestId).localeCompare(String(a.contestId), undefined, { numeric: true });
      }
      return a.index.localeCompare(b.index, undefined, { numeric: true });
    });

  return (
    <div className="space-y-6 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">题库</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          共 {problems.length} 道题目 · 支持按平台、难度、关键词筛选，题目页内可切换中文翻译 / 原文。
        </p>
      </div>
      <ProblemsBrowser problems={problems} />
    </div>
  );
}
