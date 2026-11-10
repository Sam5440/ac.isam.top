export function staticLimit(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : fallback;
}

export function selectStaticProblems(problems, contests, limit) {
  const times = new Map(contests.map((c) => [
    `${c.platform}:${c.id}`, Date.parse(c.startTime) || 0,
  ]));
  return problems.slice().sort((a, b) =>
    (times.get(`${b.platform}:${b.contestId}`) || 0) - (times.get(`${a.platform}:${a.contestId}`) || 0)
    || String(a.index).localeCompare(String(b.index), undefined, { numeric: true })
    || String(a.id).localeCompare(String(b.id)),
  ).slice(0, limit);
}
