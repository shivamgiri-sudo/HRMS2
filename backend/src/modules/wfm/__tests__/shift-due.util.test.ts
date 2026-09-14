/**
 * Unit tests for the isShiftDueYet guard extracted from 3 duplicated call sites
 * (roster-analytics.service.ts, roster-intelligence.service.ts x2) as part of the
 * WFM Roster Console merge Phase C. Boundary cases only — the end-to-end behavior
 * is separately covered by roster-analytics-shrinkage-not-yet-due.test.ts, which
 * exercises the guard through the real service function.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isShiftDueYet, todayLocalDateStr, currentMinutesOfDayLocal, timeToMinutesLocal } from '../shift-due.util.js';

describe('isShiftDueYet', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const NOW = new Date(2026, 8, 11, 10, 0, 0); // 2026-09-11 10:00 local

  it('returns false when today, shift starts later, and grace has not elapsed', () => {
    expect(isShiftDueYet('19:00:00', '2026-09-11', 5, NOW)).toBe(false);
  });

  it('returns true when today and shift start + grace has already passed', () => {
    expect(isShiftDueYet('08:00:00', '2026-09-11', 5, NOW)).toBe(true);
  });

  it('returns true exactly at the grace boundary (start + grace == now)', () => {
    // Shift starts 09:55, grace 5 min -> due exactly at 10:00
    expect(isShiftDueYet('09:55:00', '2026-09-11', 5, NOW)).toBe(true);
  });

  it('returns false one minute before the grace boundary', () => {
    // Shift starts 09:56, grace 5 min -> due at 10:01, one minute from NOW
    expect(isShiftDueYet('09:56:00', '2026-09-11', 5, NOW)).toBe(false);
  });

  it('returns true for a past date regardless of shift start time', () => {
    expect(isShiftDueYet('23:59:00', '2026-09-08', 5, NOW)).toBe(true);
  });

  it('returns true for a future date (never applicable in practice, but must not hang the caller in a permanent "not due" state)', () => {
    expect(isShiftDueYet('00:01:00', '2026-09-12', 5, NOW)).toBe(true);
  });

  it('returns true when there is no shift start time on record', () => {
    expect(isShiftDueYet(null, '2026-09-11', 5, NOW)).toBe(true);
    expect(isShiftDueYet(undefined, '2026-09-11', 5, NOW)).toBe(true);
    expect(isShiftDueYet('', '2026-09-11', 5, NOW)).toBe(true);
  });

  it('defaults grace to 5 minutes when not passed', () => {
    expect(isShiftDueYet('09:56:00', '2026-09-11', undefined, NOW)).toBe(false);
    expect(isShiftDueYet('09:55:00', '2026-09-11', undefined, NOW)).toBe(true);
  });

  it('uses the real current time when now is not passed (via vi.setSystemTime)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(isShiftDueYet('19:00:00', '2026-09-11')).toBe(false);
    expect(isShiftDueYet('08:00:00', '2026-09-11')).toBe(true);
  });

  it("uses LOCAL date getters, not toISOString() — the exact host-timezone bug this extraction fixed", () => {
    // 2026-09-11 00:10 local time. A UTC-based todayDate() (the old, buggy pattern in
    // roster-intelligence.service.ts) would read this instant as 2026-09-10T18:40:00.000Z,
    // i.e. still "yesterday" in UTC terms, for a host whose real wall clock is IST — exactly
    // the class of bug documented in shift-due.util.ts's file header comment.
    const earlyMorning = new Date(2026, 8, 11, 0, 10, 0);
    expect(todayLocalDateStr(earlyMorning)).toBe('2026-09-11');
    expect(isShiftDueYet('00:05:00', '2026-09-11', 5, earlyMorning)).toBe(true);
    expect(isShiftDueYet('00:20:00', '2026-09-11', 5, earlyMorning)).toBe(false);
  });
});

describe('helper exports', () => {
  it('timeToMinutesLocal parses HH:MM[:SS]', () => {
    expect(timeToMinutesLocal('00:00')).toBe(0);
    expect(timeToMinutesLocal('09:30:00')).toBe(570);
    expect(timeToMinutesLocal('23:59:59')).toBe(1439);
  });

  it('currentMinutesOfDayLocal reads hours/minutes from the given Date', () => {
    expect(currentMinutesOfDayLocal(new Date(2026, 8, 11, 10, 15, 0))).toBe(615);
  });
});
