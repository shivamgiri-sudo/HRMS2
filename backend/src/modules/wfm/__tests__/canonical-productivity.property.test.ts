// backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveCanonical, type Contribution } from '../canonical-productivity.js';

// Minutes-from-midnight domain, kept small so overlaps/adjacency/nesting occur often.
const MAX_MINUTE = 200;

const usableIntervalArb: fc.Arbitrary<{ startMinute: number; endMinute: number }> = fc
  .tuple(fc.integer({ min: 0, max: MAX_MINUTE }), fc.integer({ min: 1, max: MAX_MINUTE }))
  .map(([a, b]) => (a < b ? { startMinute: a, endMinute: b } : { startMinute: b, endMinute: a + 1 }))
  .filter((iv) => iv.startMinute < iv.endMinute);

// Deliberately produces zero-length and inverted intervals too — the prior generator could
// only ever emit start < end, so the second disjunct of isUsable() (endMinute <= startMinute)
// was unreachable by any property test despite every oracle claiming to guard it. This one
// covers all three shapes: normal (start < end), zero-length (start === end), and inverted
// (start > end, e.g. an unapportioned midnight-crossing session mapped naively).
const anyIntervalArb: fc.Arbitrary<{ startMinute: number; endMinute: number }> = fc
  .tuple(fc.integer({ min: 0, max: MAX_MINUTE }), fc.integer({ min: 0, max: MAX_MINUTE }))
  .map(([startMinute, endMinute]) => ({ startMinute, endMinute }));

const contributionArb: fc.Arbitrary<Contribution> = fc.record({
  diallerSourceId: fc.uuid(),
  interval: fc.option(anyIntervalArb, { nil: null }),
  magnitudeMinutes: fc.integer({ min: 1, max: 1500 }),
});

