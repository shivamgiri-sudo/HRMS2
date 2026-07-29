/**
 * Tests the REAL frontend module (src/lib/timeOfDay.ts), not a copy.
 *
 * The frontend has no test runner configured, so this suite runs under the
 * backend's vitest and imports the shipped source directly by relative path.
 * That is only possible because timeOfDay.ts is dependency-free — keep it that
 * way, or this coverage silently stops testing what actually ships.
 *
 * Guards the "login/logout shows only a year" defect: the attendance hub used
 * `value.slice(0, 5)` on an IST-tagged datetime, so "2026-07-29T09:15:00+05:30"
 * rendered as "2026-" in both the Login and Logout columns.
 */
import { describe, expect, it } from 'vitest';
import {
  extractTimeOfDay,
  formatTime24,
  formatClockTime,
  minutesOfDay,
  clockTimeToMinutes,
  formatDuration,
} from '../../src/lib/timeOfDay';

// Exactly what toIST() emits for attendance_daily_record.clock_in_time.
const IST_ISO = '2026-07-29T09:15:00+05:30';
const MYSQL_DATETIME = '2026-07-29 09:15:00';
const BARE_TIME = '09:15:00';
const NIGHT_SHIFT_TIME = '27:30:00';

describe('the year-only regression', () => {
  it('reproduces the old bug so the fix is unambiguous', () => {
    expect(IST_ISO.slice(0, 5)).toBe('2026-');
    expect(MYSQL_DATETIME.slice(0, 5)).toBe('2026-');
  });

  it('renders a real time for every shape the API returns', () => {
    expect(formatTime24(IST_ISO)).toBe('09:15');
    expect(formatTime24(MYSQL_DATETIME)).toBe('09:15');
    expect(formatTime24(BARE_TIME)).toBe('09:15');
  });

  it('never returns a value containing a year', () => {
    for (const v of [IST_ISO, MYSQL_DATETIME, BARE_TIME, NIGHT_SHIFT_TIME]) {
      expect(formatTime24(v)).not.toMatch(/\d{4}/);
      expect(formatClockTime(v)).not.toMatch(/\d{4}/);
    }
  });
});

describe('extractTimeOfDay', () => {
  it('parses datetime, TIME and night-shift TIME', () => {
    expect(extractTimeOfDay(IST_ISO)).toEqual({ hours: 9, minutes: '15', seconds: '00' });
    expect(extractTimeOfDay(MYSQL_DATETIME)).toEqual({ hours: 9, minutes: '15', seconds: '00' });
    expect(extractTimeOfDay('18:45:30')).toEqual({ hours: 18, minutes: '45', seconds: '30' });
    // Hours are preserved as written so callers can detect a rolled-over shift.
    expect(extractTimeOfDay(NIGHT_SHIFT_TIME)?.hours).toBe(27);
  });

  it('returns null rather than guessing', () => {
    for (const v of [null, undefined, '', '   ', 'garbage', '2026-07-29', '99:99:99', '25:70:00']) {
      expect(extractTimeOfDay(v as string | null)).toBeNull();
    }
  });
});

describe('formatTime24 / formatClockTime', () => {
  it('wraps hours past midnight', () => {
    expect(formatTime24(NIGHT_SHIFT_TIME)).toBe('03:30');
    expect(formatClockTime(NIGHT_SHIFT_TIME)).toBe('3:30 AM');
  });

  it('handles the 12-hour boundaries correctly', () => {
    expect(formatClockTime('00:05:00')).toBe('12:05 AM');
    expect(formatClockTime('12:00:00')).toBe('12:00 PM');
    expect(formatClockTime('12:30:00')).toBe('12:30 PM');
    expect(formatClockTime('23:59:00')).toBe('11:59 PM');
    expect(formatTime24('00:00:00')).toBe('00:00');
  });

  it('uses the caller-supplied fallback', () => {
    expect(formatTime24(null)).toBe('—');
    expect(formatTime24(null, 'n/a')).toBe('n/a');
    expect(formatClockTime(null)).toBe('--:--');
    expect(formatClockTime('garbage', 'x')).toBe('x');
  });
});

describe('minutesOfDay', () => {
  it('converts every shape to minutes since midnight', () => {
    expect(minutesOfDay(IST_ISO)).toBe(555);
    expect(minutesOfDay(MYSQL_DATETIME)).toBe(555);
    expect(minutesOfDay(BARE_TIME)).toBe(555);
    expect(minutesOfDay('00:00:00')).toBe(0);
    expect(minutesOfDay(NIGHT_SHIFT_TIME)).toBe(210); // 27:30 wraps to 03:30
  });

  it('returns null with no usable time', () => {
    expect(minutesOfDay(null)).toBeNull();
    expect(minutesOfDay('garbage')).toBeNull();
  });
});

describe('clockTimeToMinutes — durations, not clock times', () => {
  it('does NOT wrap, because Net_Login is a duration', () => {
    expect(clockTimeToMinutes('08:00:00')).toBe(480);
    expect(clockTimeToMinutes(NIGHT_SHIFT_TIME)).toBe(1650); // not 210
  });

  it('rounds seconds and rejects non-TIME input', () => {
    expect(clockTimeToMinutes('00:00:30')).toBe(1);
    expect(clockTimeToMinutes('00:00:29')).toBe(0);
    // A datetime is not a duration — must not be silently misread.
    expect(clockTimeToMinutes(MYSQL_DATETIME)).toBeNull();
    expect(clockTimeToMinutes(null)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats minute counts', () => {
    expect(formatDuration(480)).toBe('8h');
    expect(formatDuration(499)).toBe('8h 19m');
    expect(formatDuration(0)).toBe('0h');
  });

  it('is defensive about bad input', () => {
    expect(formatDuration(null)).toBe('--');
    expect(formatDuration(undefined)).toBe('--');
    expect(formatDuration(Number.NaN)).toBe('--');
    expect(formatDuration(-5)).toBe('0h');
  });
});
