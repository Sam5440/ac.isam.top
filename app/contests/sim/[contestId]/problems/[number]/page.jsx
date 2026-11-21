import SimulatorProblemView from '@/components/simulator/SimulatorProblemView';

export const dynamic = 'force-dynamic';
export const metadata = { title: '模拟赛题目' };

export default async function SimulatorProblemPage({ params }) {
  const { contestId, number } = await params;
  return <SimulatorProblemView contestId={contestId} number={number} />;
}