describe('deriveCanonical — Property 20: The daily bound holds', () => {
  it('canonical minutes is never more than 1440 for any set of contributions', () => {
    // Feature: payroll-attendance-source-rules, Property 20: The daily bound holds
    fc.assert(
      fc.property(fc.array(contributionArb, { maxLength: 10 }), (contributions) => {
        const result = deriveCanonical(contributions);
        if (result.minutes !== null) {
          expect(result.minutes).toBeLessThanOrEqual(1440);
          expect(result.minutes).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('deriveCanonical — Property 21: Neither shrinkage nor inflation', () => {
  it('canonical minutes is at least the largest single contribution and at most the sum of all contributions, measured on the basis the governing rule actually uses', () => {
    // Feature: payroll-attendance-source-rules, Property 21: Neither shrinkage nor inflation
    //
    // The "contribution size" a bound is measured against depends on which rule governs:
    // interval_union never reads magnitudeMinutes at all, so a bound stated over magnitudes
    // would be comparing two unrelated random quantities. The real invariant for interval_union
    // is the standard union-of-intervals inequality: union length is always >= the longest
    // member interval's length and always <= the sum of member interval lengths. For
    // max_contribution, magnitudeMinutes IS the basis the rule uses, so the bound is stated
    // over (sanitized, non-negative) magnitudes there.
    fc.assert(
      fc.property(fc.array(contributionArb, { minLength: 1, maxLength: 8 }), (contributions) => {
        const result = deriveCanonical(contributions);
        if (result.minutes === null) return; // all-excluded case, nothing to bound

        if (result.rule === 'max_contribution') {
          const magnitudes = contributions.map((c) =>
            Number.isFinite(c.magnitudeMinutes) && c.magnitudeMinutes >= 0 ? c.magnitudeMinutes : 0,
          );
          const largestSingle = Math.max(...magnitudes);
          const sumAll = magnitudes.reduce((a, b) => a + b, 0);
          expect(result.minutes).toBeGreaterThanOrEqual(Math.min(largestSingle, 1440));
          expect(result.minutes).toBeLessThanOrEqual(Math.min(sumAll, 1440));
        } else {
          const lengths = contributions.map((c) => c.interval!.endMinute - c.interval!.startMinute);
          const largestSingle = Math.max(...lengths);
          const sumAll = lengths.reduce((a, b) => a + b, 0);
          expect(result.minutes).toBeGreaterThanOrEqual(Math.min(largestSingle, 1440));
          expect(result.minutes).toBeLessThanOrEqual(Math.min(sumAll, 1440));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('deriveCanonical — Property 22: Recomputation stability, and the producing rule is recorded', () => {
  it('two consecutive derivations over an unchanged contribution set return the same minutes and the same rule', () => {
    // Feature: payroll-attendance-source-rules, Property 22: Recomputation stability, and the producing rule is recorded
    fc.assert(
      fc.property(fc.array(contributionArb, { maxLength: 8 }), (contributions) => {
        const first = deriveCanonical(contributions);
        const second = deriveCanonical(contributions);
        expect(second.minutes).toBe(first.minutes);
        expect(second.rule).toBe(first.rule);
        expect(second.excludedCount).toBe(first.excludedCount);
      }),
      { numRuns: 300 },
    );
  });

  it('does not mutate the input array or reorder it as an observable side effect', () => {
    // Feature: payroll-attendance-source-rules, Property 22: Recomputation stability
    // A real purity check, not one that would still pass under an in-place sort: builds the
    // input already in a randomized (non-start-sorted) order, snapshots it, calls the function,
    // and asserts both array identity/order and every contribution object's own field values
    // are byte-for-byte unchanged afterward.
    fc.assert(
      fc.property(fc.array(contributionArb, { minLength: 2, maxLength: 8 }), (contributions) => {
        const snapshotOrder = contributions.map((c) => c.diallerSourceId);
        const snapshotValues = contributions.map((c) => JSON.stringify(c));

        deriveCanonical(contributions);

        expect(contributions.map((c) => c.diallerSourceId)).toEqual(snapshotOrder);
        expect(contributions.map((c) => JSON.stringify(c))).toEqual(snapshotValues);
      }),
      { numRuns: 300 },
    );
  });

  it('the recorded rule is max_contribution exactly when at least one contribution lacks a usable interval', () => {
    // Feature: payroll-attendance-source-rules, Property 22: Recomputation stability, and the producing rule is recorded
    fc.assert(
      fc.property(fc.array(contributionArb, { minLength: 1, maxLength: 8 }), (contributions) => {
        const result = deriveCanonical(contributions);
        const anyUnusable = contributions.some(
          (c) => c.interval === null || c.interval.endMinute <= c.interval.startMinute,
        );
        if (anyUnusable) {
          expect(result.rule).toBe('max_contribution');
        } else {
          expect(result.rule).toBe('interval_union');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('excludedCount equals the number of unusable contributions when max_contribution governs, and is always 0 under interval_union', () => {
    // Feature: payroll-attendance-source-rules, Property 22: Recomputation stability, and the producing rule is recorded
    // Kills a mutant that returns a fixed or wrong excludedCount — nothing previously asserted
    // this field at all.
    fc.assert(
      fc.property(fc.array(contributionArb, { minLength: 1, maxLength: 8 }), (contributions) => {
        const result = deriveCanonical(contributions);
        const unusableCount = contributions.filter(
          (c) => c.interval === null || c.interval.endMinute <= c.interval.startMinute,
        ).length;

        if (result.rule === 'max_contribution') {
          expect(result.excludedCount).toBe(unusableCount);
        } else {
          expect(result.excludedCount).toBe(0);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('deriveCanonical — absent is never zero (criterion 18.10)', () => {
  it('an empty contribution list returns minutes: null, not 0', () => {
    const result = deriveCanonical([]);
    expect(result.minutes).toBeNull();
    expect(result.rule).toBeNull();
    expect(result.excludedCount).toBe(0);
  });
});

describe('deriveCanonical — hand-traced example scenarios', () => {
  it('overlapping intervals from two sources count the overlap once (interval_union)', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 100 }, magnitudeMinutes: 90 },
      { diallerSourceId: 'src-b', interval: { startMinute: 50, endMinute: 150 }, magnitudeMinutes: 95 },
    ];
    // union of [0,100) and [50,150) is [0,150) = 150 minutes, not 90+95=185
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('interval_union');
    expect(result.minutes).toBe(150);
    expect(result.excludedCount).toBe(0);
  });

  it('adjacent (touching, non-overlapping) intervals sum exactly', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 60 }, magnitudeMinutes: 60 },
      { diallerSourceId: 'src-b', interval: { startMinute: 60, endMinute: 120 }, magnitudeMinutes: 60 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('interval_union');
    expect(result.minutes).toBe(120);
  });

  it('a nested interval contributes nothing extra beyond the interval that contains it', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 200 }, magnitudeMinutes: 200 },
      { diallerSourceId: 'src-b', interval: { startMinute: 50, endMinute: 100 }, magnitudeMinutes: 50 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('interval_union');
    expect(result.minutes).toBe(200);
  });

  it('a single contribution with no usable interval (manual upload, login_minutes only) falls to max_contribution', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 420 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(420);
    expect(result.excludedCount).toBe(1);
  });

  it('one interval-less contribution demotes the WHOLE employee-date to max_contribution, even with other usable intervals present', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 480 }, magnitudeMinutes: 480 },
      { diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 500 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(500); // max(480, 500), NOT the 480-minute interval union
    expect(result.excludedCount).toBe(1);
  });

  it('a zero-length interval (Logout_Time equals Login_Time) is unusable and demotes to max_contribution', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 100, endMinute: 100 }, magnitudeMinutes: 0 },
      { diallerSourceId: 'src-b', interval: { startMinute: 0, endMinute: 60 }, magnitudeMinutes: 60 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(60);
    expect(result.excludedCount).toBe(1);
  });

  it('an inverted interval (Logout_Time before Login_Time — an unapportioned midnight-crossing session) is unusable, demotes to max_contribution, and never yields a negative result', () => {
    // A midnight-crossing session naively mapped without apportionment (Phase 3's job, per
    // criterion 18.8) produces exactly this shape: e.g. login 23:00 (minute 1380), logout
    // 01:00 next day (minute 60) mapped onto a single date gives {start: 1380, end: 60}. This
    // must be treated as unusable, not read as a negative-length interval.
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 60 }, magnitudeMinutes: 60 },
      { diallerSourceId: 'src-crossing', interval: { startMinute: 1380, endMinute: 60 }, magnitudeMinutes: 90 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(90);
    expect(result.minutes).toBeGreaterThanOrEqual(0);
    expect(result.excludedCount).toBe(1);
  });

  it('a set of contributions summing past 1440 minutes clamps to 1440 (the impossible-day case E11 measured)', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 800 }, magnitudeMinutes: 800 },
      { diallerSourceId: 'src-b', interval: { startMinute: 700, endMinute: 1600 }, magnitudeMinutes: 900 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.minutes).toBeLessThanOrEqual(1440);
  });

  it('the max_contribution branch also clamps to 1440 (not just interval_union)', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 2000 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(1440);
  });

  it('a negative or non-finite magnitude never produces a negative or NaN result', () => {
    const negativeCase: Contribution[] = [
      { diallerSourceId: 'src-junk', interval: null, magnitudeMinutes: -300 },
    ];
    const nanCase: Contribution[] = [
      { diallerSourceId: 'src-junk', interval: null, magnitudeMinutes: NaN },
    ];
    expect(deriveCanonical(negativeCase).minutes).toBe(0);
    expect(deriveCanonical(nanCase).minutes).toBe(0);
    expect(Number.isFinite(deriveCanonical(nanCase).minutes)).toBe(true);
  });
});
