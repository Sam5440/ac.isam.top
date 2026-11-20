import { notFound } from 'next/navigation';

import ContestDetailsView from '@/components/ContestDetailsView';
import { getAllContests, getContest, getProblemsOfContest, platformOf } from '@/lib/data';
import { staticLimit } from '@/lib/static-params.mjs';

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  if (process.env.AC_SKIP_SSG) return [];
  return getAllContests().slice(0, staticLimit(process.env.AC_SSG_CONTESTS, 80))
    .map((c) => ({ platform: c.platform, contestId: String(c.id) }));
}

export async function generateMetadata({ params }) {
  const { platform, contestId } = await params;
  const contest = getContest(platform, contestId);
  if (!contest) return { title: '比赛未找到' };
  return { title: contest.titleZh || contest.title };
}

export default async function ContestPage({ params }) {
  const { platform, contestId } = await params;
  const contest = getContest(platform, contestId);
  if (!contest) notFound();
  const p = platformOf(platform);
  const problems = getProblemsOfContest(contest);
  return <ContestDetailsView contest={contest} problems={problems} platform={platform} />;
}
