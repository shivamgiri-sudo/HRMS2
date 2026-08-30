// backend/src/modules/wfm/__tests__/payable-days.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  classifyMinutes,
  classifyPayableDay,
  classificationRank,
  ENGINE_BIOMETRIC_FULL_DAY_MINUTES,
  ENGINE_DIALLER_FULL_DAY_MINUTES,
  ENGINE_DEFAULT_HALF_DAY_FLOOR_MINUTES,
  type PayableDayInput,
  type ResolvedDayThresholds,
} from '../payable-days.js';

// The two threshold sets production applies today, restated as fixtures so the boundary tests
// below are testing the numbers that actually decide pay rather than invented ones.
const BIOMETRIC_THRESHOLDS: ResolvedDayThresholds = {
  fullDayMinutes: ENGINE_BIOMETRIC_FULL_DAY_MINUTES, // 540
  halfDayMinutes: ENGINE_DEFAULT_HALF_DAY_FLOOR_MINUTES, // 240
  graceMinutes: 15,
  decidingRuleId: 'dtr-default',
};

const DIALLER_THRESHOLDS: ResolvedDayThresholds = {
  fullDayMinutes: ENGINE_DIALLER_FULL_DAY_MINUTES, // 480
  halfDayMinutes: ENGINE_DEFAULT_HALF_DAY_FLOOR_MINUTES, // 240
  graceMinutes: 15,
  decidingRuleId: 'dtr-default',
};

function biometricDay(overrides: Partial<PayableDayInput> = {}): PayableDayInput {
  return {
    resolvedSource: 'biometric',
    sourceRuleId: 'asr-default',
    thresholds: BIOMETRIC_THRESHOLDS,
    biometricMinutes: 0,
    canonicalProductiveMinutes: null,
    ...overrides,
  };
}

function diallerDay(overrides: Partial<PayableDayInput> = {}): PayableDayInput {
  return {
    resolvedSource: 'dialler',
    sourceRuleId: 'asr-ops-exec',
    thresholds: DIALLER_THRESHOLDS,
    biometricMinutes: null,
    canonicalProductiveMinutes: null,
    diallerRecordInPrecedingWindow: true,
    ...overrides,
  };
}

describe('classifyMinutes — threshold boundaries are inclusive (at or above)', () => {
  // Evidence for the convention, attendance-engine.service.ts:
  //   classifyCosecMinutes():       `if (biometricMinutes >= 540)`  / `>= halfDayFloor`
  //   classifyOperationsNetLogin(): `if (netLoginMinutes >= 480)`   / `>= halfDayFloor`
  // plus resolveHalfDayFloorMinutes()'s doc comment: "A floor qualifies: a day reaching exactly
  // this many minutes earns the half day."
  it('one minute below the biometric full day is a half day, exactly at it is present, one above is present', () => {
    expect(classifyMinutes(539, BIOMETRIC_THRESHOLDS).classification).toBe('half_day');
    expect(classifyMinutes(540, BIOMETRIC_THRESHOLDS).classification).toBe('present');
    expect(classifyMinutes(541, BIOMETRIC_THRESHOLDS).classification).toBe('present');
  });

  it('one minute below the dialler full day is a half day, exactly 480 is present, one above is present', () => {
    expect(classifyMinutes(479, DIALLER_THRESHOLDS).classification).toBe('half_day');
    expect(classifyMinutes(480, DIALLER_THRESHOLDS).classification).toBe('present');
    expect(classifyMinutes(481, DIALLER_THRESHOLDS).classification).toBe('present');
  });

  it('one minute below the half day floor is an absence, exactly at it is a half day, one above is a half day', () => {
    expect(classifyMinutes(239, DIALLER_THRESHOLDS).classification).toBe('absent');
    expect(classifyMinutes(240, DIALLER_THRESHOLDS).classification).toBe('half_day');
    expect(classifyMinutes(241, DIALLER_THRESHOLDS).classification).toBe('half_day');
  });

  it('carries the LWP value the engine writes for each classification', () => {
    expect(classifyMinutes(540, BIOMETRIC_THRESHOLDS).lwpValue).toBe(0);
    expect(classifyMinutes(300, BIOMETRIC_THRESHOLDS).lwpValue).toBe(0.5);
    expect(classifyMinutes(10, BIOMETRIC_THRESHOLDS).lwpValue).toBe(1);
  });

  it('records which boundary decided the day', () => {
    expect(classifyMinutes(540, BIOMETRIC_THRESHOLDS).reason).toBe('at_or_above_full_day');
    expect(classifyMinutes(240, BIOMETRIC_THRESHOLDS).reason).toBe('at_or_above_half_day');
    expect(classifyMinutes(0, BIOMETRIC_THRESHOLDS).reason).toBe('below_half_day');
  });

  it('tests the full day first, so half_day_minutes above full_day_minutes still returns a defined result', () => {
    const inverted: ResolvedDayThresholds = { fullDayMinutes: 480, halfDayMinutes: 600, graceMinutes: 0 };
    expect(classifyMinutes(500, inverted).classification).toBe('present');
    expect(classifyMinutes(479, inverted).classification).toBe('absent');
  });
});

