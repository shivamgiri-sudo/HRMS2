/** Types + pure helpers for the Roster Audit Trail panel (no React, unit-tested). */
import type { PillTone } from "@/components/wfm/console/StatusPill";

export interface AuditTrail {
  id: string;
  date: string;
  changeType: string;
  changeTypeCode: string;
  reason: string;
  ruleApplied: string | null;
  isOverride: boolean;
  isEngineError: boolean;
  timestamp: string;
  cycleId: string | null;
  runId: string | null;
  employee: { id: string; code: string; name: string };
  processName: string | null;
  branchName: string | null;
  shiftName: string | null;
  changedBy: string;
  runType: string | null;
}
export interface TrailsResponse { trails: AuditTrail[]; count: number; total: number; limit: number; offset: number }

export interface GenerationRun {
  id: string;
  cycleId: string;
  processName: string | null;
  branchName: string | null;
  runType: string;
  status: string;
  stats: { employeesProcessed: number; assignmentsCreated: number; weekoffsAllocated: number; conflictsFound: number };
  weekStart: string | null;
  weekEnd: string | null;
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  triggeredBy: string;
}
export interface RunsResponse { runs: GenerationRun[]; total: number; limit: number; offset: number }

export interface TimelineEntry { at: string | null; event: string; actor: string; decision: string | null; remarks: string | null }
export interface DayPoint { date: string; total: number; overrides?: number }

export interface AuditTrailDetail {
  id: string;
  date: string;
  changeType: string;
  changeTypeCode: string;
  isEngineError: boolean;
  reason: string;
  ruleApplied: string | null;
  overrideReason: string | null;
  overrideAt: string | null;
  timestamp: string;
  cycleId: string | null;
  cycle: { id: string; weekStart: string | null; weekEnd: string | null; status: string | null } | null;
  employee: { id: string; code: string; name: string };
  processName: string | null;
  branchName: string | null;
  shift: { name: string; code: string | null; startTime: string; endTime: string } | null;
  engine: {
    isWeekOff: boolean; preferredDay: number | null; allocatedDay: number | null; allocationSequence: number | null;
    fcfsRank: number | null; fairnessScore: number | null; skillCheckResult: string | null; capacityAtAllocation: unknown;
  };
  oldValue: unknown;
  newValue: unknown;
  changedBy: string;
  changedByCode: string | null;
  actedByRole: string | null;
  run: { id: string; runType: string; status: string; startedAt: string; completedAt: string | null; triggeredBy: string } | null;
  timeline: TimelineEntry[];
  employeeTrend: DayPoint[];
  relatedChanges: Array<{ id: string; date: string; changeType: string; reason: string; timestamp: string; changedBy: string }>;
  amendments: Array<{ id: string; changeType: string; reason: string; changeDate: string; timestamp: string; newAssignmentType: string | null; isLateChange: boolean; leadTimeHours: number | null; changedBy: string }>;
}

export interface RunDetail {
  id: string;
  cycleId: string;
  cycle: { id: string; weekStart: string | null; weekEnd: string | null; status: string | null };
  processName: string | null;
  branchName: string | null;
  runType: string;
  status: string;
  stats: GenerationRun["stats"];
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  triggeredBy: { id: string | null; name: string; code: string | null };
  parameters: unknown;
  errorDetails: unknown;
  timeline: TimelineEntry[];
  decisionSummary: Array<{ code: string; label: string; count: number }>;
  decisionTotal: number;
  engineErrorCount: number;
  decisionsByDate: DayPoint[];
  decisions: Array<{ id: string; date: string; changeType: string; changeTypeCode: string; reason: string; timestamp: string; employee: { code: string; name: string } }>;
  siblingRuns: Array<{ id: string; runType: string; status: string; startedAt: string; completedAt: string | null; assignmentsCreated: number; conflictsFound: number }>;
}

export interface AuditSummary {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  totalChanges: number;
  manualOverrides: number;
  overrideRate: number;
  engineErrors: number;
  byTypeDetail: Array<{ code: string; label: string; count: number; overrides: number }>;
  daily: Array<{ date: string; total: number; overrides: number }>;
  topActors: Array<{ id: string; name: string; count: number }>;
  generationRuns: { auto: number; manual: number; total: number; failed: number; partial: number; totalAssignments: number; totalConflicts: number };
  previous: { totalChanges: number; manualOverrides: number; overrideRate: number; runs: number; conflicts: number };
  deltas: { totalChanges: number | null; manualOverrides: number | null; runs: number | null; conflicts: number | null };
}

/** Closed set for the change-type dropdown (mirrors roster_decision_audit.decision_type + synthetic engine_error). */
export const CHANGE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "shift_assigned", label: "Shift Assigned" },
  { value: "weekoff_assigned", label: "Week-off Assigned" },
  { value: "weekoff_denied", label: "Week-off Denied" },
  { value: "weekoff_waitlisted", label: "Week-off Waitlisted" },
  { value: "shift_frozen", label: "Shift Frozen" },
  { value: "holiday_applied", label: "Holiday Applied" },
  { value: "preference_accepted", label: "Preference Accepted" },
  { value: "alternate_assigned", label: "Alternate Assigned" },
  { value: "no_preference_auto_assigned", label: "Auto-assigned (No Preference)" },
  { value: "manual_override", label: "Manual Override" },
  { value: "manager_realigned", label: "Manager Realigned" },
  { value: "force_approved", label: "Force Approved" },
  { value: "hr_override", label: "HR Override" },
  { value: "bulk_upload", label: "Bulk Upload" },
  { value: "escalated_to_hr", label: "Escalated to HR" },
  { value: "manager_rejected_request", label: "Request Rejected by Manager" },
  { value: "engine_error", label: "Engine Error" },
];

