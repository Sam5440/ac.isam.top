import { isSafeProblemId, sanitizeProblemId } from './problem-id.mjs';

export const SIM_MAX_PROBLEMS = 300;
export const SIM_STORE_KEY = 'ac-simulator-contests-v1';
export const SIM_STORE_EVENT = 'ac-simulator-changed';
const PLATFORMS = new Map([
  ['atcoder', 'atcoder'], ['at coder', 'atcoder'],
  ['codeforces', 'codeforces'], ['code force', 'codeforces'], ['cf', 'codeforces'],
  ['gym', 'cf-gyms'], ['gyms', 'cf-gyms'], ['cf gym', 'cf-gyms'], ['cf-gyms', 'cf-gyms'],
  ['牛客', 'nowcoder'], ['nowcoder', 'nowcoder'], ['牛客竞赛', 'nowcoder'],
]);

export function parseSimProblemList(text) {
  const rows = [];
  const errors = [];
  for (const [offset, source] of String(text ?? '').split(/\r?\n/).entries()) {
    const line = source.trim();
    if (!line || /^(?:平台|platform)\s*[|\t]/i.test(line)) continue;
    const fields = line.includes('|') ? line.split('|').map((x) => x.trim()) : line.split('\t').map((x) => x.trim());
    if (fields.length < 2 || fields.length > 4) { errors.push({ line: offset + 1, message: '需要 2–4 列：平台、题号、分值、别名' }); continue; }
    const platform = PLATFORMS.get((fields[0] || '').toLowerCase().replace(/[_\s]+/g, ' ').trim());
    if (!platform) { errors.push({ line: offset + 1, message: `不支持的平台「${fields[0]}」` }); continue; }
    const id = sanitizeProblemId(fields[1]);
    if (!isSafeProblemId(id) || id.length > 80) { errors.push({ line: offset + 1, message: '题号为空或格式不合法' }); continue; }
    let points = 1;
    let alias = '';
    if (fields.length === 3) {
      if (fields[2] === '' || /^\d+(?:\.\d+)?$/.test(fields[2])) points = fields[2] === '' ? 1 : Number(fields[2]);
      else alias = fields[2];
    } else if (fields.length === 4) {
      if (fields[2] && !/^\d+(?:\.\d+)?$/.test(fields[2])) { errors.push({ line: offset + 1, message: '分值必须为非负数字' }); continue; }
      points = fields[2] ? Number(fields[2]) : 1;
      alias = fields[3];
    }
    if (!Number.isFinite(points) || points < 0 || points > 1_000_000) { errors.push({ line: offset + 1, message: '分值范围为 0–1,000,000' }); continue; }
    rows.push({ line: offset + 1, platform, id, points, alias: alias.slice(0, 160) });
    if (rows.length > SIM_MAX_PROBLEMS) return { rows: [], errors: [{ line: offset + 1, message: `单场最多 ${SIM_MAX_PROBLEMS} 题` }] };
  }
  return { rows, errors };
}

export function originalProblemUrl(platform, id) {
  const value = String(id);
  if (platform === 'codeforces') {
    const match = /^(\d+)([A-Z]\d*)$/i.exec(value);
    return match ? `https://codeforces.com/problemset/problem/${match[1]}/${match[2].toUpperCase()}` : 'https://codeforces.com/problemset';
  }
  if (platform === 'cf-gyms') {
    const match = /^(\d+)([A-Z]\d*)$/i.exec(value);
    return match ? `https://codeforces.com/gym/${match[1]}/problem/${match[2].toUpperCase()}` : 'https://codeforces.com/gyms';
  }
  if (platform === 'atcoder') {
    const task = value.includes('_') ? value : value.replace(/^([a-z]+\d+)([a-z]\d*)$/i, '$1_$2');
    const contest = task.split('_')[0];
    const normalizedContest = contest.replace(/^(abc|arc|agc)(\d+)$/i, (_, series, number) => `${series}${number.padStart(3, '0')}`);
    return `https://atcoder.jp/contests/${encodeURIComponent(normalizedContest)}/tasks/${encodeURIComponent(task)}`;
  }
  const nc = /^nc(\d+)p([a-z]\d*)$/i.exec(value);
  if (nc) return `https://ac.nowcoder.com/acm/contest/${nc[1]}/${nc[2].toUpperCase()}`;
  return /^\d+$/.test(value) ? `https://ac.nowcoder.com/acm/problem/${value}` : 'https://ac.nowcoder.com/acm/contest';
}

