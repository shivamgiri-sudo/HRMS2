/**
 * Positive Signal Engine for the D-1 Daily Manager Briefing Engine.
 *
 * Pure derivation — no DB access of its own. Takes the already-computed
 * outputs of the attendance section (daily-brief-aggregator.service.ts's
 * AttendanceSummary shape), the KPI/performance module (daily-brief-kpi.module.ts)
 * and the quality module (daily-brief-quality.module.ts), and ranks 3-5
 * genuinely-positive observations. Never fabricates a positive when the
 * underlying data is absent or inconclusive — the category is skipped instead.
 *
 * INTEGRATION-PASS WIDENING — the "zero hygiene exceptions" / "all actions cleared"
 * gap is now closed. The governing prompt's original candidate list named these two
 * categories but its own declared signature — `buildPositiveSignals(attendance, kpi,
 * quality)` — never passed HygieneIssue[]/BriefAction[] in, so the module-builder
 * correctly left them as documented no-ops rather than requery data behind the
 * aggregator's back. This integration pass adds a SEPARATE small function,
 * `buildOperationalPositiveSignals(hygieneIssues, actions, businessDate)`, instead of
 * widening `buildPositiveSignals` itself — the aggregator already computes
 * hygieneIssues/actions once per brief and can pass them straight through with no
 * requery, and keeping the two functions separate means every existing unit test for
 * buildPositiveSignals(attendance, kpi, quality) keeps passing unmodified. The
 * aggregator concatenates both functions' output before capping/ranking.
 *
 * Every threshold used is derived from data the other modules already
 * computed (100%, zero, "above_or_at_target", "improved"), EXCEPT the
 * "material improvement" delta for KPI/quality trend signals, which reuses
 * the same editorial floor as daily-brief-quality.module.ts's
 * MATERIAL_DELTA_POINTS (5 percentage/achievement points) — flagged there and
 * here as needing product sign-off, not a discovered business rule. Now
 * centralized in daily-brief-editorial-constants.ts.
 */
import type { AttendanceSummary, BriefAction, BriefSignal, HygieneIssue } from "./daily-brief.types.js";
import type { KpiPerformanceModuleResult } from "./daily-brief-kpi.module.js";
import type { QualityModuleResult } from "./daily-brief-quality.module.js";
import { MATERIAL_DELTA_POINTS as MATERIAL_IMPROVEMENT_POINTS } from "./daily-brief-editorial-constants.js";

export type PositiveSignalConfidence = "high" | "medium" | "low";

export interface PositiveSignal extends BriefSignal {
  category: string;
  confidence: PositiveSignalConfidence;
  /** Human-readable detail for the brief body, neutral language only. */
  detail: string;
}

function attendanceSignals(attendance: AttendanceSummary): PositiveSignal[] {
  const out: PositiveSignal[] = [];
  if (attendance.expectedToWork > 0 && attendance.attendancePct !== null && attendance.attendancePct >= 100) {
    out.push({
      key: "attendance_100pct",
      category: "attendance",
      label: "100% team attendance",
      value: attendance.attendancePct,
      unit: "percent",
      confidence: "high",
      detail: `All ${attendance.expectedToWork} expected team member(s) attended.`,
    });
  }
  if (attendance.expectedToWork > 0 && attendance.lateCount === 0) {
    out.push({
      key: "zero_late_marks",
      category: "attendance",
      label: "Zero late marks",
      value: 0,
      unit: "count",
      confidence: "high",
      detail: "No late arrivals recorded for the team on D-1.",
    });
  }
  // "zero hygiene exceptions" and "all actions cleared" are now implemented in
  // buildOperationalPositiveSignals() below, not here — see that function's header.
  return out;
}

function kpiSignals(kpi: KpiPerformanceModuleResult): PositiveSignal[] {
  const out: PositiveSignal[] = [];
  if (kpi.employeeSignals.length === 0) return out;

  const aboveTarget = kpi.employeeSignals.filter((s) => s.observation === "above_or_at_target");
  if (aboveTarget.length > 0) {
    out.push({
      key: "kpi_target_exceeded",
      category: "kpi",
      label: "KPI target met or exceeded",
      value: aboveTarget.length,
      unit: "count",
      confidence: "high",
      detail: `${aboveTarget.length} of ${kpi.employeeSignals.length} scored KPI reading(s) at or above configured target on D-1.`,
    });
  }

  const improved = kpi.employeeSignals.filter((s) => s.trendVsBaseline === "improved");
  if (improved.length > 0) {
    out.push({
      key: "kpi_improved_vs_baseline",
      category: "kpi",
      label: "Improved vs 7-day baseline",
      value: improved.length,
      unit: "count",
      confidence: "medium",
      detail: `${improved.length} KPI reading(s) improved vs their 7-day trailing baseline `
        + `(editorial ${MATERIAL_IMPROVEMENT_POINTS}-point materiality floor not yet applied at the signal level — needs product sign-off).`,
    });
  }

  return out;
}

