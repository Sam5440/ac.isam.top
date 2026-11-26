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

/**
 * 私有化平台（2026-11-27）：题目只以密文入库（data/private/vault/*.json），
 * 密码在浏览器里派生密钥解密，服务端与构建期都只见到密文。
 *
 * 刻意**不**放进 PLATFORMS：PLATFORMS 是「抓取管线 + 全量索引 + 统计」的
 * 权威四平台口径（lib/data.js / scripts/build-index.mjs / 抓取脚本都按它遍历
 * data/<platform>/），把 private 混进去会让索引去读不存在（也不该存在）的
 * 明文目录。展示层要「四平台 + 私有化」时用 ALL_PLATFORMS。
 */
export const PRIVATE_PLATFORM = {
  id: 'private',
  label: '私有化',
  short: 'PRIV',
  site: null,
  dot: 'bg-[#a78bfa]',
  locked: true,
};

export const ALL_PLATFORMS = [...PLATFORMS, PRIVATE_PLATFORM];

export function platformOf(id) {
  return ALL_PLATFORMS.find((p) => p.id === id) ?? null;
}
