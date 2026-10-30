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
];

export function platformOf(id) {
  return PLATFORMS.find((p) => p.id === id) ?? null;
}
