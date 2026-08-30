import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveCanonical, type Contribution } from '../canonical-productivity.js';

// Minutes-from-midnight domain, kept small so overlaps/adjacency/nesting occur often.
const MAX_MINUTE = 200;

const usableIntervalArb: fc.Arbitrary<{ startMinute: number; endMinute: number }> = fc
  .tuple(fc.integer({ min: 0, max: MAX_MINUTE }), fc.integer({ min: 1, max: MAX_MINUTE }))
  .map(([a, b]) => (a < b ? { startMinute: a, endMinute: b } : { startMinute: b, endMinute: a + 1 }))
  .filter((iv) => iv.startMinute < iv.endMinute);

const contributionArb: fc.Arbitrary<Contribution> = fc.record({
  diallerSourceId: fc.uuid(),
  interval: fc.option(usableIntervalArb, { nil: null }),
  magnitudeMinutes: fc.integer({ min: 1, max: 1500 }),
});

const allUsableContributionsArb: fc.Arbitrary<Contribution[]> = fc.array(
  fc.record({
    diallerSourceId: fc.uuid(),
    interval: usableIntervalArb,
    magnitudeMinutes: fc.integer({ min: 1, max: 1500 }),
  }),
  { minLength: 1, maxLength: 8 },
);

describe('deriveCanonical — Property 20: The daily bound holds', () => {
  it('canonical minutes is never more than 1440 for any set of contributions', () => {
    // Feature: payroll-attendance-source-rules, Property 20: The daily bound holds
    fc.assert(
      fc.property(fc.array(contributionArb, { maxLength: 10 }), (contributions) => {
        const result = deriveCanonical(contributions);
        if (result.minutes !== null) {
          expect(result.minutes).toBeLessThanOrEqual(1440);
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
    // would be comparing two unrelated random quantities (design.md Risk #5: Net_Login is a
    // bucket sum, not a span). The real invariant for interval_union is the standard
    // union-of-intervals inequality: union length is always >= the longest member interval and
    // always <= the sum of member interval lengths. For max_contribution, magnitudeMinutes IS
    // the basis the rule uses, so the bound is stated over magnitudes there.
    fc.assert(
      fc.property(fc.array(contributionArb, { minLength: 1, maxLength: 8 }), (contributions) => {
        const result = deriveCanonical(contributions);
        if (result.minutes === null) return; // all-excluded case, nothing to bound

        if (result.rule === 'max_contribution') {
          const magnitudes = contributions.map((c) => c.magnitudeMinutes);
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
});

describe('deriveCanonical — absent is never zero (criterion 18.10)', () => {
  it('an empty contribution list returns minutes: null, not 0', () => {
    const result = deriveCanonical([]);
    expect(result.minutes).toBeNull();
    expect(result.rule).toBeNull();
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
  });

  it('one interval-less contribution demotes the WHOLE employee-date to max_contribution, even with other usable intervals present', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 480 }, magnitudeMinutes: 480 },
      { diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 500 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(500); // max(480, 500), NOT the 480-minute interval union
  });

  it('a zero-length interval (Logout_Time equals Login_Time) is unusable and demotes to max_contribution', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 100, endMinute: 100 }, magnitudeMinutes: 0 },
      { diallerSourceId: 'src-b', interval: { startMinute: 0, endMinute: 60 }, magnitudeMinutes: 60 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(60);
  });

  it('a set of contributions summing past 1440 minutes clamps to 1440 (the impossible-day case E11 measured)', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 800 }, magnitudeMinutes: 800 },
      { diallerSourceId: 'src-b', interval: { startMinute: 700, endMinute: 1600 }, magnitudeMinutes: 900 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.minutes).toBeLessThanOrEqual(1440);
  });
});
