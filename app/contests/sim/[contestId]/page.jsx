import SimulatorContestView from '@/components/SimulatorContestView';

/**
 * 自定义模拟赛详情：`/contests/sim/<id>#data=…`
 *
 * `sim` 与 atcoder / codeforces / cf-gyms / nowcoder 平级，都是 `/contests/<平台>/<id>`
 * 的第二段，只是它的题目组成由用户自行决定。静态段 `sim` 优先于
 * `/contests/[platform]/[contestId]` 的动态段，不会互相截走。
 *
 * 题单全部编码在 URL hash 里，服务端只返回同一个加载壳，所以强制动态渲染：
 * 不参与比赛页的按需 SSG（`revalidate = false`），也不会缓存到过期内容。
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = { title: '模拟赛' };

export default async function SimulatorContestPage({ params }) {
  const { contestId } = await params;
  return <SimulatorContestView contestId={contestId} />;
}