describe('classifyPayableDay — criteria 4.2 and 4.3: the resolved source picks the figure', () => {
  it('a biometric-resolved day is classified from Biometric_Minutes and ignores the dialler figure for classification (4.2)', () => {
    const result = classifyPayableDay(
      biometricDay({ biometricMinutes: 545, canonicalProductiveMinutes: 30 }),
    );
    expect(result.classification).toBe('present');
    expect(result.provenance.classifiedFromMinutes).toBe(545);
    expect(result.provenance.resolvedSource).toBe('biometric');
    // The other feed is still recorded, never discarded.
    expect(result.provenance.canonicalProductiveMinutes).toBe(30);
  });

  it('a dialler-resolved day is classified from Canonical_Productive_Minutes and ignores biometric for classification (4.3)', () => {
    const result = classifyPayableDay(
      diallerDay({ canonicalProductiveMinutes: 300, biometricMinutes: 600 }),
    );
    // 300 dialler minutes is a half day even though 600 biometric minutes would be a full one.
    expect(result.classification).toBe('half_day');
    expect(result.lwpValue).toBe(0.5);
    expect(result.provenance.classifiedFromMinutes).toBe(300);
    expect(result.provenance.biometricMinutes).toBe(600);
  });

  it('applies the resolved Day_Threshold_Rule values, not the duplicated engine constants (1.16)', () => {
    const custom: ResolvedDayThresholds = {
      fullDayMinutes: 400,
      halfDayMinutes: 200,
      graceMinutes: 5,
      decidingRuleId: 'dtr-branch-scoped',
    };
    const result = classifyPayableDay(biometricDay({ biometricMinutes: 400, thresholds: custom }));
    expect(result.classification).toBe('present');
    expect(result.provenance.appliedFullDayMinutes).toBe(400);
    expect(result.provenance.appliedHalfDayMinutes).toBe(200);
    expect(result.provenance.appliedGraceMinutes).toBe(5);
    expect(result.provenance.thresholdRuleId).toBe('dtr-branch-scoped');
    expect(result.provenance.thresholdComparison).toBe('at_or_above');
  });

  it('carries the deciding Attendance_Source_Rule id through to the provenance (2.1, 3.5)', () => {
    const result = classifyPayableDay(
      biometricDay({ biometricMinutes: 600, sourceRuleId: 'asr-cost-centre-7' }),
    );
    expect(result.provenance.sourceRuleId).toBe('asr-cost-centre-7');
  });

  it('reports a null source rule id rather than inventing one when none was supplied', () => {
    const input = biometricDay({ biometricMinutes: 600 });
    delete input.sourceRuleId;
    expect(classifyPayableDay(input).provenance.sourceRuleId).toBeNull();
  });
});