export function encodeSimShare(contest, includeAliases = true) {
  const data = {
    v: 1,
    minutes: contest.minutes || 0,
    name: String(contest.name || '模拟赛').slice(0, 100),
    problems: (contest.problems || []).slice(0, SIM_MAX_PROBLEMS).map((p) => [p.platform, p.id, p.points ?? 1, ...(includeAliases && p.alias ? [p.alias.slice(0, 160)] : [])]),
  };
  return encodeURIComponent(JSON.stringify(data));
}

export function decodeSimShare(value) {
  if (!value || value.length > 750_000) throw new Error('分享数据为空或超出长度限制');
  let data;
  try { data = JSON.parse(value); }
  catch {
    try { data = JSON.parse(decodeURIComponent(value)); }
    catch { throw new Error('分享链接中的比赛数据无法解码'); }
  }
  if (data?.v !== 1 || !Array.isArray(data.problems) || data.problems.length > SIM_MAX_PROBLEMS) throw new Error('分享链接格式不受支持');
  const problems = data.problems.map((row, i) => {
    if (!Array.isArray(row) || !['atcoder', 'codeforces', 'cf-gyms', 'nowcoder'].includes(row[0])) throw new Error(`分享数据第 ${i + 1} 题的平台无效`);
    const id = sanitizeProblemId(row[1]);
    const points = Number(row[2]);
    if (!isSafeProblemId(id) || id.length > 80 || !Number.isFinite(points) || points < 0 || points > 1_000_000) throw new Error(`分享数据第 ${i + 1} 题无效`);
    return { platform: row[0], id, points, alias: typeof row[3] === 'string' ? row[3].slice(0, 160) : '' };
  });
  return { name: typeof data.name === 'string' ? data.name.slice(0, 100) : '模拟赛', minutes: Number.isInteger(data.minutes) && data.minutes > 0 && data.minutes <= 1440 ? data.minutes : 0, problems };
}

// Freeze both clocks at the actual deadline, even if no tick ran while the tab was asleep.
export function clockSnapshot(c, now) {
  const budget = c.minutes ? Math.max(0, c.minutes * 60000 - c.elapsedMs) : Infinity;
  const delta = c.runningSince == null ? 0 : Math.min(budget, Math.max(0, now - c.runningSince));
  const problemTimes = { ...c.problemTimes };
  if (c.runningSince != null && c.activeProblem && c.activeProblemSince != null) {
    problemTimes[c.activeProblem] = (problemTimes[c.activeProblem] || 0) + Math.max(0, c.runningSince + delta - c.activeProblemSince);
  }
  return { elapsedMs: c.elapsedMs + delta, problemTimes, expired: c.minutes > 0 && c.elapsedMs + delta >= c.minutes * 60000 };
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function newSimContest() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id, name: '我的模拟赛', minutes: 0, problems: [], createdAt: Date.now(), elapsedMs: 0, runningSince: null, activeProblem: null, activeProblemSince: null, problemTimes: {}, completed: {} };
}

export function readSimContests(storage) {
  try {
    const value = JSON.parse(storage.getItem(SIM_STORE_KEY) || '[]');
    return Array.isArray(value) ? value.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.problems)) : [];
  } catch {
    return [];
  }
}

export function writeSimContests(storage, contests) {
  storage.setItem(SIM_STORE_KEY, JSON.stringify(contests));
  if (typeof window !== 'undefined' && storage === window.localStorage) window.dispatchEvent(new Event(SIM_STORE_EVENT));
}

export function updateSimContest(storage, id, change) {
  const contests = readSimContests(storage);
  const index = contests.findIndex((contest) => contest.id === id);
  if (index < 0) return null;
  const updated = change(contests[index]);
  contests[index] = updated;
  writeSimContests(storage, contests);
  return updated;
}

export function simContestHref(contest, includeAliases = true) {
  return `/contests/sim/${encodeURIComponent(contest.id)}#data=${encodeSimShare(contest, includeAliases)}`;
}

export function simProblemHref(contest, index, includeAliases = true) {
  return `/contests/sim/${encodeURIComponent(contest.id)}/problems/${index + 1}#data=${encodeSimShare(contest, includeAliases)}`;
}

