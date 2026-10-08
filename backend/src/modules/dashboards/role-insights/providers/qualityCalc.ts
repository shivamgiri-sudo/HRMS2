/** Pure calculations behind the Quality dashboard. */

/** An assessed call scoring below this is a failed audit (matches `calls_below_50` used across the quality module). */
export const FAIL_BELOW_PCT = 50;
/** An agent averaging below this over at least MIN_AUDITS audits is "below threshold" (the module's 'below_average' band is <70). */
export const AGENT_THRESHOLD_PCT = 70;
export const MIN_AUDITS_FOR_AGENT = 5;
/** Organisation quality target - same constant Operations Command judges quality against (QA_TARGET_PCT). */
export const QUALITY_TARGET_PCT = 85;

/** Every 1/0 evaluation column on db_audit.call_quality_assessment, with a readable label. */
export const QA_PARAMETERS: ReadonlyArray<{ col: string; label: string }> = [
  { col: "call_answered_within_5_seconds", label: "Call answered within 5 s" },
  { col: "customer_concern_acknowledged", label: "Customer concern acknowledged" },
  { col: "professionalism_maintained", label: "Professionalism maintained" },
  { col: "assurance_or_appreciation_provided", label: "Assurance / appreciation" },
  { col: "pronunciation_and_clarity", label: "Pronunciation & clarity" },
  { col: "enthusiasm_and_no_fumbling", label: "Enthusiasm, no fumbling" },
  { col: "active_listening", label: "Active listening" },
  { col: "politeness_and_no_sarcasm", label: "Politeness, no sarcasm" },
  { col: "proper_grammar", label: "Proper grammar" },
  { col: "accurate_issue_probing", label: "Accurate issue probing" },
  { col: "proper_hold_procedure", label: "Proper hold procedure" },
  { col: "proper_transfer_and_language", label: "Proper transfer & language" },
  { col: "dead_air_under_10_seconds", label: "Dead air under 10 s" },
  { col: "case_escalated_correctly", label: "Case escalated correctly" },
  { col: "address_recorded_completely", label: "Address recorded completely" },
  { col: "correct_and_complete_information", label: "Correct & complete information" },
  { col: "upselling_or_offers_suggested", label: "Upsell / offers suggested" },
  { col: "further_assistance_offered", label: "Further assistance offered" },
  { col: "proper_call_closure", label: "Proper call closure" },
  { col: "express_empathy", label: "Express empathy" },
];

/** SELECT fragment: failed and evaluated counts for every parameter (aliases f0/n0, f1/n1, ...). */
export function defectSelectSql(alias = "q"): string {
  return QA_PARAMETERS.map((p, i) => `SUM(CASE WHEN ${alias}.${p.col} = 0 THEN 1 ELSE 0 END) f${i}, COUNT(${alias}.${p.col}) n${i}`).join(", ");
}

export interface DefectRate { param: string; label: string; failRate: number; failed: number; evaluated: number }

/**
 * Fail rate per parameter = failed / EVALUATED x 100.
 *
 * The denominator is the calls where the parameter was actually scored. The previous formula,
 * `100 - AVG(COALESCE(col, 0)) x 100`, treated "not evaluated" (NULL) as a failure: for 'answered within
 * 5 seconds' 8,550 of 19,056 September rows were NULL and it reported 45.9% against a true 1.9%.
 * Parameters evaluated on fewer than `minSample` calls are dropped - a rate on a handful of calls is noise.
 */
export function defectRates(row: Record<string, unknown>, minSample = 30): DefectRate[] {
  const out: DefectRate[] = [];
  QA_PARAMETERS.forEach((p, i) => {
    const failed = Number(row[`f${i}`] ?? 0);
    const evaluated = Number(row[`n${i}`] ?? 0);
    if (!Number.isFinite(failed) || !Number.isFinite(evaluated) || evaluated < minSample) return;
    out.push({ param: p.col, label: p.label, failRate: Math.round((failed / evaluated) * 1000) / 10, failed, evaluated });
  });
  return out.sort((a, b) => b.failRate - a.failRate);
}

/** Audit coverage = calls that carry a quality score / calls analysed. null when there are no calls. */
export function coveragePct(scored: number | null, totalCalls: number | null): number | null {
  if (scored === null || totalCalls === null || totalCalls <= 0) return null;
  return Math.min(100, Math.round((scored / totalCalls) * 1000) / 10);
}

/** Calls analysed but not yet scored: total - audited, floored at 0 (never negative when the two sources disagree). */
export function pendingAudits(totalCalls: number | null, scored: number | null): number | null {
  if (totalCalls === null || scored === null) return null;
  return Math.max(totalCalls - scored, 0);
}

export function failRatePct(failed: number | null, scored: number | null): number | null {
  if (failed === null || scored === null || scored <= 0) return null;
  return Math.round((failed / scored) * 1000) / 10;
}

/** Quality health 0-100: score vs target, coverage, pass rate. null with fewer than two components. */
export function qualityHealth(input: { avgScore: number | null; coverage: number | null; failRate: number | null }): { score: number; basis: string } | null {
  const parts: Array<{ w: number; v: number; label: string }> = [];
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  if (input.avgScore !== null) parts.push({ w: 0.5, v: clamp((input.avgScore / QUALITY_TARGET_PCT) * 100), label: `score vs ${QUALITY_TARGET_PCT}% target 50%` });
  if (input.coverage !== null) parts.push({ w: 0.25, v: clamp(input.coverage), label: "audit coverage 25%" });
  if (input.failRate !== null) parts.push({ w: 0.25, v: clamp(100 - input.failRate * 2), label: "pass rate (100 - 2 x fail%) 25%" });
  if (parts.length < 2) return null;
  const total = parts.reduce((s, p) => s + p.w, 0);
  return { score: Math.round(parts.reduce((s, p) => s + p.v * p.w, 0) / total), basis: `Weighted blend of ${parts.map((p) => p.label).join(", ")} (re-normalised over available parts).` };
}

/** Tone for a quality score against the target. */
export function scoreTone(score: number | null): "green" | "amber" | "red" | "slate" {
  if (score === null) return "slate";
  return score >= QUALITY_TARGET_PCT ? "green" : score >= QUALITY_TARGET_PCT - 10 ? "amber" : "red";
}
