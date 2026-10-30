import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-32 text-center">
      <div className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-xl text-2xl font-bold">
        404
      </div>
      <h1 className="text-xl font-semibold">没有找到这个页面</h1>
      <p className="text-muted-foreground text-sm">题目或比赛可能尚未收录，或链接有误。</p>
      <Button asChild variant="outline" size="sm">
        <Link href="/">返回首页</Link>
      </Button>
    </div>
  );
}
