/**
 * 比赛类型推导（纯函数，client/server 通用）。
 *
 * - AtCoder：按 kenkoooo 比赛号前缀（abc/arc/agc…）
 * - Codeforces：按比赛名中的 Division 标注（Div. 1+2、Div. 1…4）
 */

export const CONTEST_TYPES = [
  { id: 'abc', label: 'ABC', platform: 'atcoder', desc: 'AtCoder Beginner Contest' },
  { id: 'arc', label: 'ARC', platform: 'atcoder', desc: 'AtCoder Regular Contest' },
  { id: 'agc', label: 'AGC', platform: 'atcoder', desc: 'AtCoder Grand Contest' },
  { id: 'div1', label: 'Div. 1', platform: 'codeforces', desc: 'Codeforces Div. 1' },
  { id: 'div2', label: 'Div. 2', platform: 'codeforces', desc: 'Codeforces Div. 2' },
  { id: 'div3', label: 'Div. 3', platform: 'codeforces', desc: 'Codeforces Div. 3' },
  { id: 'div4', label: 'Div. 4', platform: 'codeforces', desc: 'Codeforces Div. 4' },
  { id: 'div12', label: 'Div. 1+2', platform: 'codeforces', desc: 'Codeforces Div. 1 + Div. 2 合并' },
  { id: 'other', label: '其他', platform: 'codeforces', desc: '其它正式赛 / 联赛' },
];

const CF_DIV = (re) => ({
  re,
  id: null, // filled below
});

function cfType(name) {
  const n = String(name);
  if (/div\.?\s*1\s*[\+&]\s*div\.?\s*2|div\s*1\s*\+\s*2/i.test(n)) return 'div12';
  if (/div\.?\s*[^0-9]{0,3}1(?!\d)/i.test(n) && !/div\.?\s*1[0-9]/i.test(n)) return 'div1';
  if (/div\.?\s*2/i.test(n)) return 'div2';
  if (/div\.?\s*3/i.test(n)) return 'div3';
  if (/div\.?\s*4/i.test(n)) return 'div4';
  return 'other';
}

export function contestType(contest) {
  const { platform, id, title } = contest;
  if (platform === 'atcoder') {
    const m = /^(abc|arc|agc|apc|ahc)\d+/.exec(String(id));
    const t = m ? m[1] : 'abc';
    if (t === 'abc' || t === 'arc' || t === 'agc') return t;
    return 'other';
  }
  return cfType(title);
}

export function contestTypeLabel(type) {
  return CONTEST_TYPES.find((t) => t.id === type)?.label ?? type;
}
