/** 平台元数据（客户端安全，无 Node 内置模块依赖）。 */
export const PLATFORMS = [
  {
    id: 'atcoder',
    label: 'AtCoder',
    short: 'ABC',
    site: 'https://atcoder.jp',
    dot: 'bg-[#9aa3b5]',
  },
  {
    id: 'codeforces',
    label: 'Codeforces',
    short: 'CF',
    site: 'https://codeforces.com',
    dot: 'bg-sky-400',
  },
  {
    id: 'cf-gyms',
    label: 'CF Gym',
    short: 'GYM',
    site: 'https://codeforces.com/gyms',
    dot: 'bg-indigo-400',
  },
  {
    id: 'nowcoder',
    label: '牛客竞赛',
    short: 'NC',
    site: 'https://ac.nowcoder.com',
    dot: 'bg-emerald-400',
  },
];

export function platformOf(id) {
  return PLATFORMS.find((p) => p.id === id) ?? null;
}
