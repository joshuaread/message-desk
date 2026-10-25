// Service-date helpers. The default service date is the most recent Sunday in
// the configured timezone (TZ, default America/Chicago), unless the recording
// carries a recent creation_time tag.

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The YYYY-MM-DD of the most recent Sunday (today if today is Sunday) in `tz`. */
export function mostRecentSunday(tz, now = new Date()) {
  let y, m, d, weekday;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    });
    const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
    y = Number(parts.year);
    m = Number(parts.month);
    d = Number(parts.day);
    weekday = WEEKDAYS[String(parts.weekday)] ?? 0;
  } catch {
    y = now.getUTCFullYear();
    m = now.getUTCMonth() + 1;
    d = now.getUTCDate();
    weekday = now.getUTCDay();
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

/** Pick a default service date: a recent recording creation_time if present, else last Sunday. */
export function defaultServiceDate(tz, creationTime, now = new Date()) {
  if (creationTime) {
    const parsed = new Date(creationTime);
    if (!Number.isNaN(parsed.getTime())) {
      const ageDays = (now.getTime() - parsed.getTime()) / 86_400_000;
      if (ageDays >= -1 && ageDays <= 14) return parsed.toISOString().slice(0, 10);
    }
  }
  return mostRecentSunday(tz, now);
}
