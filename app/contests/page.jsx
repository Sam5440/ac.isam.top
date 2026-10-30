import ContestsBrowser from '@/components/ContestsBrowser';
import { getAllContests } from '@/lib/data';

export const metadata = {
  title: '比赛',
};

export default function ContestsPage() {
  const contests = getAllContests().map((c) => ({
    id: c.id,
    platform: c.platform,
    title: c.title,
    titleZh: c.titleZh,
    startTime: c.startTime,
    ratedRange: c.ratedRange,
    problemCount: (c.problems ?? []).length,
  }));
  return (
    <div className="space-y-6 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">比赛</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          AtCoder（ABC / ARC / AGC）与 Codeforces（Div. 1–4）赛事列表，支持按类型筛选，点击查看每场比赛的题目。
        </p>
      </div>
      <ContestsBrowser contests={contests} />
    </div>
  );
}
