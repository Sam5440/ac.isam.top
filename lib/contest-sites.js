const KNOWN_SITES = {
  'ac.nowcoder.com': { label: '牛客', short: 'N', badge: 'bg-sky-600' },
  'luogu.com.cn': { label: '洛谷', short: '洛', badge: 'bg-violet-600' },
  'atcoder.jp': { label: 'AtCoder', short: 'AT', badge: 'bg-amber-700' },
  'codeforces.com': { label: 'Codeforces', short: 'CF', badge: 'bg-rose-600' },
  'leetcode.com': { label: 'LeetCode', short: 'LC', badge: 'bg-orange-500' },
  'codechef.com': { label: 'CodeChef', short: 'CC', badge: 'bg-stone-600' },
};

const OTHER_PALETTE = ['bg-emerald-600', 'bg-teal-600', 'bg-indigo-600', 'bg-pink-600', 'bg-lime-700', 'bg-cyan-700'];

function hashCode(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function contestSiteMeta(resource) {
  const value = String(resource || '未知站点');
  if (KNOWN_SITES[value]) return KNOWN_SITES[value];
  const base = value.replace(/^(www|ac|contest|contests)\./, '');
  return {
    label: value,
    short: base.slice(0, 2).toUpperCase(),
    badge: OTHER_PALETTE[hashCode(value) % OTHER_PALETTE.length],
  };
}
