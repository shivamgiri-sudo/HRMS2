/**
 * Report subscription scheduling.
 *
 * The slot key is the whole idempotency story: it is derived from the DATE, not from the
 * clock, so a restart, a slow run or two workers racing all compute the same key and the
 * unique index on report_subscription_run rejects the second one. Get this wrong and
 * management receives the same weekly report twice.
 */
import { describe, it, expect } from 'vitest';
import { slotKeyFor, computeNextRun } from '../src/workers/report-subscription.worker.js';

describe('slot keys', () => {
  it('is stable for every moment of the same day', () => {
    const morning = new Date('2026-07-31T00:05:00Z');
    const night   = new Date('2026-07-31T23:55:00Z');
    expect(slotKeyFor('daily', morning)).toBe(slotKeyFor('daily', night));
    expect(slotKeyFor('daily', morning)).toBe('2026-07-31');
  });

  it('changes at the day boundary', () => {
    expect(slotKeyFor('daily', new Date('2026-07-31T23:59:59Z')))
      .not.toBe(slotKeyFor('daily', new Date('2026-08-01T00:00:01Z')));
  });

  it('is stable across a whole ISO week', () => {
    // Mon 27 Jul 2026 .. Sun 02 Aug 2026 are one ISO week.
    const mon = slotKeyFor('weekly', new Date('2026-07-27T08:00:00Z'));
    const sun = slotKeyFor('weekly', new Date('2026-08-02T08:00:00Z'));
    expect(mon).toBe(sun);
    expect(mon).toMatch(/^2026-W\d{2}$/);
  });

  it('rolls over to a new week on Monday', () => {
    expect(slotKeyFor('weekly', new Date('2026-08-02T23:00:00Z')))   // Sunday
      .not.toBe(slotKeyFor('weekly', new Date('2026-08-03T01:00:00Z'))); // Monday
  });

  it('is stable across a calendar month', () => {
    expect(slotKeyFor('monthly', new Date('2026-07-01T00:00:00Z'))).toBe('2026-07');
    expect(slotKeyFor('monthly', new Date('2026-07-31T23:00:00Z'))).toBe('2026-07');
  });
});

describe('next-run calculation', () => {
  it('schedules the daily run at the configured hour, tomorrow if today has passed', () => {
    const next = computeNextRun(
      { frequency: 'daily', day_of_week: null, day_of_month: null, hour_of_day: 9 },
      new Date('2026-07-31T10:00:00Z'),
    );
    expect(next.toISOString()).toBe('2026-08-01T09:00:00.000Z');
  });

  it('schedules later the same day when the hour is still ahead', () => {
    const next = computeNextRun(
      { frequency: 'daily', day_of_week: null, day_of_month: null, hour_of_day: 18 },
      new Date('2026-07-31T10:00:00Z'),
    );
    expect(next.toISOString()).toBe('2026-07-31T18:00:00.000Z');
  });

  it('schedules weekly on the configured weekday', () => {
    // day_of_week 0 = Monday. From Fri 31 Jul 2026 -> Mon 03 Aug.
    const next = computeNextRun(
      { frequency: 'weekly', day_of_week: 0, day_of_month: null, hour_of_day: 8 },
      new Date('2026-07-31T10:00:00Z'),
    );
    expect(next.getUTCDay()).toBe(1);                    // JS Monday
    expect(next.toISOString()).toBe('2026-08-03T08:00:00.000Z');
  });

  it('never schedules in the past', () => {
    const from = new Date('2026-07-31T10:00:00Z');
    for (const f of ['daily', 'weekly', 'monthly'] as const) {
      const next = computeNextRun(
        { frequency: f, day_of_week: 0, day_of_month: 1, hour_of_day: 7 }, from);
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    }
  });

  it('clamps day_of_month to 28 so February always has the day', () => {
    const next = computeNextRun(
      { frequency: 'monthly', day_of_week: null, day_of_month: 31, hour_of_day: 7 },
      new Date('2026-01-15T10:00:00Z'),
    );
    expect(next.getUTCDate()).toBe(28);
  });
});
