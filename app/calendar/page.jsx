import CalendarView from '@/components/calendar/CalendarView';

export const metadata = { title: '比赛日历' };

/** /calendar 比赛日历：薄壳服务端组件，数据由客户端经 /api/contests/clist 获取（缺 Key 也不影响构建）。 */
export default function CalendarPage() {
  return (
    <div className="space-y-6 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">比赛日历</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          近期比赛日程（数据来自 Clist，时间为本地时区）。点击比赛可跳转官网，顶部可勾选比赛网站。
        </p>
      </div>
      <CalendarView />
    </div>
  );
}
