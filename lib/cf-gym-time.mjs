const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export function parseCfDate(text) {
  const m = /([A-Z][a-z]{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::\d{2})?\s*(?:UTC([+-])(\d{1,2})(?::?(\d{2}))?)?/.exec(String(text));
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (month === undefined) return null;
  const offsetMinutes = m[6]
    ? (Number(m[7]) * 60 + Number(m[8] ?? 0)) * (m[6] === '+' ? 1 : -1)
    : 0;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[2]), Number(m[4]), Number(m[5])) - offsetMinutes * 60000).toISOString();
}

export function resolveGymApiStartTime(currentStartTime, startTimeSeconds) {
  if (!Number.isFinite(startTimeSeconds)) return currentStartTime ?? null;
  return new Date(startTimeSeconds * 1000).toISOString();
}
