import { describe, expect, it } from 'vitest';
import { formatRelative } from '../../src/renderer/src/features/library/relative-time';

// Local times, so calendar days don't depend on the machine's time zone.
const now = new Date(2026, 9, 17, 15, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ago = (ms: number) => new Date(now.getTime() - ms);

function inEveryLanguage(date: Date) {
  return {
    en: formatRelative(date, now, 'en'),
    es: formatRelative(date, now, 'es'),
    ko: formatRelative(date, now, 'ko'),
  };
}

describe('formatRelative', () => {
  it('formatRelative: en "2 hours ago", es "hace 2 horas", ko "2시간 전"', () => {
    expect(inEveryLanguage(ago(2 * HOUR))).toEqual({
      en: '2 hours ago',
      es: 'hace 2 horas',
      ko: '2시간 전',
    });
  });

  it('says now under a minute, and for a time just ahead of this clock', () => {
    const now_ = { en: 'now', es: 'ahora', ko: '지금' };
    expect(inEveryLanguage(ago(40_000))).toEqual(now_);
    expect(inEveryLanguage(new Date(now.getTime() + 5_000))).toEqual(now_);
  });

  it('counts whole minutes, then whole hours', () => {
    expect(inEveryLanguage(ago(5 * MINUTE + 50_000))).toEqual({
      en: '5 minutes ago',
      es: 'hace 5 minutos',
      ko: '5분 전',
    });
    expect(formatRelative(ago(HOUR + 59 * MINUTE), now, 'en')).toBe('1 hour ago');
    expect(formatRelative(ago(23 * HOUR), now, 'en')).toBe('23 hours ago');
  });

  it('counts calendar days past a day: yesterday, then days ago', () => {
    // 30 hours ago is yesterday's calendar date.
    expect(inEveryLanguage(new Date(2026, 9, 16, 9, 0))).toEqual({
      en: 'yesterday',
      es: 'ayer',
      ko: '어제',
    });
    // 39 hours ago is still yesterday's date; a minute earlier is two calendar days back.
    expect(formatRelative(new Date(2026, 9, 16, 0, 0), now, 'en')).toBe('yesterday');
    expect(formatRelative(new Date(2026, 9, 15, 23, 59), now, 'en')).toBe('2 days ago');
    expect(inEveryLanguage(new Date(2026, 9, 14, 18, 0))).toEqual({
      en: '3 days ago',
      es: 'hace 3 días',
      ko: '3일 전',
    });
  });

  it('moves on to weeks, then calendar months and years', () => {
    expect(inEveryLanguage(new Date(2026, 9, 7, 12, 0))).toEqual({
      en: 'last week',
      es: 'la semana pasada',
      ko: '지난주',
    });
    expect(formatRelative(new Date(2026, 8, 19, 12, 0), now, 'en')).toBe('4 weeks ago');
    expect(inEveryLanguage(new Date(2026, 8, 2, 12, 0))).toEqual({
      en: 'last month',
      es: 'el mes pasado',
      ko: '지난달',
    });
    expect(formatRelative(new Date(2026, 6, 1, 12, 0), now, 'en')).toBe('3 months ago');
    expect(inEveryLanguage(new Date(2025, 8, 12, 12, 0))).toEqual({
      en: 'last year',
      es: 'el año pasado',
      ko: '작년',
    });
    expect(formatRelative(new Date(2023, 11, 31, 12, 0), now, 'en')).toBe('3 years ago');
  });
});
