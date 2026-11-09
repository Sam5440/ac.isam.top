import ProblemsBrowser from '@/components/ProblemsBrowser';
import { getAllProblems } from '@/lib/data';
import { PLATFORMS } from '@/lib/platforms';

export const metadata = {
  title: '题库',
};

const PLATFORM_ORDER = new Map(PLATFORMS.map((p, i) => [p.id, i]));

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
      // 索引条目(build-index.mjs)只有 translated 布尔、没有 statementZhMd;
      // 读后者会把 1.6 万道已翻译题全部错标成「仅原文」。
      translated: Boolean(p.translated ?? p.statementZhMd),
    }))
    .sort((a, b) => {
      // 平台按 PLATFORMS 声明序(atcoder → codeforces → nowcoder),
      // 旧实现是字符串降序,会让 nowcoder 永远排在最前
      const pa = PLATFORM_ORDER.get(a.platform) ?? 99;
      const pb = PLATFORM_ORDER.get(b.platform) ?? 99;
      if (pa !== pb) return pa - pb;
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
