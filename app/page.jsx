import HomeDashboard from '@/components/home/HomeDashboard';
import { getHomeData } from '@/lib/home-data';

export default function Home() {
  const data = getHomeData();
  if (!data) {
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
  return <HomeDashboard data={data} />;
}
