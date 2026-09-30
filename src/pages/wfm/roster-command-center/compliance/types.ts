export type RuleId = "MIN_REST" | "CONSECUTIVE_DAYS" | "WEEKOFF_FAIRNESS" | "MAX_HOURS" | "NIGHT_SHIFT_LIMIT";
export type Severity = "high" | "medium" | "low";
export type FeedKind = "roster" | "attendance";

export interface RuleSummary {
  ruleId: RuleId; ruleName: string; description: string; threshold: string; severity: Severity;
  violationCount: number; employeesAffected: number;
}
export interface BranchScore {
  branchId: string; branchName: string; score: number | null; violations: number;
  rostered: number; employeesWithViolations: number; trend: number | null;
}
export interface AttendanceSummary {
  through: string; scheduled: number; adhered: number; late: number; absent: number;
  missingPunch: number; unreconciled: number; excused: number; adherencePct: number | null;
}
export interface ComplianceSummary {
  period: string; hasData: boolean; compliancePct: number | null; totalEmployees: number;
  employeesWithViolations: number; totalViolations: number; rules: RuleSummary[]; byBranch: BranchScore[];
  trend: number | null;
  previous: { period: string; compliancePct: number | null; totalViolations: number } | null;
  history: Array<{ month: string; compliancePct: number | null; violations: number }>;
  attendance: AttendanceSummary | null; generatedAt: string;
}
export interface TrendPoint {
  month: string; compliancePct: number | null; violations: number; employeesWithViolations: number;
  rostered: number; byRule: Record<RuleId, number>;
}
export interface FeedRow {
  violationId: string; date: string; employeeId: string; employeeCode: string; employeeName: string;
  processName: string | null; branchName: string | null; ruleId: string; ruleName: string; severity: Severity;
  shiftName: string | null; status: string; details: string; affectedDates: string[];
}
export interface FeedResponse {
  period: string; kind: FeedKind; page: number; pageSize: number; totalCount: number;
  counts: { byRule: Record<string, number> }; violations: FeedRow[];
}

export type DrawerTarget =
  | { type: "employee"; id: string }
  | { type: "rule"; id: RuleId }
  | { type: "branch"; id: string }
  | { type: "overview" };

export const RULE_OPTIONS: Array<{ id: RuleId; label: string }> = [
  { id: "MIN_REST", label: "Minimum rest" },
  { id: "CONSECUTIVE_DAYS", label: "Consecutive days" },
  { id: "WEEKOFF_FAIRNESS", label: "Week-off fairness" },
  { id: "MAX_HOURS", label: "Weekly hours" },
  { id: "NIGHT_SHIFT_LIMIT", label: "Night shifts" },
];
export const ATTENDANCE_OPTIONS = [
  { id: "ABSENT_NO_CALL", label: "Absent" },
  { id: "LATE_ARRIVAL", label: "Late arrival" },
  { id: "MISSING_PUNCH", label: "Missing punch" },
  { id: "UNRECONCILED", label: "Not reconciled" },
];