function qualitySignals(quality: QualityModuleResult): PositiveSignal[] {
  const out: PositiveSignal[] = [];
  if (
    quality.avgQualityPct !== null
    && quality.trailingBaseline?.avgQualityPct !== null
    && quality.trailingBaseline?.avgQualityPct !== undefined
    && quality.deterioration !== null
    // Adequate sample already gated inside buildQualityModule — deterioration
    // is only ever populated when both D-1 and baseline sample sizes cleared
    // MIN_SCORED_CALLS_FOR_SIGNAL there.
  ) {
    const deltaPoints = quality.avgQualityPct - quality.trailingBaseline.avgQualityPct;
    if (deltaPoints >= MATERIAL_IMPROVEMENT_POINTS) {
      out.push({
        key: "quality_improved_vs_baseline",
        category: "quality",
        label: "Quality improved vs 7-day baseline",
        value: Math.round(deltaPoints * 10) / 10,
        unit: "percent",
        confidence: quality.scoredCallCount >= 3 ? "medium" : "low",
        detail: `Team average quality up ${Math.round(deltaPoints * 10) / 10} points vs the 7-day baseline `
          + `on ${quality.scoredCallCount} scored call(s) (editorial ${MATERIAL_IMPROVEMENT_POINTS}-point floor — needs product sign-off).`,
      });
    }
  }
  return out;
}

/**
 * Ranked, capped-at-5 positive signals derived purely from already-computed
 * module outputs. Never invents a positive when data is absent — categories
 * whose underlying data is missing/insufficient are simply not produced.
 */
export function buildPositiveSignals(
  attendance: AttendanceSummary,
  kpi: KpiPerformanceModuleResult,
  quality: QualityModuleResult,
): PositiveSignal[] {
  const confidenceRank: Record<PositiveSignalConfidence, number> = { high: 0, medium: 1, low: 2 };

  const candidates = [
    ...attendanceSignals(attendance),
    ...kpiSignals(kpi),
    ...qualitySignals(quality),
  ];

  return candidates
    .sort((a, b) => confidenceRank[a.confidence] - confidenceRank[b.confidence])
    .slice(0, 5);
}

/**
 * "Zero hygiene exceptions" and "all actions cleared" — the two positive
 * categories the original module signature could not see (see file header).
 * Takes the aggregator's already-computed HygieneIssue[]/BriefAction[] directly
 * (both already resolved-issue / open-status filtered by
 * daily-brief-aggregator.service.ts) — no requery, no new DB access, no risk of
 * drifting from the aggregator's own filtering.
 *
 * `teamSize` gates both: a manager with zero team members gets NOT_APPLICABLE
 * data everywhere else in the brief, and must not be told "zero hygiene
 * exceptions" / "all actions cleared" as if that were a real accomplishment —
 * see hrms2-exit-clearance-checklist-abandoned-table memory's "false all-clear"
 * lesson, the exact defect class this guards against.
 */
export function buildOperationalPositiveSignals(
  hygieneIssues: HygieneIssue[],
  actions: BriefAction[],
  teamSize: number,
): PositiveSignal[] {
  const out: PositiveSignal[] = [];
  if (teamSize <= 0) return out;

  if (hygieneIssues.length === 0) {
    out.push({
      key: "zero_hygiene_exceptions",
      category: "hygiene",
      label: "Zero hygiene exceptions",
      value: 0,
      unit: "count",
      confidence: "high",
      detail: "No open attendance-hygiene/discipline items for your team on D-1.",
    });
  }
  if (actions.length === 0) {
    out.push({
      key: "all_actions_cleared",
      category: "actions",
      label: "All actions cleared",
      value: 0,
      unit: "count",
      confidence: "medium",
      detail: "No open priority items in your Action Centre right now.",
    });
  }
  return out;
}
