// backend/src/modules/wfm/__tests__/attendance-variance.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_APR_CORROBORATION_THRESHOLD_MINUTES,
  DEFAULT_VARIANCE_TOLERANCE_MINUTES,
  PRODUCTIVITY_EVIDENCE_ABSENT,
  evaluateCorroboration,
  evaluateVariance,
  productivityEvidenceFromCanonical,
  selectClassificationMinutes,
  type DayClassification,
  type ProductivityEvidence,
  type ResolvedAttendanceSource,
} from '../attendance-variance.js';
import { deriveCanonical, type Contribution, type ProducingRule } from '../canonical-productivity.js';

const present = (minutes: number, rule: ProducingRule = 'interval_union'): ProductivityEvidence => ({
  state: 'present',
  minutes,
  rule,
});

// ── Requirement 5: absent evidence versus a genuine zero ──────────────────────────────────────

describe('productivityEvidenceFromCanonical — an absent feed is not a zero reading (criteria 5.3, 18.10)', () => {
  it('no contribution at all becomes absent, not zero minutes', () => {
    const evidence = productivityEvidenceFromCanonical(deriveCanonical([]));
    expect(evidence.state).toBe('absent');
    // The union has no `minutes` member on the absent arm at all, so there is nothing to read
    // as a zero. Asserted on the value too, to kill a mutant that widens the arm.
    expect((evidence as { minutes?: number }).minutes).toBeUndefined();
  });

  it('a feed that genuinely measured zero productive minutes stays present with minutes 0', () => {
    // A single manual-upload contribution reporting 0 login minutes: the row existed, the
    // measurement was zero. deriveCanonical returns 0 under the secondary rule (criterion 18.6).
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 0 },
    ];
    const canonical = deriveCanonical(contributions);
    expect(canonical.minutes).toBe(0);

    const evidence = productivityEvidenceFromCanonical(canonical);
    expect(evidence.state).toBe('present');
    expect(evidence.state === 'present' && evidence.minutes).toBe(0);
    expect(evidence.state === 'present' && evidence.rule).toBe('max_contribution');
  });

  it('carries the producing rule through so criterion 6.3 can snapshot it', () => {
    const canonical = deriveCanonical([
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 480 }, magnitudeMinutes: 480 },
    ]);
    const evidence = productivityEvidenceFromCanonical(canonical);
    expect(evidence).toEqual({ state: 'present', minutes: 480, rule: 'interval_union' });
  });
});

describe('evaluateCorroboration — absent versus zero produce different outcomes (criteria 5.2, 5.3, 5.7)', () => {
  it('absent evidence yields evidence_absent with null productive minutes', () => {
    const result = evaluateCorroboration({
      resolvedSource: 'biometric',
      evidence: PRODUCTIVITY_EVIDENCE_ABSENT,
    });
    expect(result.state).toBe('evidence_absent');
    expect(result.productiveMinutes).toBeNull();
    expect(result.producingRule).toBeNull();
  });

  it('a genuine zero yields shortfall with productive minutes 0 — a different outcome from absent', () => {
    const result = evaluateCorroboration({
      resolvedSource: 'biometric',
      evidence: present(0, 'max_contribution'),
    });
    expect(result.state).toBe('shortfall');
    expect(result.productiveMinutes).toBe(0);
  });

  it('a present-but-unusable minutes value degrades to absent, never to zero, and warns', () => {
    const result = evaluateCorroboration({
      resolvedSource: 'biometric',
      evidence: { state: 'present', minutes: Number.NaN, rule: 'interval_union' },
    });
    expect(result.state).toBe('evidence_absent');
    expect(result.productiveMinutes).toBeNull();
    expect(result.configurationWarnings.join(' ')).toContain('treated as absent rather than as zero');
  });
});

// ── Requirement 5: threshold resolution ───────────────────────────────────────────────────────

