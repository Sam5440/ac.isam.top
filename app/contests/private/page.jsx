import PrivateHub from '@/components/private/PrivateHub';
import { listVaultContests } from '@/lib/private-data.mjs';

export const metadata = {
  title: '私有化',
  description: '端到端加密的私有比赛题面：密文入库，浏览器内解密。',
  robots: { index: false, follow: false },
};

export const revalidate = false;

export default function PrivateContestsPage() {
  const contests = listVaultContests();
  return <PrivateHub contests={contests} />;
}
