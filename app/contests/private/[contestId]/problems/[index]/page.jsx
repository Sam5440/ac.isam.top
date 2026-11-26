import { notFound } from 'next/navigation';

import PrivateProblemView from '@/components/private/PrivateProblemView';
import { findVaultEntry } from '@/lib/private-data.mjs';

/**
 * 私有化题目页：`/contests/private/<id>/problems/<题号>`
 *
 * 题号在密文里，构建期不可枚举，所以强制动态渲染：服务端只把明文索引里的
 * 场次信息交给客户端壳，题面由浏览器解密后再渲染（同 /contests/sim/*）。
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }) {
  const { contestId, index } = await params;
  const entry = findVaultEntry(contestId);
  return {
    title: entry ? `${entry.label} · ${index}（私有化）` : '私有化题目',
    robots: { index: false, follow: false },
  };
}

export default async function PrivateProblemPage({ params }) {
  const { contestId, index } = await params;
  const entry = findVaultEntry(contestId);
  if (!entry) notFound();
  return <PrivateProblemView contestId={entry.id} entry={entry} index={index} />;
}
