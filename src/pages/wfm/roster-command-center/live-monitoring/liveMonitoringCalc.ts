/** Pure calc/format helpers for the Live Monitoring panel (no React) so they are unit-testable. */

export interface DigestMember { employeeId: string; employeeCode: string; employeeName: string }
export interface ManagerDigest {
  managerId: string;
  managerName: string;
  managerEmail: string | null;
  date: string;
  branchId: string | null;
  branchName: string | null;
  teamSize: number;
  planned: number;
  present: number;
  shrinkagePct: number;
  unplannedAbsences: Array<DigestMember & { shiftTime?: string | null }>;
  lateArrivals: Array<DigestMember & { lateMinutes: number | null; shiftTime?: string | null; firstIn?: string | null }>;
  incompleteShifts: Array<DigestMember & { workedPct: number | null; shiftTime?: string | null }>;
  onTime: DigestMember[];
  aprPending: number;
}
export interface LiveAlert {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  shiftTime: string;
  managerId: string | null;
  managerName: string | null;
  processName: string | null;
  branchName: string | null;
  minutesSinceShiftStart: number;
}

export type Severity = "critical" | "warning" | "info";
export const CRITICAL_MINUTES = 60;
export const WARNING_MINUTES = 30;
/** Shrinkage target shown on the gauge; amber above this, red above 2x. */
export const SHRINKAGE_TARGET = 8;

/** Single threshold definition used by rows, counts and KPI tiles (was inconsistent >60 vs >=). */
export function alertSeverity(minutes: number): Severity {
  if (minutes >= CRITICAL_MINUTES) return "critical";
  if (minutes >= WARNING_MINUTES) return "warning";
  return "info";
}

export function severityCounts(alerts: LiveAlert[]): Record<Severity, number> {
  const c: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts) c[alertSeverity(a.minutesSinceShiftStart)]++;
  return c;
}

/** Pooled % = sum(part)/sum(whole); null when whole is 0 (never NaN, never a fake 0%). */
export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export interface LiveSummary {
  planned: number;
  present: number;
  absent: number;
  late: number;
  incomplete: number;
  onTime: number;
  apr: number;
  managers: number;
  coveragePct: number | null;
  /** Pooled across all teams (planned-weighted), not the mean of per-manager percents. */
  shrinkagePct: number | null;
  atRiskManagers: number;
}

export function summarize(digests: ManagerDigest[]): LiveSummary {
  let planned = 0, present = 0, absent = 0, late = 0, incomplete = 0, onTime = 0, apr = 0, atRisk = 0;
  for (const d of digests) {
    planned += d.planned; present += d.present; absent += d.unplannedAbsences.length;
    late += d.lateArrivals.length; incomplete += d.incompleteShifts.length; onTime += d.onTime.length; apr += d.aprPending;
    const s = effectivenessScore(d);
    if (s !== null && s < 60) atRisk++;
  }
  const coveragePct = pct(present, planned);
  return {
    planned, present, absent, late, incomplete, onTime, apr, managers: digests.length, coveragePct,
    shrinkagePct: coveragePct === null ? null : Math.max(0, 100 - coveragePct), atRiskManagers: atRisk,
  };
}

/**
 * 0-100 team score: coverage 40 + on-time share 30 + (100-shrinkage) 20 + APR backlog 10.
 * Returns null when nothing is planned yet — the old code awarded free points (score 100)
 * to a team with no measurable outcome.
 */
export function effectivenessScore(d: Pick<ManagerDigest, "planned" | "present" | "onTime" | "shrinkagePct" | "aprPending">): number | null {
  if (!(d.planned > 0)) return null;
  const presentScore = (d.present / d.planned) * 40;
  const onTimeScore = d.present > 0 ? (d.onTime.length / d.present) * 30 : 0;
  const shrinkageScore = Math.max(0, ((100 - d.shrinkagePct) / 100) * 20);
  const aprScore = d.aprPending < 3 ? 10 : d.aprPending < 5 ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(presentScore + onTimeScore + shrinkageScore + aprScore)));
}

export function scoreTone(score: number | null): "green" | "amber" | "red" | "neutral" {
  if (score === null) return "neutral";
  return score >= 80 ? "green" : score >= 60 ? "amber" : "red";
}

/** 'YYYY-MM-DD[ T]HH:mm[:ss]' -> 'DD/MM/YYYY HH:mm' (date-only -> 'DD/MM/YYYY'). Unparseable -> '—'. */
export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(v));
  if (!m) return "—";
  return m[4] ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

export function fmtDuration(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "—";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
