import { notFound } from 'next/navigation';

import PrivateContestView from '@/components/private/PrivateContestView';
import { findVaultEntry, listVaultContests } from '@/lib/private-data.mjs';

/**
 * 私有化比赛详情：`/contests/private/<id>`
 *
 * 与 `/contests/sim/*` 同理：静态段 `private` 优先于 `/contests/[platform]/[contestId]`
 * 动态段。服务端只读明文索引（场次名/体积/时间），密文由客户端按需拉取并解密，
 * 所以这一页可以静态预渲染、也能离线打开壳。
 */

export const dynamicParams = false;
export const revalidate = false;

export function generateStaticParams() {
  return listVaultContests().map((c) => ({ contestId: c.id }));
}

export async function generateMetadata({ params }) {
  const { contestId } = await params;
  const entry = findVaultEntry(contestId);
  return {
    title: entry ? `${entry.label}（私有化）` : '私有化比赛',
    robots: { index: false, follow: false },
  };
}

export default async function PrivateContestPage({ params }) {
  const { contestId } = await params;
  const entry = findVaultEntry(contestId);
  if (!entry) notFound();
  return <PrivateContestView contestId={entry.id} entry={entry} />;
}
