/** Shared types, thresholds and formatters for the Shift Effectiveness panel. */

export type ShiftType = "MORNING" | "AFTERNOON" | "EVENING" | "NIGHT";

export interface ShiftMetrics {
  adherencePct: number | null;
  onTimePct: number | null;
  qualityAvg: number | null;
  breakCompliancePct: number | null;
  avgBreakMinutes: number | null;
  breakBudget: number;
  productivityScore: number | null;
}

export interface ShiftRow {
  shiftId: string;
  shiftName: string;
  shiftTime: string;
  shiftType: ShiftType;
  processId: string | null;
  totalEmployees: number;
  scheduledDays: number;
  presentDays: number;
  breakDays: number;
  qualityDays: number;
  metrics: ShiftMetrics;
  trend: { adherence: number | null; quality: number | null };
  spark: number[];
  rank: number;
  isOptimal: boolean;
}

export interface DateWindow { from: string; to: string }

export interface ShiftListResponse {
  shifts: ShiftRow[];
  window: { cur: DateWindow; prev: DateWindow };
  totals: { scheduledDays: number; presentDays: number; adherencePct: number | null; adherenceDelta: number | null };
  daily: Array<{ date: string; adherencePct: number | null; scheduledDays: number }>;
}

export interface BreakResponse {
  overall: {
    compliancePct: number | null;
    avgBreakMinutes: number | null;
    budgetMinutes: number;
    overBreakCount: number;
    underBreakCount: number;
    sessions: number;
    employeesTracked: number;
    delta: number | null;
  };
  window: { cur: DateWindow; prev: DateWindow };
  byShift: Array<{ shiftId: string; shiftName: string; compliancePct: number | null; avgBreakMinutes: number; budgetMinutes: number; days: number }>;
  byProcess: Array<{ processId: string; processName: string; compliancePct: number | null; avgBreakMinutes: number; budgetMinutes: number; days: number; avgExcessMinutes: number }>;
  topViolators: Array<{ employeeId: string; employeeCode: string; employeeName: string; avgExcessMinutes: number; occurrences: number; daysObserved: number; lastViolation: string | null }>;
  daily: Array<{ date: string; compliancePct: number | null; avgBreakMinutes: number; sessions: number }>;
}

export interface Recommendation {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  currentShift: string;
  currentShiftId: string;
  recommendedShift: string;
  recommendedShiftId: string;
  reason: string;
  expectedImprovement: number;
  personalAdherence: number;
  targetAdherence: number;
  scheduledDays: number;
  presentDays: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface ShiftDetail {
  template: Record<string, unknown>;
  window: { cur: DateWindow; prev: DateWindow };
  metrics: ShiftMetrics | null;
  trend: { adherence: number | null; quality: number | null };
  totalEmployees: number;
  scheduledDays: number;
  daily: Array<{ date: string; scheduledDays: number; adherencePct: number | null; onTimePct: number | null }>;
  byProcess: Array<{ processName: string; employees: number; scheduledDays: number; adherencePct: number | null }>;
  lowestAdherence: Array<{ employeeId: string; employeeCode: string; employeeName: string; scheduledDays: number; presentDays: number; adherencePct: number | null }>;
  versions: Array<{ id: string; version: number; shift_name: string; effective_from: string | null; effective_to: string | null; active_status: number; created_by: string | null; created_at: string }>;
  audit: Array<{ actor_user_id: string | null; action_type: string; created_at: string; metadata_json: unknown }>;
}

export interface EmployeeBreakDetail {
  employee: { id: string; employeeCode: string; fullName: string; processName: string | null; branchName: string | null; managerName: string | null };
  window: { cur: DateWindow; prev: DateWindow };
  summary: { daysObserved: number; overBudgetDays: number; compliancePct: number | null; avgBreakMinutes: number | null; avgExcessMinutes: number | null };
  days: Array<{
    date: string; totalBreakMinutes: number; budgetMinutes: number; overBudget: boolean; miniBreaks: number; longBreaks: number;
    exceededBreaks: number; exceptions: number; status: string | null; firstBreakStart: string | null; lastBreakEnd: string | null;
  }>;
  sessions: Array<{
    id: string; start_time: string | null; end_time: string | null; duration_minutes: number | null; break_type: string | null;
    break_reason: string; status: string; exception_reason: string | null; manager_approved_by: string | null; manager_approved_at: string | null;
  }>;
  alerts: Array<{
    alert_type: string; alert_level: string; threshold_minutes: number; actual_minutes: number; exceeded_by_minutes: number;
    email_status: string; sent_at: string | null; created_at: string;
  }>;
}

// ── Thresholds (one place, so cards, pills, charts and insights agree) ───────

export const THRESH = {
  adherence: { good: 90, warn: 75 },
  quality: { good: 80, warn: 65 },
  breaks: { good: 90, warn: 75 },
} as const;

export type Tone = "green" | "amber" | "red" | "neutral";

export function toneFor(value: number | null | undefined, t: { good: number; warn: number }): Tone {
  if (value == null) return "neutral";
  return value >= t.good ? "green" : value >= t.warn ? "amber" : "red";
}

// ── Formatters ───────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** 2026-09-30 | ISO timestamp -> 30/09/2026. */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** 'YYYY-MM-DD HH:mm' | ISO timestamp -> DD/MM/YYYY HH:mm. */
export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(v);
  if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${Number.isInteger(v) ? v : v.toFixed(1)}%`);
export const fmtNum = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-IN"));
export const fmtMin = (v: number | null | undefined) => (v == null ? "—" : `${v} min`);
