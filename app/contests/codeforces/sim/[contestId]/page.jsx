import SimulatorContestView from '@/components/SimulatorContestView';

/**
 * 自定义模拟赛详情：`/contests/codeforces/sim/<id>#data=…`
 *
 * 为什么是三段路径（而不是 `/contests/codeforces/sim-<id>`）：
 * `/contests/[platform]/[contestId]` 是两段动态路由，任何 `/contests/<x>/<y>`
 * 都会命中它；实测混合静态段的 `codeforces/sim-[contestId]` 仍会被它截走
 * （platform=codeforces、contestId=sim-… → 查不到比赛 → 404）。三段路径与
 * 父路由深度不同，不会产生歧义。
 *
 * 题单全部编码在 URL hash 里，服务端只返回同一个加载壳，因此强制动态渲染，
 * 既不受比赛页按需 SSG（`revalidate = false`）的影响，也不会缓存过期内容。
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = { title: '模拟赛' };

export default async function SimulatorContestPage({ params }) {
  const { contestId } = await params;
  return <SimulatorContestView contestId={contestId} />;
}