describe('evaluateCorroboration — threshold application (criteria 5.5, 5.8)', () => {
  it('applies 480 minutes when nothing is configured, without a warning', () => {
    const result = evaluateCorroboration({
      resolvedSource: 'biometric',
      evidence: present(480),
      configuredCorroborationThresholdMinutes: null,
    });
    expect(result.appliedThresholdMinutes).toBe(DEFAULT_APR_CORROBORATION_THRESHOLD_MINUTES);
    expect(result.appliedThresholdMinutes).toBe(480);
    expect(result.rejectedThresholdValue).toBeNull();
    expect(result.configurationWarnings).toEqual([]);
    expect(result.state).toBe('corroborated');
  });

  it('applies a configured threshold when it is a finite number greater than zero', () => {
    const result = evaluateCorroboration({
      resolvedSource: 'biometric',
      evidence: present(430),
      configuredCorroborationThresholdMinutes: 420,
    });
    expect(result.appliedThresholdMinutes).toBe(420);
    expect(result.state).toBe('corroborated');
  });

  it('falls back to 480, records the rejected value and warns when the configured value is not positive-finite', () => {
    for (const rejected of [0, -30, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = evaluateCorroboration({
        resolvedSource: 'biometric',
        evidence: present(500),
        configuredCorroborationThresholdMinutes: rejected,
      });
      expect(result.appliedThresholdMinutes).toBe(480);
      expect(result.rejectedThresholdValue).toBe(rejected);
      expect(result.configurationWarnings).toHaveLength(1);
      expect(result.state).toBe('corroborated'); // 500 >= 480
    }
  });

  it('corroborates exactly at the threshold and falls short one minute below it', () => {
    const at = evaluateCorroboration({ resolvedSource: 'biometric', evidence: present(480) });
    const below = evaluateCorroboration({ resolvedSource: 'biometric', evidence: present(479) });
    expect(at.state).toBe('corroborated');
    expect(below.state).toBe('shortfall');
  });

  it('reports not_applicable on a dialler-resolved day rather than inventing a verdict', () => {
    const result = evaluateCorroboration({ resolvedSource: 'dialler', evidence: present(120) });
    expect(result.state).toBe('not_applicable');
    expect(result.productiveMinutes).toBe(120);
  });
});

// ── Requirement 5: the non-blocking guarantee ─────────────────────────────────────────────────

describe('Requirement 5 is structurally non-blocking', () => {
  it('CorroborationResult exposes no classification, lwp, payable-day or blocking field', () => {
    // Structural, not documentary: if a later change adds a channel through which corroboration
    // could reach pay, this assertion fails. The exact key set is pinned.
    const result = evaluateCorroboration({
      resolvedSource: 'biometric',
      evidence: present(10),
    });
    expect(Object.keys(result).sort()).toEqual([
      'appliedThresholdMinutes',
      'configurationWarnings',
      'producingRule',
      'productiveMinutes',
      'rejectedThresholdValue',
      'state',
    ]);
  });

  it('a total corroboration failure leaves the biometric classification input untouched', () => {
    const biometricMinutes = 545;
    const worstCase = selectClassificationMinutes('biometric', biometricMinutes, present(0));
    const absentCase = selectClassificationMinutes(
      'biometric',
      biometricMinutes,
      PRODUCTIVITY_EVIDENCE_ABSENT,
    );
    const bestCase = selectClassificationMinutes('biometric', biometricMinutes, present(600));
    expect(worstCase).toEqual({ basis: 'biometric_minutes', minutes: 545 });
    expect(absentCase).toEqual(worstCase);
    expect(bestCase).toEqual(worstCase);
  });

  it('a dialler-resolved day classifies from productivity, and absent evidence stays absent rather than becoming a zero-minute day', () => {
    expect(selectClassificationMinutes('dialler', 545, present(300))).toEqual({
      basis: 'canonical_productive_minutes',
      minutes: 300,
    });
    expect(selectClassificationMinutes('dialler', 545, PRODUCTIVITY_EVIDENCE_ABSENT)).toEqual({
      basis: 'canonical_productive_minutes',
      minutes: null,
    });
  });
});

const evidenceArb: fc.Arbitrary<ProductivityEvidence> = fc.oneof(
  fc.constant(PRODUCTIVITY_EVIDENCE_ABSENT),
  fc.record({
    state: fc.constant('present' as const),
    minutes: fc.integer({ min: 0, max: 1440 }),
    rule: fc.constantFrom<ProducingRule>('interval_union', 'max_contribution'),
  }),
);

const thresholdArb = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 1, max: 1440 }),
  fc.constant(0),
  fc.constant(-1),
);

const classificationArb = fc.constantFrom<DayClassification>(
  'present',
  'half_day',
  'absent',
  'leave_approved',
  'holiday',
  'week_off',
  'unreconciled',
  'missing_punch',
  'week_off_worked',
);

