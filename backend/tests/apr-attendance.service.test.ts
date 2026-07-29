import { describe, expect, it } from 'vitest';
import {
  parseSqlTimeToMinutes,
  isSqlTime,
  composeIstDateTime,
  resolveAprUserIds,
} from '../src/modules/wfm/apr-attendance.service.js';

describe('parseSqlTimeToMinutes', () => {
  it('parses a normal MySQL TIME value', () => {
    expect(parseSqlTimeToMinutes('09:15:00')).toBe(555);
    expect(parseSqlTimeToMinutes('08:00:00')).toBe(480);
    expect(parseSqlTimeToMinutes('00:00:00')).toBe(0);
  });

  it('handles TIME values beyond 24h (night shift)', () => {
    expect(parseSqlTimeToMinutes('27:30:00')).toBe(1650);
  });

  it('rounds seconds to the nearest minute', () => {
    expect(parseSqlTimeToMinutes('00:00:30')).toBe(1);
    expect(parseSqlTimeToMinutes('00:00:29')).toBe(0);
  });

  it('returns 0 for null, blank and malformed input rather than NaN', () => {
    expect(parseSqlTimeToMinutes(null)).toBe(0);
    expect(parseSqlTimeToMinutes(undefined)).toBe(0);
    expect(parseSqlTimeToMinutes('')).toBe(0);
    expect(parseSqlTimeToMinutes('garbage')).toBe(0);
    // A DATETIME is not a TIME — must not be silently misparsed.
    expect(parseSqlTimeToMinutes('2026-07-29 09:15:00')).toBe(0);
  });
});

describe('isSqlTime', () => {
  it('accepts TIME and rejects datetimes/junk', () => {
    expect(isSqlTime('09:15:00')).toBe(true);
    expect(isSqlTime('27:30')).toBe(true);
    expect(isSqlTime('2026-07-29 09:15:00')).toBe(false);
    expect(isSqlTime('99:99:99')).toBe(false);
    expect(isSqlTime(null)).toBe(false);
  });
});

describe('composeIstDateTime', () => {
  it('tags the time as IST so the client can parse it directly', () => {
    expect(composeIstDateTime('2026-07-29', '09:15:00')).toBe('2026-07-29T09:15:00+05:30');
  });

  it('rolls the date forward for TIME >= 24h', () => {
    expect(composeIstDateTime('2026-07-29', '27:30:00')).toBe('2026-07-30T03:30:00+05:30');
  });

  it('returns null when either part is missing or invalid', () => {
    expect(composeIstDateTime(null, '09:15:00')).toBeNull();
    expect(composeIstDateTime('2026-07-29', null)).toBeNull();
    expect(composeIstDateTime('2026-07-29', 'garbage')).toBeNull();
  });

  it('produces a value that Date can actually parse', () => {
    const composed = composeIstDateTime('2026-07-29', '18:45:00')!;
    expect(Number.isNaN(new Date(composed).getTime())).toBe(false);
  });
});

describe('resolveAprUserIds', () => {
  it('prefers call_centre_code, then employee_code, then biometric_code', () => {
    expect(
      resolveAprUserIds({ call_centre_code: 'CC1', employee_code: 'E1', biometric_code: 'B1' }),
    ).toEqual(['CC1', 'E1', 'B1']);
  });

  it('skips blank and null codes and de-duplicates', () => {
    expect(resolveAprUserIds({ call_centre_code: '  ', employee_code: 'E1', biometric_code: 'E1' }))
      .toEqual(['E1']);
    expect(resolveAprUserIds({})).toEqual([]);
  });
});

/**
 * Regression guard for the "login/logout shows only a year" bug.
 *
 * The attendance hub table rendered clock_in/clock_out with `value.slice(0, 5)`.
 * The API returns those as IST-tagged datetimes, so the UI displayed "2026-" —
 * the year alone — in both columns. The shared extractTimeOfDay/formatTime24
 * helpers (src/lib/utils.ts) must handle every shape the API can return.
 * Logic mirrored here because the frontend has no test runner configured.
 */
function extractTimeOfDay(value?: string | null) {
  if (!value) return null;
  const s = String(value).trim();
  const dt = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):([0-5]\d)(?::([0-5]\d))?/.exec(s);
  if (dt) return { hours: Number(dt[1]), minutes: dt[2], seconds: dt[3] ?? '00' };
  const t = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(s);
  if (t) return { hours: Number(t[1]), minutes: t[2], seconds: t[3] ?? '00' };
  return null;
}
function formatTime24(value?: string | null, fallback = '—') {
  const t = extractTimeOfDay(value);
  if (!t) return fallback;
  return `${String(t.hours % 24).padStart(2, '0')}:${t.minutes}`;
}

