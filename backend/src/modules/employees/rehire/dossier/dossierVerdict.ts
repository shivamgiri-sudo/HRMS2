/**
 * Advisory rating of an employee's record, for the branch head. It is an input to the decision,
 * never the decision: the page shows the reasons next to the numbers they came from.
 * Pure on purpose, so the rules are testable and the thresholds are config, not buried in SQL.
 */

export type Rating = "strong" | "average" | "weak" | "insufficient_data";

export interface VerdictInputs {
  attendancePct: number | null;
  avgLateMarksPerMonth: number | null;
  kpiMonthsAtTargetPct: number | null;
  kpiMonthsWithData: number;
  activeWarnings: number;
  finalWarnings: number;
  openPip: boolean;
  priorAbsconding: boolean;
  tenureMonths: number | null;
}

export interface VerdictThresholds {
  minAttendancePct: number;
  goodAttendancePct: number;
  maxLateMarksPerMonth: number;
  goodLateMarksPerMonth: number;
  minKpiAtTargetPct: number;
  goodKpiAtTargetPct: number;
  minKpiMonths: number;
  goodTenureMonths: number;
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  minAttendancePct: 90,
  goodAttendancePct: 95,
  maxLateMarksPerMonth: 5,
  goodLateMarksPerMonth: 2,
  minKpiAtTargetPct: 60,
  goodKpiAtTargetPct: 80,
  minKpiMonths: 3,
  goodTenureMonths: 12,
};

export interface VerdictReason {
  tone: "good" | "bad" | "neutral";
  text: string;
}

export interface DossierVerdict {
  rating: Rating;
  reasons: VerdictReason[];
}

const MAX_REASONS = 5;

export function buildVerdict(i: VerdictInputs, t: VerdictThresholds = DEFAULT_THRESHOLDS): DossierVerdict {
  const bad: VerdictReason[] = [];
  const good: VerdictReason[] = [];
  const neutral: VerdictReason[] = [];

  if (i.finalWarnings > 0) {
    bad.push({ tone: "bad", text: `Has a final warning on record (${i.activeWarnings} active warning${i.activeWarnings === 1 ? "" : "s"} in total).` });
  } else if (i.activeWarnings > 0) {
    bad.push({ tone: "bad", text: `${i.activeWarnings} active warning${i.activeWarnings === 1 ? "" : "s"} on record.` });
  }
  if (i.openPip) bad.push({ tone: "bad", text: "Was on an open performance improvement plan." });
  if (i.priorAbsconding) bad.push({ tone: "bad", text: "Has an absconding exit on record." });

  if (i.attendancePct !== null) {
    if (i.attendancePct < t.minAttendancePct) {
      bad.push({ tone: "bad", text: `Attendance ${i.attendancePct}% is below ${t.minAttendancePct}%.` });
    } else if (i.attendancePct >= t.goodAttendancePct) {
      good.push({ tone: "good", text: `Attendance ${i.attendancePct}% is strong.` });
    } else {
      neutral.push({ tone: "neutral", text: `Attendance ${i.attendancePct}%.` });
    }
  }
  if (i.avgLateMarksPerMonth !== null) {
    if (i.avgLateMarksPerMonth > t.maxLateMarksPerMonth) {
      bad.push({ tone: "bad", text: `Averaged ${i.avgLateMarksPerMonth} late marks a month (limit ${t.maxLateMarksPerMonth}).` });
    } else if (i.avgLateMarksPerMonth <= t.goodLateMarksPerMonth) {
      good.push({ tone: "good", text: `Rarely late (${i.avgLateMarksPerMonth} late marks a month).` });
    } else {
      neutral.push({ tone: "neutral", text: `${i.avgLateMarksPerMonth} late marks a month on average.` });
    }
  }
  if (i.kpiMonthsWithData >= t.minKpiMonths && i.kpiMonthsAtTargetPct !== null) {
    if (i.kpiMonthsAtTargetPct < t.minKpiAtTargetPct) {
      bad.push({ tone: "bad", text: `KPI at target in only ${i.kpiMonthsAtTargetPct}% of ${i.kpiMonthsWithData} months.` });
    } else if (i.kpiMonthsAtTargetPct >= t.goodKpiAtTargetPct) {
      good.push({ tone: "good", text: `KPI at target in ${i.kpiMonthsAtTargetPct}% of ${i.kpiMonthsWithData} months.` });
    } else {
      neutral.push({ tone: "neutral", text: `KPI at target in ${i.kpiMonthsAtTargetPct}% of ${i.kpiMonthsWithData} months.` });
    }
  }
  if (i.tenureMonths !== null) {
    if (i.tenureMonths >= t.goodTenureMonths) good.push({ tone: "good", text: `Served ${i.tenureMonths} months.` });
    else neutral.push({ tone: "neutral", text: `Short tenure: ${i.tenureMonths} months.` });
  }

  const hasPerformanceData = i.attendancePct !== null || i.kpiMonthsWithData >= t.minKpiMonths;
  let rating: Rating;
  if (i.finalWarnings > 0 || bad.length >= 2) rating = "weak";
  else if (!hasPerformanceData) rating = "insufficient_data";
  else if (bad.length === 0 && good.length >= 2) rating = "strong";
  else rating = "average";

  const reasons = [...bad, ...good, ...neutral].slice(0, MAX_REASONS);
  if (rating === "insufficient_data") {
    reasons.unshift({ tone: "neutral", text: "Not enough attendance or KPI history to rate this employee." });
  }
  return { rating, reasons: reasons.slice(0, MAX_REASONS) };
}
