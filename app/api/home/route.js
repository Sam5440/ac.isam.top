import { getHomeData } from '@/lib/home-data';

export const dynamic = 'force-static';

export function GET() {
  const data = getHomeData();
  if (!data) return Response.json({ error: '题库数据尚未初始化' }, { status: 503 });
  return Response.json(data);
}