describe('classifyPayableDay — boundaries hold through the full entry point, both sources', () => {
  it('exactly 540 biometric minutes is a full paid day', () => {
    const at = classifyPayableDay(biometricDay({ biometricMinutes: 540 }));
    expect(at.classification).toBe('present');
    expect(at.payableDayValue).toBe(1);
    expect(at.lwpValue).toBe(0);
    expect(at.requiresReview).toBe(false);
  });

  it('539 biometric minutes is a half day', () => {
    const below = classifyPayableDay(biometricDay({ biometricMinutes: 539 }));
    expect(below.classification).toBe('half_day');
    expect(below.payableDayValue).toBe(0.5);
    expect(below.lwpValue).toBe(0.5);
  });

  it('exactly 480 dialler minutes is a full paid day', () => {
    const at = classifyPayableDay(diallerDay({ canonicalProductiveMinutes: 480 }));
    expect(at.classification).toBe('present');
    expect(at.payableDayValue).toBe(1);
  });

  it('239 dialler minutes is a proven absence with lwp 1.00 and zero payable', () => {
    const result = classifyPayableDay(diallerDay({ canonicalProductiveMinutes: 239 }));
    expect(result.classification).toBe('absent');
    expect(result.lwpValue).toBe(1);
    expect(result.payableDayValue).toBe(0);
    expect(result.requiresReview).toBe(false);
  });
});

describe('classifyPayableDay — criterion 4.6: resolved source silent while the other feed reported', () => {
  it('biometric resolved with no punches while the dialler feed reported minutes is unreconciled with no LWP', () => {
    const result = classifyPayableDay(
      biometricDay({ biometricMinutes: null, canonicalProductiveMinutes: 425 }),
    );
    expect(result.classification).toBe('unreconciled');
    expect(result.lwpValue).toBe(0);
    expect(result.payableDayValue).toBeNull();
    expect(result.requiresReview).toBe(true);
    expect(result.provenance.reason).toBe('resolved_source_silent_other_feed_reported');
    // Criterion 4.6 requires both feeds' minutes on the record.
    expect(result.provenance.biometricMinutes).toBeNull();
    expect(result.provenance.canonicalProductiveMinutes).toBe(425);
    expect(result.provenance.classifiedFromMinutes).toBeNull();
  });

  it('dialler resolved and absent while biometric reported minutes is unreconciled, not an absence', () => {
    const result = classifyPayableDay(
      diallerDay({ canonicalProductiveMinutes: null, biometricMinutes: 600 }),
    );
    expect(result.classification).toBe('unreconciled');
    expect(result.lwpValue).toBe(0);
    expect(result.requiresReview).toBe(true);
  });

  it('treats a stored zero from the resolved source as no minutes, not as a measured zero (defect E4)', () => {
    const result = classifyPayableDay(
      biometricDay({ biometricMinutes: 0, canonicalProductiveMinutes: 400 }),
    );
    expect(result.classification).toBe('unreconciled');
    expect(result.requiresReview).toBe(true);
  });

  it('does not fire when the other feed also reports zero — a zero is not a report', () => {
    const result = classifyPayableDay(
      biometricDay({ biometricMinutes: null, canonicalProductiveMinutes: 0 }),
    );
    expect(result.classification).not.toBe('unreconciled');
    expect(result.provenance.reason).toBe('no_evidence_from_either_feed');
  });
});

describe('classifyPayableDay — criterion 4.7: a dialler day with no recent coverage is review, not absence', () => {
  it('an employee no Dialler_Source has carried in the preceding window is not docked', () => {
    const result = classifyPayableDay(
      diallerDay({ canonicalProductiveMinutes: null, diallerRecordInPrecedingWindow: false }),
    );
    expect(result.classification).toBe('missing_punch');
    expect(result.lwpValue).toBe(0);
    expect(result.payableDayValue).toBeNull();
    expect(result.requiresReview).toBe(true);
    expect(result.provenance.reason).toBe('dialler_resolved_no_recent_coverage');
  });

  it('defaults to review when coverage is not stated at all, the conservative direction', () => {
    const input = diallerDay({ canonicalProductiveMinutes: null });
    delete input.diallerRecordInPrecedingWindow;
    const result = classifyPayableDay(input);
    expect(result.classification).toBe('missing_punch');
    expect(result.requiresReview).toBe(true);
  });

  it('an employee the feed does carry, with nothing reported for the date, is a proven absence (2026-08-07 ruling)', () => {
    const result = classifyPayableDay(
      diallerDay({ canonicalProductiveMinutes: null, diallerRecordInPrecedingWindow: true }),
    );
    expect(result.classification).toBe('absent');
    expect(result.lwpValue).toBe(1);
    expect(result.payableDayValue).toBe(0);
    expect(result.requiresReview).toBe(false);
    expect(result.provenance.classifiedFromMinutes).toBe(0);
  });

  it('does not read the coverage flag on a biometric-resolved day', () => {
    const covered = classifyPayableDay(
      biometricDay({ biometricMinutes: 600, diallerRecordInPrecedingWindow: true }),
    );
    const uncovered = classifyPayableDay(
      biometricDay({ biometricMinutes: 600, diallerRecordInPrecedingWindow: false }),
    );
    expect(covered.classification).toBe(uncovered.classification);
    expect(covered.lwpValue).toBe(uncovered.lwpValue);
  });
});

