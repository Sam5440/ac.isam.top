export const PROBLEM_PAGE_SIZE = 50;
export const PROBLEM_BANDS = ['all', '0-1199', '1200-1599', '1600-2099', '2100-2399', '2400-9999', 'unrated'];
const PLATFORMS = ['atcoder', 'codeforces', 'nowcoder'];
const sortedLists = new WeakMap();

export function normalizeProblemQuery(input = {}) {
  const get = (name) => typeof input.get === 'function' ? input.get(name) : input[name];
  const page = Number(get('page'));
  return {
    platform: PLATFORMS.includes(get('platform')) ? get('platform') : 'all',
    band: PROBLEM_BANDS.includes(get('band')) ? get('band') : 'all',
    q: String(get('q') || '').trim().slice(0, 200),
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}

export function matchesProblemBand(difficulty, band) {
  if (band === 'all') return true;
  if (band === 'unrated') return difficulty == null;
  if (difficulty == null) return false;
  const value = Math.max(0, Math.round(difficulty));
  const [low, high] = band.split('-').map(Number);
  return value >= low && value <= high;
}

function sortedProblems(problems) {
  if (sortedLists.has(problems)) return sortedLists.get(problems);
  const sorted = problems.slice().sort((a, b) =>
    PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform)
    || String(b.contestId).localeCompare(String(a.contestId), undefined, { numeric: true })
    || String(a.index).localeCompare(String(b.index), undefined, { numeric: true }),
  );
  sortedLists.set(problems, sorted);
  return sorted;
}

export function queryProblems(problems, input = {}) {
  const query = normalizeProblemQuery(input);
  const keyword = query.q.toLowerCase();
  const filtered = sortedProblems(problems).filter((problem) =>
    (query.platform === 'all' || problem.platform === query.platform)
    && matchesProblemBand(problem.difficulty, query.band)
    && (!keyword || [problem.title, problem.titleZh, problem.id, problem.contestId]
      .some((value) => String(value ?? '').toLowerCase().includes(keyword))),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PROBLEM_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return {
    page, pages, pageSize: PROBLEM_PAGE_SIZE, total: filtered.length,
    items: filtered.slice((page - 1) * PROBLEM_PAGE_SIZE, page * PROBLEM_PAGE_SIZE).map((p) => ({
      id: p.id, platform: p.platform, contestId: p.contestId, index: p.index,
      title: p.title, titleZh: p.titleZh ?? null, difficulty: p.difficulty ?? null,
      translated: Boolean(p.translated ?? p.statementZhMd),
    })),
  };
}