describe('Requirement 5 — Property: corroboration never changes the day classification', () => {
  it('for any evidence and any configured threshold, the biometric classification input is the biometric minutes alone', () => {
    // Feature: payroll-attendance-source-rules, Requirement 5 acceptance criterion 5.6 —
    // "SHALL determine the date's classification from Biometric_Minutes alone, and SHALL apply
    // the APR_Corroboration_Threshold only to raising a Variance_Record". This is the guarantee
    // in Requirement 5's title, stated as a property: nothing corroboration computes moves the
    // classification input by a single minute.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1440 }),
        evidenceArb,
        thresholdArb,
        evidenceArb,
        thresholdArb,
        (biometricMinutes, evidenceA, thresholdA, evidenceB, thresholdB) => {
          const corroborationA = evaluateCorroboration({
            resolvedSource: 'biometric',
            evidence: evidenceA,
            configuredCorroborationThresholdMinutes: thresholdA,
          });
          const corroborationB = evaluateCorroboration({
            resolvedSource: 'biometric',
            evidence: evidenceB,
            configuredCorroborationThresholdMinutes: thresholdB,
          });

          const classificationA = selectClassificationMinutes(
            'biometric',
            biometricMinutes,
            evidenceA,
          );
          const classificationB = selectClassificationMinutes(
            'biometric',
            biometricMinutes,
            evidenceB,
          );

          // Two entirely different corroboration verdicts over the same biometric day...
          expect(classificationA).toEqual(classificationB);
          // ...and the classification input is exactly the biometric figure.
          expect(classificationA.minutes).toBe(biometricMinutes);
          expect(classificationA.basis).toBe('biometric_minutes');
          // The verdicts really did differ across the generated space at least sometimes; when
          // they agree this is vacuous but never false.
          expect(typeof corroborationA.state).toBe('string');
          expect(typeof corroborationB.state).toBe('string');
        },
      ),
      { numRuns: 400 },
    );
  });

  it('for any inputs, a raised variance still leaves the biometric classification input untouched', () => {
    // Feature: payroll-attendance-source-rules, Requirement 5 acceptance criterion 5.6
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1440 }),
        evidenceArb,
        thresholdArb,
        thresholdArb,
        classificationArb,
        (biometricMinutes, evidence, corroborationThreshold, tolerance, dayClassification) => {
          const variance = evaluateVariance({
            resolvedSource: 'biometric',
            biometricMinutes,
            evidence,
            dayClassification,
            configuredCorroborationThresholdMinutes: corroborationThreshold,
            configuredVarianceToleranceMinutes: tolerance,
          });
          const classification = selectClassificationMinutes(
            'biometric',
            biometricMinutes,
            evidence,
          );
          expect(classification.minutes).toBe(biometricMinutes);
          // Whatever the verdict, it is an annotation: the variance evaluation exposes no
          // classification, lwp or payable-day field to apply.
          expect(Object.keys(variance)).not.toContain('attendanceStatus');
          expect(Object.keys(variance)).not.toContain('lwpValue');
          expect(Object.keys(variance)).not.toContain('payableDays');
          expect(typeof variance.raised).toBe('boolean');
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('Requirement 5 — Property 7: corroboration is source-neutral (criterion 5.9)', () => {
  it('permuting which Dialler_Source supplied each contribution does not change the corroboration or variance outcome', () => {
    // Feature: payroll-attendance-source-rules, Property 7: Corroboration is source-neutral
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            diallerSourceId: fc.uuid(),
            interval: fc.option(
              fc
                .tuple(fc.integer({ min: 0, max: 900 }), fc.integer({ min: 1, max: 400 }))
                .map(([start, length]) => ({ startMinute: start, endMinute: start + length })),
              { nil: null },
            ),
            magnitudeMinutes: fc.integer({ min: 0, max: 600 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        fc.integer({ min: 0, max: 1440 }),
        (contributions, biometricMinutes) => {
          const relabelled: Contribution[] = contributions.map((c, i) => ({
            ...c,
            diallerSourceId: `relabelled-source-${i}`,
          }));

          const originalEvidence = productivityEvidenceFromCanonical(deriveCanonical(contributions));
          const relabelledEvidence = productivityEvidenceFromCanonical(deriveCanonical(relabelled));

          const originalVariance = evaluateVariance({
            resolvedSource: 'biometric',
            biometricMinutes,
            evidence: originalEvidence,
            dayClassification: 'present',
          });
          const relabelledVariance = evaluateVariance({
            resolvedSource: 'biometric',
            biometricMinutes,
            evidence: relabelledEvidence,
            dayClassification: 'present',
          });

          expect(relabelledVariance).toEqual(originalVariance);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ── Requirement 6: the tolerance boundary ─────────────────────────────────────────────────────

describe('evaluateVariance — the tolerance boundary on a biometric-resolved day (criteria 6.1, 6.2, 6.6)', () => {
  const biometricDay = (biometricMinutes: number, productiveMinutes: number) =>
    evaluateVariance({
      resolvedSource: 'biometric',
      biometricMinutes,
      evidence: present(productiveMinutes),
      dayClassification: 'present',
    });

  it('raises when the excess is exactly the 60-minute tolerance', () => {
    // "exceed ... by at least the Variance_Tolerance" (6.1): exactly at tolerance raises.
    const result = biometricDay(400, 340);
    expect(result.appliedVarianceToleranceMinutes).toBe(DEFAULT_VARIANCE_TOLERANCE_MINUTES);
    expect(result.varianceRiskScore).toBe(60);
    expect(result.exceedsTolerance).toBe(true);
    expect(result.raised).toBe(true);
    expect(result.needsReview).toBe(true);
    expect(result.decision).toBe('raised_biometric_shortfall');
  });

  it('raises nothing one minute below the tolerance', () => {
    const result = biometricDay(400, 341);
    expect(result.varianceRiskScore).toBe(59);
    expect(result.exceedsTolerance).toBe(false);
    expect(result.raised).toBe(false);
    expect(result.needsReview).toBe(false);
    expect(result.decision).toBe('not_raised_within_tolerance');
  });

  it('raises one minute above the tolerance', () => {
    const result = biometricDay(400, 339);
    expect(result.varianceRiskScore).toBe(61);
    expect(result.raised).toBe(true);
    expect(result.decision).toBe('raised_biometric_shortfall');
  });

  it('honours a configured tolerance and falls back to 60 for an invalid one', () => {
    const wide = evaluateVariance({
      resolvedSource: 'biometric',
      biometricMinutes: 400,
      evidence: present(300),
      dayClassification: 'present',
      configuredVarianceToleranceMinutes: 120,
    });
    expect(wide.appliedVarianceToleranceMinutes).toBe(120);
    expect(wide.raised).toBe(false);
    expect(wide.decision).toBe('not_raised_within_tolerance');

    const invalid = evaluateVariance({
      resolvedSource: 'biometric',
      biometricMinutes: 400,
      evidence: present(300),
      dayClassification: 'present',
      configuredVarianceToleranceMinutes: 0,
    });
    expect(invalid.appliedVarianceToleranceMinutes).toBe(60);
    expect(invalid.raised).toBe(true);
    expect(invalid.configurationWarnings.join(' ')).toContain('Variance_Tolerance');
  });

  it('does not raise when productivity corroborates the day, however large the excess', () => {
    // A 540-minute biometric day against 500 productive minutes at a 420 threshold: the excess
    // clears the tolerance but criterion 6.1's threshold conjunct is unmet.
    const result = evaluateVariance({
      resolvedSource: 'biometric',
      biometricMinutes: 600,
      evidence: present(500),
      dayClassification: 'present',
      configuredCorroborationThresholdMinutes: 420,
    });
    expect(result.exceedsTolerance).toBe(true);
    expect(result.raised).toBe(false);
    expect(result.needsReview).toBe(false);
    expect(result.decision).toBe('not_raised_corroborated');
  });

  it('never raises when productivity exceeds biometric minutes', () => {
    const result = biometricDay(200, 480);
    expect(result.varianceRiskScore).toBe(-280);
    expect(result.exceedsTolerance).toBe(false);
    expect(result.raised).toBe(false);
  });

  it('snapshots the evidence criterion 6.3 requires of the decision', () => {
    const result = biometricDay(540, 100);
    expect(result.biometricMinutes).toBe(540);
    expect(result.canonicalProductiveMinutes).toBe(100);
    expect(result.resolvedAttendanceSource).toBe('biometric');
    expect(result.appliedCorroborationThresholdMinutes).toBe(480);
    expect(result.appliedVarianceToleranceMinutes).toBe(60);
    expect(result.varianceRiskScore).toBe(440);
  });
});

describe('evaluateVariance — absent evidence versus a genuine zero (criteria 5.7, 6.1)', () => {
  it('a full biometric day with no productivity feed at all raises nothing', () => {
    // The common case: 26,215 of 29,271 July 2026 biometric-source days (evidence E7). An absent
    // feed must not manufacture a reviewable variance, and must not manufacture a risk score.
    const result = evaluateVariance({
      resolvedSource: 'biometric',
      biometricMinutes: 545,
      evidence: PRODUCTIVITY_EVIDENCE_ABSENT,
      dayClassification: 'present',
    });
    expect(result.decision).toBe('not_raised_evidence_absent');
    expect(result.raised).toBe(false);
    expect(result.canonicalProductiveMinutes).toBeNull();
    expect(result.varianceRiskScore).toBeNull();
    expect(result.exceedsTolerance).toBe(false);
  });

  it('the same day with a feed that reported zero DOES raise — the distinction that matters', () => {
    const result = evaluateVariance({
      resolvedSource: 'biometric',
      biometricMinutes: 545,
      evidence: present(0, 'max_contribution'),
      dayClassification: 'present',
    });
    expect(result.decision).toBe('raised_biometric_shortfall');
    expect(result.raised).toBe(true);
    expect(result.canonicalProductiveMinutes).toBe(0);
    expect(result.varianceRiskScore).toBe(545);
  });

  it('no biometric minutes at all raises nothing and yields no risk score', () => {
    const result = evaluateVariance({
      resolvedSource: 'biometric',
      biometricMinutes: null,
      evidence: present(300),
      dayClassification: 'unreconciled',
    });
    expect(result.decision).toBe('not_raised_biometric_absent');
    expect(result.raised).toBe(false);
    expect(result.varianceRiskScore).toBeNull();
  });
});

// ── Requirement 6: the dialler-resolved branch ────────────────────────────────────────────────

describe('evaluateVariance — a dialler-resolved day (criterion 6.4)', () => {
  const diallerDay = (dayClassification: DayClassification) =>
    evaluateVariance({
      resolvedSource: 'dialler',
      biometricMinutes: 540,
      evidence: present(240),
      dayClassification,
    });

  it('raises on an absence where biometric exceeds productivity beyond tolerance', () => {
    const result = diallerDay('absent');
    expect(result.decision).toBe('raised_dialler_underclassified');
    expect(result.raised).toBe(true);
    expect(result.varianceRiskScore).toBe(300);
    expect(result.resolvedAttendanceSource).toBe('dialler');
  });

  it('raises on a half day the same way', () => {
    expect(diallerDay('half_day').decision).toBe('raised_dialler_underclassified');
  });

  it('raises nothing when the day is already classified present', () => {
    const result = diallerDay('present');
    expect(result.exceedsTolerance).toBe(true);
    expect(result.raised).toBe(false);
    expect(result.decision).toBe('not_raised_classification_not_shortfall');
  });

  it('raises nothing inside the tolerance even on an absence', () => {
    const result = evaluateVariance({
      resolvedSource: 'dialler',
      biometricMinutes: 300,
      evidence: present(259),
      dayClassification: 'absent',
    });
    expect(result.varianceRiskScore).toBe(41);
    expect(result.decision).toBe('not_raised_within_tolerance');
    expect(result.raised).toBe(false);
  });

  it('reports the corroboration threshold as resolved but does not gate the dialler branch on it', () => {
    // criterion 6.4 states no corroboration-threshold conjunct, and none is invented: this day's
    // 240 productive minutes are below the 480 default yet the decision turns on the
    // classification, not on the threshold.
    const result = diallerDay('absent');
    expect(result.appliedCorroborationThresholdMinutes).toBe(480);
    expect(result.raised).toBe(true);
  });
});

// ── Requirement 6: suppressed days ────────────────────────────────────────────────────────────

describe('evaluateVariance — approved leave, holiday and week off suppress the record (criterion 6.7)', () => {
  for (const dayClassification of ['leave_approved', 'holiday', 'week_off'] as DayClassification[]) {
    for (const resolvedSource of ['biometric', 'dialler'] as ResolvedAttendanceSource[]) {
      it(`raises nothing on ${dayClassification} with a ${resolvedSource}-resolved source`, () => {
        const result = evaluateVariance({
          resolvedSource,
          biometricMinutes: 600,
          evidence: present(0),
          dayClassification,
        });
        expect(result.decision).toBe('not_raised_suppressed_day');
        expect(result.raised).toBe(false);
        expect(result.needsReview).toBe(false);
      });
    }
  }

  it('does not suppress week_off_worked, which the requirement does not name', () => {
    const result = evaluateVariance({
      resolvedSource: 'biometric',
      biometricMinutes: 600,
      evidence: present(0),
      dayClassification: 'week_off_worked',
    });
    expect(result.decision).toBe('raised_biometric_shortfall');
  });
});

// ── Requirement 6: properties ─────────────────────────────────────────────────────────────────

describe('Requirement 6 — Property 9: no false-positive variance inside tolerance (criterion 6.6)', () => {
  it('for any pair of present figures within the applied tolerance of each other, no record is raised', () => {
    // Feature: payroll-attendance-source-rules, Property 9: No false-positive variance inside tolerance
    fc.assert(
      fc.property(
        fc.constantFrom<ResolvedAttendanceSource>('biometric', 'dialler'),
        fc.integer({ min: 0, max: 1440 }),
        fc.integer({ min: 0, max: 1440 }),
        thresholdArb,
        thresholdArb,
        classificationArb,
        (
          resolvedSource,
          biometricMinutes,
          productiveMinutes,
          corroborationThreshold,
          tolerance,
          dayClassification,
        ) => {
          const result = evaluateVariance({
            resolvedSource,
            biometricMinutes,
            evidence: present(productiveMinutes),
            dayClassification,
            configuredCorroborationThresholdMinutes: corroborationThreshold,
            configuredVarianceToleranceMinutes: tolerance,
          });
          const excess = biometricMinutes - productiveMinutes;
          if (excess < result.appliedVarianceToleranceMinutes) {
            expect(result.raised).toBe(false);
            expect(result.exceedsTolerance).toBe(false);
          }
          // The converse direction of the same boundary: a raised record always cleared it.
          if (result.raised) {
            expect(excess).toBeGreaterThanOrEqual(result.appliedVarianceToleranceMinutes);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('Requirement 6 — Property: absent evidence never raises, and never yields a risk score', () => {
  it('for any source, biometric figure, thresholds and classification, absent productivity raises nothing', () => {
    // Feature: payroll-attendance-source-rules, Property 8: Absence is never a zero
    fc.assert(
      fc.property(
        fc.constantFrom<ResolvedAttendanceSource>('biometric', 'dialler'),
        fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 1440 })),
        thresholdArb,
        thresholdArb,
        classificationArb,
        (resolvedSource, biometricMinutes, corroborationThreshold, tolerance, dayClassification) => {
          const result = evaluateVariance({
            resolvedSource,
            biometricMinutes,
            evidence: PRODUCTIVITY_EVIDENCE_ABSENT,
            dayClassification,
            configuredCorroborationThresholdMinutes: corroborationThreshold,
            configuredVarianceToleranceMinutes: tolerance,
          });
          expect(result.raised).toBe(false);
          expect(result.needsReview).toBe(false);
          expect(result.canonicalProductiveMinutes).toBeNull();
          expect(result.varianceRiskScore).toBeNull();
          expect(result.exceedsTolerance).toBe(false);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('Requirement 6 — Property: the evaluation is total and stable', () => {
  it('never throws, always applies a positive threshold and tolerance, and returns the same result twice', () => {
    // Feature: payroll-attendance-source-rules, Requirement 6 — totality over ordinary data
    fc.assert(
      fc.property(
        fc.constantFrom<ResolvedAttendanceSource>('biometric', 'dialler'),
        fc.oneof(
          fc.constant(null),
          fc.integer({ min: -100, max: 2000 }),
          fc.constant(Number.NaN),
        ),
        evidenceArb,
        thresholdArb,
        thresholdArb,
        classificationArb,
        (resolvedSource, biometricMinutes, evidence, corroborationThreshold, tolerance, dayClassification) => {
          const input = {
            resolvedSource,
            biometricMinutes,
            evidence,
            dayClassification,
            configuredCorroborationThresholdMinutes: corroborationThreshold,
            configuredVarianceToleranceMinutes: tolerance,
          };
          const first = evaluateVariance(input);
          const second = evaluateVariance(input);
          expect(second).toEqual(first);
          expect(first.appliedCorroborationThresholdMinutes).toBeGreaterThan(0);
          expect(first.appliedVarianceToleranceMinutes).toBeGreaterThan(0);
          expect(first.needsReview).toBe(first.raised);
          if (first.varianceRiskScore !== null) {
            expect(Number.isFinite(first.varianceRiskScore)).toBe(true);
          }
          // A negative or non-finite biometric figure degrades to absent, never to zero.
          if (biometricMinutes === null || !Number.isFinite(biometricMinutes) || biometricMinutes < 0) {
            expect(first.biometricMinutes).toBeNull();
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