describe('classifyPayableDay — no evidence from either feed', () => {
  it('a biometric day with no punches anywhere is missing_punch pending review, never a silent absence', () => {
    const result = classifyPayableDay(
      biometricDay({ biometricMinutes: null, canonicalProductiveMinutes: null }),
    );
    expect(result.classification).toBe('missing_punch');
    expect(result.lwpValue).toBe(0);
    expect(result.payableDayValue).toBeNull();
    expect(result.requiresReview).toBe(true);
    expect(result.provenance.reason).toBe('no_evidence_from_either_feed');
  });

  it('zero biometric minutes with a silent dialler feed behaves the same as null', () => {
    const zero = classifyPayableDay(biometricDay({ biometricMinutes: 0 }));
    const nul = classifyPayableDay(biometricDay({ biometricMinutes: null }));
    expect(zero.classification).toBe(nul.classification);
    expect(zero.lwpValue).toBe(nul.lwpValue);
    expect(zero.provenance.reason).toBe(nul.provenance.reason);
  });
});

describe('classifyPayableDay — programmer errors throw, ordinary data never does', () => {
  it('rejects a negative threshold', () => {
    expect(() =>
      classifyPayableDay(
        biometricDay({
          biometricMinutes: 480,
          thresholds: { fullDayMinutes: -1, halfDayMinutes: 240, graceMinutes: 0 },
        }),
      ),
    ).toThrow(/fullDayMinutes/);
  });

  it('rejects a non-finite threshold rather than classifying every day as absent', () => {
    expect(() =>
      classifyPayableDay(
        biometricDay({
          biometricMinutes: 480,
          thresholds: { fullDayMinutes: 540, halfDayMinutes: Number.NaN, graceMinutes: 0 },
        }),
      ),
    ).toThrow(/halfDayMinutes/);
  });

  it('rejects a negative grace value', () => {
    expect(() =>
      classifyPayableDay(
        biometricDay({
          biometricMinutes: 480,
          thresholds: { fullDayMinutes: 540, halfDayMinutes: 240, graceMinutes: -5 },
        }),
      ),
    ).toThrow(/graceMinutes/);
  });

  it('rejects NaN minutes rather than recording a full day of LWP', () => {
    expect(() => classifyPayableDay(biometricDay({ biometricMinutes: Number.NaN }))).toThrow(
      /biometricMinutes/,
    );
    expect(() =>
      classifyPayableDay(diallerDay({ canonicalProductiveMinutes: Number.NEGATIVE_INFINITY })),
    ).toThrow(/canonicalProductiveMinutes/);
  });

  it('accepts zero thresholds — every day then reaches the full day', () => {
    const result = classifyPayableDay(
      biometricDay({
        biometricMinutes: 1,
        thresholds: { fullDayMinutes: 0, halfDayMinutes: 0, graceMinutes: 0 },
      }),
    );
    expect(result.classification).toBe('present');
  });
});

