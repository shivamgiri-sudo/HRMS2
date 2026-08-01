/**
 * Scoring for a manually captured QA audit.
 *
 * Pure and separate from persistence so the rules below can be tested without a
 * database, and so a dispute can be re-scored from stored parameter rows without
 * re-running any of the capture path.
 *
 * Three rules carry the weight here:
 *
 *  1. A not-applicable parameter leaves BOTH the numerator and the denominator.
 *     Treating it as zero is how an unassessed parameter starts looking like a
 *     failed one — the same mistake the upstream feed made by counting 1,383
 *     unscored audits in a fatal-rate denominator and reporting 0% for work
 *     nobody had reviewed.
 *
 *  2. A fatal parameter scored zero zeroes the whole audit. That is the point of
 *     marking it fatal; averaging it away would let a call that breached
 *     compliance still pass.
 *
 *  3. An audit with nothing applicable has no percentage at all, not 0% and not
 *     100%. Absent is honest; either number is a claim.
 */

export type QaFormParameter = {
  id: string;
  maxScore: number;
  isFatal: boolean;
};

export type QaParameterScore = {
  formParameterId: string;
  /** null when not scored; pair with notApplicable to say why. */
  score: number | null;
  notApplicable: boolean;
};

export type QaAuditScore = {
  totalScore: number;
  maxScore: number;
  /** null when no parameter applied to this call. */
  qualityPercentage: number | null;
  fatalTriggered: boolean;
  /** Parameters counted, for showing "12 of 18 assessed" rather than hiding it. */
  assessedCount: number;
  notApplicableCount: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function scoreQaAudit(
  parameters: QaFormParameter[],
  scores: QaParameterScore[],
): QaAuditScore {
  const byId = new Map(scores.map((s) => [s.formParameterId, s]));

  let totalScore = 0;
  let maxScore = 0;
  let assessedCount = 0;
  let notApplicableCount = 0;
  let fatalTriggered = false;

  for (const parameter of parameters) {
    const scored = byId.get(parameter.id);

    // Unscored and explicitly not-applicable are treated alike: neither can be
    // assessed, so neither belongs in the denominator.
    if (!scored || scored.notApplicable || scored.score === null) {
      notApplicableCount += 1;
      continue;
    }

    assessedCount += 1;
    totalScore += scored.score;
    maxScore += parameter.maxScore;

    // Zero on a fatal parameter fails the call outright.
    if (parameter.isFatal && scored.score <= 0) fatalTriggered = true;
  }

  if (assessedCount === 0) {
    return {
      totalScore: 0,
      maxScore: 0,
      qualityPercentage: null,
      fatalTriggered: false,
      assessedCount: 0,
      notApplicableCount,
    };
  }

  const percentage = fatalTriggered
    ? 0
    : maxScore > 0
      ? round2((totalScore / maxScore) * 100)
      : null;

  return {
    totalScore: round2(totalScore),
    maxScore: round2(maxScore),
    qualityPercentage: percentage,
    fatalTriggered,
    assessedCount,
    notApplicableCount,
  };
}
