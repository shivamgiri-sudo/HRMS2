import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertNotBeforeToday, canBackdateDates } from '../dateUtils.js';

describe('assertNotBeforeToday', () => {
  afterEach(() => vi.useRealTimers());

  it('rejects a date before today (IST)', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-25T06:00:00Z'));
    expect(() => assertNotBeforeToday('2026-09-24', 'Date of joining')).toThrow(/before today/);
  });

  it('allows today and future dates', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-25T06:00:00Z'));
    expect(() => assertNotBeforeToday('2026-09-25', 'x')).not.toThrow();
    expect(() => assertNotBeforeToday('2026-10-01', 'x')).not.toThrow();
  });

  it('uses the IST calendar day, not UTC', () => {
    // 20:00 UTC on 24 Sep is already 25 Sep 01:30 IST
    vi.useFakeTimers().setSystemTime(new Date('2026-09-24T20:00:00Z'));
    expect(() => assertNotBeforeToday('2026-09-24', 'x')).toThrow();
  });

  it('allows re-saving an already-stored past date unchanged', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-25T06:00:00Z'));
    expect(() => assertNotBeforeToday('2026-09-18', 'x', '2026-09-18')).not.toThrow();
    expect(() => assertNotBeforeToday('2026-09-19', 'x', '2026-09-18')).toThrow();
  });

  it('ignores empty values', () => {
    expect(() => assertNotBeforeToday('', 'x')).not.toThrow();
    expect(() => assertNotBeforeToday(null, 'x')).not.toThrow();
  });

  it('lets super_admin / payroll_head override via allowPast', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-25T06:00:00Z'));
    expect(() => assertNotBeforeToday('2026-09-01', 'x', undefined, true)).not.toThrow();
  });
});

describe('canBackdateDates', () => {
  it('is true only for super_admin and payroll_head', () => {
    expect(canBackdateDates(['super_admin'])).toBe(true);
    expect(canBackdateDates(['hr', 'payroll_head'])).toBe(true);
    expect(canBackdateDates(['admin'])).toBe(false);
    expect(canBackdateDates(['payroll_hr', 'branch_head'])).toBe(false);
    expect(canBackdateDates(undefined)).toBe(false);
  });
});