describe('classifyPayableDay — totality and purity', () => {
  const sourceArb = fc.constantFrom<'biometric' | 'dialler'>('biometric', 'dialler');
  const minutesArb = fc.option(fc.integer({ min: 0, max: 1440 }), { nil: null });
  const thresholdsArb: fc.Arbitrary<ResolvedDayThresholds> = fc.record({
    fullDayMinutes: fc.integer({ min: 0, max: 900 }),
    halfDayMinutes: fc.integer({ min: 0, max: 900 }),
    graceMinutes: fc.integer({ min: 0, max: 60 }),
  });

  const inputArb: fc.Arbitrary<PayableDayInput> = fc.record({
    resolvedSource: sourceArb,
    sourceRuleId: fc.option(fc.uuid(), { nil: null }),
    thresholds: thresholdsArb,
    biometricMinutes: minutesArb,
    canonicalProductiveMinutes: minutesArb,
    diallerRecordInPrecedingWindow: fc.boolean(),
  });

  it('returns a defined result for every combination of inputs, and never throws on ordinary data', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = classifyPayableDay(input);
        expect(result.classification).toBeTruthy();
        expect([0, 0.5, 1]).toContain(result.lwpValue);
        expect(result.provenance.resolvedSource).toBe(input.resolvedSource);
      }),
      { numRuns: 500 },
    );
  });

  it('keeps the per-day payable contribution within [0, 1] or explicitly undetermined (criterion 4.8)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const { payableDayValue, requiresReview, lwpValue } = classifyPayableDay(input);
        if (payableDayValue === null) {
          // Undetermined only ever coincides with a review state carrying no LWP (criterion 4.6).
          expect(requiresReview).toBe(true);
          expect(lwpValue).toBe(0);
        } else {
          expect(payableDayValue).toBeGreaterThanOrEqual(0);
          expect(payableDayValue).toBeLessThanOrEqual(1);
          expect(payableDayValue + lwpValue).toBe(1);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('is deterministic and does not mutate its input', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const snapshot = JSON.stringify(input);
        const first = classifyPayableDay(input);
        const second = classifyPayableDay(input);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
        expect(JSON.stringify(input)).toBe(snapshot);
      }),
      { numRuns: 300 },
    );
  });
});

describe('classifyPayableDay — monotonicity: more minutes never pays worse', () => {
  const orderedThresholdsArb: fc.Arbitrary<ResolvedDayThresholds> = fc
    .tuple(fc.integer({ min: 0, max: 900 }), fc.integer({ min: 0, max: 900 }))
    .map(([a, b]) => ({
      fullDayMinutes: Math.max(a, b),
      halfDayMinutes: Math.min(a, b),
      graceMinutes: 0,
    }));

  it('classification rank is non-decreasing in the resolved source minutes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'biometric' | 'dialler'>('biometric', 'dialler'),
        orderedThresholdsArb,
        fc.integer({ min: 1, max: 1440 }),
        fc.integer({ min: 1, max: 1440 }),
        (resolvedSource, thresholds, m1, m2) => {
          const lower = Math.min(m1, m2);
          const higher = Math.max(m1, m2);
          const build = (minutes: number): PayableDayInput => ({
            resolvedSource,
            sourceRuleId: 'asr-fixed',
            thresholds,
            biometricMinutes: resolvedSource === 'biometric' ? minutes : null,
            canonicalProductiveMinutes: resolvedSource === 'dialler' ? minutes : null,
            diallerRecordInPrecedingWindow: true,
          });

          const lowRank = classificationRank(classifyPayableDay(build(lower)).classification);
          const highRank = classificationRank(classifyPayableDay(build(higher)).classification);
          // Both are positive minute figures with the other feed silent, so neither can land on a
          // review state and both ranks are numbers.
          expect(lowRank).not.toBeNull();
          expect(highRank).not.toBeNull();
          expect(highRank as number).toBeGreaterThanOrEqual(lowRank as number);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('LWP is non-increasing in the resolved source minutes', () => {
    fc.assert(
      fc.property(
        orderedThresholdsArb,
        fc.integer({ min: 1, max: 1440 }),
        fc.integer({ min: 1, max: 1440 }),
        (thresholds, m1, m2) => {
          const lower = Math.min(m1, m2);
          const higher = Math.max(m1, m2);
          const lowLwp = classifyMinutes(lower, thresholds).lwpValue;
          const highLwp = classifyMinutes(higher, thresholds).lwpValue;
          expect(highLwp).toBeLessThanOrEqual(lowLwp);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('classificationRank', () => {
  it('orders absent below half_day below present and leaves review states unranked', () => {
    expect(classificationRank('absent')).toBe(0);
    expect(classificationRank('half_day')).toBe(1);
    expect(classificationRank('present')).toBe(2);
    expect(classificationRank('unreconciled')).toBeNull();
    expect(classificationRank('missing_punch')).toBeNull();
  });
});