describe('formatTime24 — attendance hub login/logout columns', () => {
  it('renders an IST-tagged datetime as a time, not a bare year', () => {
    // The exact shape toIST() returns for attendance_daily_record.clock_in_time.
    expect('2026-07-29T09:15:00+05:30'.slice(0, 5)).toBe('2026-'); // the old bug
    expect(formatTime24('2026-07-29T09:15:00+05:30')).toBe('09:15');
  });

  it('handles MySQL DATETIME, bare TIME and night-shift TIME', () => {
    expect(formatTime24('2026-07-29 18:45:00')).toBe('18:45');
    expect(formatTime24('09:15:00')).toBe('09:15');   // APR Login_Time
    expect(formatTime24('27:30:00')).toBe('03:30');   // TIME beyond 24h
    expect(formatTime24('2026-07-29T00:05:00+05:30')).toBe('00:05');
  });

  it('falls back cleanly for null/blank/garbage', () => {
    expect(formatTime24(null)).toBe('—');
    expect(formatTime24('')).toBe('—');
    expect(formatTime24('garbage')).toBe('—');
  });
});

/**
 * Late-arrival detection.
 *
 * calculateLateArrival() previously read the clock-in ONLY from
 * wfm_attendance_session (the web punch table, which is informational and empty
 * for the biometric/COSEC population) and required a published roster row for
 * the shift start. Both conditions failed for virtually every employee, so
 * late_mark was never set and every "Late Marks" figure in the UI read 0/blank.
 * It now falls back to attendance_daily_record.clock_in_time / the biometric
 * log, and to employees.working_hours_start.
 *
 * The minute arithmetic is mirrored here (the DB lookups live in the service).
 */
import { minutesOfDay } from '../src/shared/timezone.js';

function lateFrom(clockIn: unknown, shiftStart: unknown, graceMinutes: number) {
  const c = minutesOfDay(clockIn);
  const s = minutesOfDay(shiftStart);
  if (c === null || s === null) return { lateMark: 0, lateByMinutes: 0 };
  let d = c - s;
  if (d < -720) d += 1440; // shift wrapped past midnight
  return d > graceMinutes
    ? { lateMark: 1, lateByMinutes: d }
    : { lateMark: 0, lateByMinutes: Math.max(0, d) };
}

describe('minutesOfDay', () => {
  it('reads the time out of every shape the attendance tables hold', () => {
    expect(minutesOfDay('2026-07-29T09:15:00+05:30')).toBe(555); // IST-tagged ISO
    expect(minutesOfDay('2026-07-29 09:15:00')).toBe(555);       // MySQL DATETIME
    expect(minutesOfDay('09:15:00')).toBe(555);                  // bare TIME
    expect(minutesOfDay('00:00:00')).toBe(0);
  });

  it('returns null when there is no usable time', () => {
    expect(minutesOfDay(null)).toBeNull();
    expect(minutesOfDay('')).toBeNull();
    expect(minutesOfDay('garbage')).toBeNull();
  });
});

describe('late arrival', () => {
  it('marks late past the grace window using a biometric clock-in', () => {
    expect(lateFrom('2026-07-29T09:20:00+05:30', '09:00:00', 15))
      .toEqual({ lateMark: 1, lateByMinutes: 20 });
  });

  it('does not mark late inside the grace window', () => {
    expect(lateFrom('2026-07-29T09:10:00+05:30', '09:00:00', 15))
      .toEqual({ lateMark: 0, lateByMinutes: 10 });
  });

  it('never reports negative lateness for an early arrival', () => {
    expect(lateFrom('2026-07-29T08:30:00+05:30', '09:00:00', 15))
      .toEqual({ lateMark: 0, lateByMinutes: 0 });
  });

  it('handles a night shift that wraps past midnight', () => {
    // 22:00 shift, punched in at 01:00 next day => 180 min late, not -1260.
    expect(lateFrom('2026-07-30T01:00:00+05:30', '22:00:00', 15))
      .toEqual({ lateMark: 1, lateByMinutes: 180 });
    expect(lateFrom('2026-07-29T22:05:00+05:30', '22:00:00', 15))
      .toEqual({ lateMark: 0, lateByMinutes: 5 });
  });

  it('stays neutral when either the punch or the shift basis is missing', () => {
    expect(lateFrom(null, '09:00:00', 15)).toEqual({ lateMark: 0, lateByMinutes: 0 });
    expect(lateFrom('2026-07-29T09:30:00+05:30', null, 15)).toEqual({ lateMark: 0, lateByMinutes: 0 });
  });
});
