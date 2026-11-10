import ProblemsBrowser from '@/components/ProblemsBrowser';
import { getProblemSummaries } from '@/lib/problem-index';
import { queryProblems } from '@/lib/problem-query.mjs';

export const metadata = {
  title: '题库',
};

export default function ProblemsPage() {
  const initialPage = queryProblems(getProblemSummaries());

  return (
    <div className="space-y-6 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">题库</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          共 {initialPage.total} 道题目 · 支持按平台、难度、关键词筛选，题目页内可切换中文翻译 / 原文。
        </p>
      </div>
      <ProblemsBrowser initialPage={initialPage} />
    </div>
  );
}
