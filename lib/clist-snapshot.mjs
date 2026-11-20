const MAX_LIMIT = 500;

export function clistTimestamp(value) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text) ? `${text}Z` : text;
}

function contestTime(value) {
  const time = Date.parse(clistTimestamp(value));
  return Number.isFinite(time) ? time : 0;
}

export function pickClistContests(data) {
  const objects = data?.objects;
  const list = Array.isArray(objects) ? objects : Array.isArray(objects?.contest) ? objects.contest : [];
  return list.map((contest) => ({
    id: contest.id,
    event: contest.event,
    resource: contest.resource,
    start: contest.start,
    end: contest.end,
    duration: contest.duration,
    href: contest.href,
  }));
}

function durationMs(value) {
  const match = /^(\d+)\s+(second|minute|hour|day|week)s?$/i.exec(String(value ?? '').trim());
  if (!match) return 30 * 86_400_000;
  const unit = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[match[2].toLowerCase()];
  return Number(match[1]) * unit;
}

export function queryClistSnapshot(snapshot, searchParams, now = Date.now()) {
  let list = Array.isArray(snapshot?.contests) ? [...snapshot.contests] : [];
  const gte = searchParams.get('start__gte');
  const lte = searchParams.get('start__lte');
  const during = searchParams.get('start_time__during');
  let start = 0;
  let end = 0;
  if (gte) start = contestTime(gte);
  else {
    start = now;
    end = start + durationMs(during || '30 days');
  }
  if (lte) end = contestTime(lte);
  if (start) list = list.filter((contest) => contestTime(contest.start) >= start);
  if (end) list = list.filter((contest) => contestTime(contest.start) <= end);
  const order = searchParams.get('order_by') || 'start';
  const direction = order.startsWith('-') ? -1 : 1;
  const field = order.replace(/^-/, '');
  list.sort((a, b) => {
    const result = field === 'id' ? Number(a.id) - Number(b.id) : contestTime(a.start) - contestTime(b.start);
    return direction * (result || String(a.event).localeCompare(String(b.event)) || Number(a.id) - Number(b.id));
  });
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(searchParams.get('limit'), 10) || 100));
  const offset = Math.max(0, Number.parseInt(searchParams.get('offset'), 10) || 0);
  return {
    fetchedAt: snapshot?.fetchedAt ?? null,
    contests: list.slice(offset, offset + limit),
  };
}
