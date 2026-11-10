import HistoryList from '@/components/history/HistoryList';

export const metadata = { title: '浏览历史' };

/** /history 浏览历史：薄壳服务端组件，主体为客户端 HistoryList（IndexedDB 只在浏览器可读）。 */
export default function HistoryPage() {
  return (
    <div className="space-y-6 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">浏览历史</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          看过的题目与停留时长（不足 1 分钟不记录），判题状态来自题目页最近一次样例运行。
        </p>
      </div>
      <HistoryList />
    </div>
  );
}