export function withSimProblemKeys(problems) {
  const occurrences = new Map();
  return problems.map((problem) => {
    const base = `${problem.platform}:${problem.id.toLowerCase()}`;
    const occurrence = occurrences.get(base) || 0;
    occurrences.set(base, occurrence + 1);
    return { ...problem, key: occurrence ? `${base}:${occurrence}` : base };
  });
}

/** 保留仍在题单中的题目状态，重复题优先按别名和分值匹配。 */
export function reconcileSimProblems(contest, problems) {
  const previous = withSimProblemKeys(contest.problems);
  const next = withSimProblemKeys(problems);
  const available = new Set(previous.map((_, index) => index));
  const matches = new Map();
  const sameSource = (a, b) => a.platform === b.platform && a.id.toLowerCase() === b.id.toLowerCase();

  // 先为别名、分值都相同的题匹配，避免前面的改名题抢走后面的精确匹配。
  for (const problem of next) {
    const index = [...available].find((i) => sameSource(previous[i], problem)
      && (previous[i].alias || '') === (problem.alias || '')
      && (previous[i].points ?? 1) === (problem.points ?? 1));
    if (index !== undefined) { matches.set(problem.key, previous[index].key); available.delete(index); }
  }
  for (const problem of next) {
    if (matches.has(problem.key)) continue;
    const index = [...available].find((i) => sameSource(previous[i], problem));
    if (index !== undefined) { matches.set(problem.key, previous[index].key); available.delete(index); }
  }

  const problemTimes = {};
  const completed = {};
  let activeProblem = null;
  for (const [key, oldKey] of matches) {
    if (Object.hasOwn(contest.problemTimes || {}, oldKey)) problemTimes[key] = contest.problemTimes[oldKey];
    if (Object.hasOwn(contest.completed || {}, oldKey)) completed[key] = contest.completed[oldKey];
    if (contest.activeProblem === oldKey) activeProblem = key;
  }
  return { problems: next, problemTimes, completed, activeProblem, activeProblemSince: activeProblem ? contest.activeProblemSince : null };
}

export async function resolveSimProblems(rows) {
  const response = await fetch('/api/simulator/problems', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problems: rows.map(({ platform, id }) => ({ platform, id })) }),
  });
  const body = await response.json();
  if (!response.ok || body.problems?.length !== rows.length) throw new Error(body.error || '题库核验失败');
  return withSimProblemKeys(rows.map((problem, index) => ({ ...problem, ...body.problems[index] })));
}

export function exportSimContests(contests, now = Date.now()) {
  return JSON.stringify({ version: 1, contests: contests.map((contest) => {
    const snapshot = clockSnapshot(contest, now);
    return { ...contest, ...snapshot, runningSince: null, activeProblemSince: null };
  }) }, null, 2);
}

export function importSimContests(text, existing = []) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON'); }
  if (data?.version !== 1 || !Array.isArray(data.contests)) throw new Error('比赛文件格式不受支持');
  const used = new Set(existing.map((contest) => contest.id));
  return data.contests.map((item) => {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || typeof item.name !== 'string' || !Array.isArray(item.problems) || item.problems.length > SIM_MAX_PROBLEMS) throw new Error('比赛数据格式无效');
    const definition = decodeSimShare(encodeSimShare(item));
    if (definition.problems.length !== item.problems.length) throw new Error('比赛题目格式无效');
    const fresh = newSimContest();
    let id = item.id;
    while (used.has(id)) id = newSimContest().id;
    used.add(id);
    const nonnegative = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
    const problemTimes = item.problemTimes && typeof item.problemTimes === 'object' && !Array.isArray(item.problemTimes) ? Object.fromEntries(Object.entries(item.problemTimes).filter(([, value]) => Number.isFinite(value) && value >= 0)) : {};
    const completed = item.completed && typeof item.completed === 'object' && !Array.isArray(item.completed) ? Object.fromEntries(Object.entries(item.completed).filter(([, value]) => typeof value === 'boolean')) : {};
    const restored = { ...fresh, ...definition, problems: withSimProblemKeys(definition.problems), id, createdAt: nonnegative(item.createdAt) || fresh.createdAt, startedAt: nonnegative(item.startedAt) || null, elapsedMs: nonnegative(item.elapsedMs), activeProblem: typeof item.activeProblem === 'string' ? item.activeProblem : null, problemTimes, completed };
    return { ...restored, ...reconcileSimProblems(restored, restored.problems) };
  });
}
