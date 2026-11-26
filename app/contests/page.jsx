import ContestsBrowser from '@/components/ContestsBrowser';
import { getAllContests } from '@/lib/data';
import { privateContestSummaries } from '@/lib/private-data.mjs';

export const metadata = {
  title: '比赛',
};

export default function ContestsPage() {
  const contests = [
    ...getAllContests().map((c) => ({
      id: c.id,
      platform: c.platform,
      title: c.title,
      titleZh: c.titleZh,
      startTime: c.startTime,
      ratedRange: c.ratedRange,
      problemCount: (c.problems ?? []).length,
    })),
    // 私有化场次只有明文索引（名称/体积），题数与题面都在密文里
    ...privateContestSummaries(),
  ].sort((a, b) => {
    // getAllContests 已经排好序，追加的私有化场次要重新归位（最新在前）
    const t = (c) => (c.startTime ? new Date(c.startTime).getTime() : 0);
    return t(b) - t(a) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
  });
  return (
    <div className="space-y-6 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">比赛</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          AtCoder（ABC / ARC / AGC）、Codeforces（Div. 1–4）与私有化加密赛事的列表，支持按类型筛选，点击查看每场比赛的题目。
        </p>
      </div>
      <ContestsBrowser contests={contests} />
    </div>
  );
}