export const RUN_STATUS_OPTIONS = [
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "partial", label: "Partial" },
  { value: "failed", label: "Failed" },
];

export const ASSIGNMENT_TYPE_OPTIONS = [
  { value: "SHIFT", label: "Shift" },
  { value: "WEEK_OFF", label: "Week-off" },
  { value: "TRAINING", label: "Training" },
  { value: "UNSCHEDULED", label: "Unscheduled" },
];

/** Override rate at/above which the alert strip flags the period (single source for UI thresholds). */
export const OVERRIDE_RATE_WARN_PCT = 10;

// ---------- formatting (DD/MM/YYYY, DD/MM/YYYY HH:mm, en-IN) — string based, never timezone-shifted ----------

/** 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm:ss' / ISO -> 'DD/MM/YYYY'. */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/** -> 'DD/MM/YYYY HH:mm' */
export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : fmtDate(v);
}

export const fmtNum = (n: number | null | undefined): string => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toLocaleString("en-IN"));

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function fmtWeek(start: string | null, end: string | null): string {
  return start && end ? `${fmtDate(start)} - ${fmtDate(end)}` : "—";
}

export function changeTypeTone(code: string): PillTone {
  switch (code) {
    case "engine_error": case "weekoff_denied": case "manager_rejected_request": return "red";
    case "weekoff_waitlisted": case "escalated_to_hr": return "amber";
    case "manual_override": case "manager_realigned": case "force_approved": case "hr_override": return "violet";
    case "weekoff_assigned": case "holiday_applied": case "preference_accepted": return "green";
    case "shift_assigned": case "alternate_assigned": case "no_preference_auto_assigned": case "bulk_upload": return "blue";
    default: return "neutral";
  }
}

export function runStatusTone(status: string): PillTone {
  return status === "completed" ? "green" : status === "running" ? "blue" : status === "partial" ? "amber" : status === "failed" ? "red" : "neutral";
}

// ---------- alerts ----------

export type AlertSeverity = "critical" | "warning" | "info";
export interface AuditAlert {
  key: string;
  severity: AlertSeverity;
  count: number;
  label: string;
  /** What clicking the alert does. */
  action: { tab: "trails" | "runs"; changeType?: string; overridesOnly?: boolean; runStatus?: string };
}

const SEV_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Alerts derived from the summary, most severe first, then by count. */
export function buildAlerts(s: AuditSummary | undefined): AuditAlert[] {
  if (!s) return [];
  const out: AuditAlert[] = [];
  const r = s.generationRuns;
  if (r.failed > 0) out.push({ key: "runs-failed", severity: "critical", count: r.failed, label: `failed generation run${r.failed === 1 ? "" : "s"}`, action: { tab: "runs", runStatus: "failed" } });
  if (s.engineErrors > 0) out.push({ key: "engine-errors", severity: "critical", count: s.engineErrors, label: `employee${s.engineErrors === 1 ? "" : "s"} failed during roster generation`, action: { tab: "trails", changeType: "engine_error" } });
  if (r.partial > 0) out.push({ key: "runs-partial", severity: "warning", count: r.partial, label: `partial run${r.partial === 1 ? "" : "s"} (week-off policy or rest gaps)`, action: { tab: "runs", runStatus: "partial" } });
  if (r.totalConflicts > 0) out.push({ key: "conflicts", severity: "warning", count: r.totalConflicts, label: `roster conflict${r.totalConflicts === 1 ? "" : "s"} found by generation runs`, action: { tab: "runs" } });
  if (s.totalChanges > 0 && s.overrideRate >= OVERRIDE_RATE_WARN_PCT) out.push({ key: "override-rate", severity: "warning", count: s.manualOverrides, label: `manual overrides (${s.overrideRate}% of changes, threshold ${OVERRIDE_RATE_WARN_PCT}%)`, action: { tab: "trails", overridesOnly: true } });
  return out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.count - a.count);
}

// ---------- sorting ----------

export type SortDir = "asc" | "desc";

export function sortBy<T>(rows: T[], get: (r: T) => string | number | null | undefined, dir: SortDir): T[] {
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a); const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * m;
    return String(x).localeCompare(String(y), "en-IN", { numeric: true, sensitivity: "base" }) * m;
  });
}

/** 'Showing 51-100 of 1,234' — safe for empty results. */
export function pageLabel(offset: number, count: number, total: number): string {
  if (!total || !count) return "No records";
  return `Showing ${fmtNum(offset + 1)}-${fmtNum(offset + count)} of ${fmtNum(total)}`;
}

/** Days (YYYY-MM-DD) from start to end inclusive, capped so a bad cycle can never explode a dropdown. */
export function daysInRange(start: string, end: string, cap = 31): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(e.getTime())) return out;
  while (d <= e && out.length < cap) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
