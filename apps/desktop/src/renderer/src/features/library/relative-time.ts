// "2 hours ago", "ayer", "지금": how long ago a session was active, in the UI language.
import type { Lang } from '@tassel/shared/i18n';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const formatters = new Map<Lang, Intl.RelativeTimeFormat>();

function formatterFor(lang: Lang): Intl.RelativeTimeFormat {
  let formatter = formatters.get(lang);
  if (!formatter) {
    // numeric: 'auto' says "yesterday" and "last week" rather than "1 day ago".
    formatter = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    formatters.set(lang, formatter);
  }
  return formatter;
}

/** Local midnight at the start of the date's day. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * How long before `now` the date was. Under a minute (or a little ahead of this clock) is "now";
 * then whole minutes and hours. Past a day it counts calendar days, so anything on yesterday's
 * date is "yesterday"; then weeks, calendar months and calendar years.
 */
export function formatRelative(date: Date, now: Date, lang: Lang): string {
  const format = formatterFor(lang);
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return format.format(0, 'second');
  if (elapsed < HOUR) return format.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return format.format(-Math.floor(elapsed / HOUR), 'hour');
  // Rounding absorbs the 23- and 25-hour days around daylight-saving changes.
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days < 7) return format.format(-days, 'day');
  if (days < 35) return format.format(-Math.floor(days / 7), 'week');
  const months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (months < 12) return format.format(-months, 'month');
  return format.format(-(now.getFullYear() - date.getFullYear()), 'year');
}
