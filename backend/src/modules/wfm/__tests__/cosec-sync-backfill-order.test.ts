/**
 * The self-healing sweep must reach YESTERDAY.
 *
 * These pin the ordering property, not the arithmetic. The sweep is the only thing that
 * re-derives a day once it closes, and a punch group assessed while its day was still open
 * carries a `live` verdict — odd punch count means "still inside", 0 minutes applied, which
 * lands as absent and pays zero. assessmentModeForPunchDate() switches to `historical` the
 * moment the date is past, but only if something asks again.
 *
 * The old order asked last. Walking strictly oldest-first put yesterday behind ~7 days at
 * 8-20 minutes each, in a process that restarts every 9-14 minutes and bails whenever the
 * 5-minute fast path takes the lock — so yesterday was the day it almost never reached, and
 * 1,085 rows across 222 employees kept a mid-shift verdict on a closed day.
 *
 * If someone "tidies" this back into a simple descending loop, these fail.
 */
import { describe, it, expect } from 'vitest';
import { backfillDayOrder } from '../cosec-sync.worker.js';

// Fixed date, IST-safe: 2026-08-14 12:00 IST. Never `new Date()` — the sweep's day maths is
// IST-offset and a test that drifts with the clock is worse than no test.
const TODAY = new Date('2026-08-14T06:30:00.000Z');

describe('cosec backfill day order', () => {
  it('visits yesterday first', () => {
    expect(backfillDayOrder(TODAY, 7)[0]).toBe('2026-08-13');
  });

  it('still covers the whole window exactly once', () => {
    const days = backfillDayOrder(TODAY, 7);
    expect(days).toHaveLength(8);                    // D-7..D-0 inclusive
    expect(new Set(days).size).toBe(8);              // no duplicate work
    expect(days).toContain('2026-08-07');            // oldest still swept
    expect(days).toContain('2026-08-14');            // today still swept
  });

  it('keeps the remaining days oldest-first behind yesterday', () => {
    const [first, ...rest] = backfillDayOrder(TODAY, 7);
    expect(first).toBe('2026-08-13');
    expect(rest).toEqual([...rest].sort());          // ascending = oldest first
    expect(rest[0]).toBe('2026-08-07');
  });

  it('does not invent a yesterday when the window is today only', () => {
    // backfillDays=0 is a legitimate configuration (NCOSEC_BACKFILL_DAYS=0). Prepending
    // yesterday there would sync a day the operator deliberately excluded.
    expect(backfillDayOrder(TODAY, 0)).toEqual(['2026-08-14']);
  });

  it('handles a one-day window as yesterday then today', () => {
    expect(backfillDayOrder(TODAY, 1)).toEqual(['2026-08-13', '2026-08-14']);
  });

  it('crosses a month boundary without skipping a day', () => {
    const firstOfMonth = new Date('2026-09-01T06:30:00.000Z');
    const days = backfillDayOrder(firstOfMonth, 3);
    expect(days[0]).toBe('2026-08-31');
    expect(new Set(days).size).toBe(4);
    expect(days).toContain('2026-08-29');
  });
});
