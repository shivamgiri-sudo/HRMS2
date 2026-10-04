/**
 * Frontend mirror of the rejoin dossier contract, frozen by Plan 2a
 * (docs/superpowers/plans/2026-10-03-employee-rejoin-v3-dossier-api.md).
 *
 * Source of truth: backend/src/modules/employees/rehire/dossier/*.ts and
 * backend/src/modules/employees/rehire/rehireEligibility.ts. Copied rather than imported because
 * those files pull mysql2 and the backend module graph into the app typecheck. Change both together.
 */

export type SectionResult<T> = { status: "ok"; data: T } | { status: "error"; error: string };

export type RehireStatus = "blocked" | "review" | "eligible";

export interface RehireReason {
  code: string;
  severity: "blocked" | "review";
  message: string;
}

export interface RehireVerdict {
  status: RehireStatus;
  reasons: RehireReason[];
  requiresFreshOnboarding: boolean;
  requiresAbscondingAck: boolean;
}

export type Rating = "strong" | "average" | "weak" | "insufficient_data";
export type Tone = "good" | "bad" | "neutral";

export interface DossierVerdict {
  rating: Rating;
  reasons: { tone: Tone; text: string }[];
}

export interface HeaderSection {
  employeeId: string;
  employeeCode: string;
  name: string;
  photoUrl: string | null;
  designation: string | null;
  department: string | null;
  branch: string | null;
  process: string | null;
  manager: string | null;
  dateOfJoining: string | null;
  dateOfExit: string | null;
  employmentStatus: string | null;
  tenureMonths: number | null;
}

export interface AttendanceMonth {
  month: string;
  workingDays: number;
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  missingPunch: number;
  lateMarks: number;
  lopDays: number;
  lateMinutes: number;
}

export type AttendanceTotals = Omit<AttendanceMonth, "month">;

export interface AttendanceSection {
  months: AttendanceMonth[];
  totals: AttendanceTotals;
  attendancePct: number | null;
  regularizations: { total: number; approved: number; rejected: number; pending: number };
  late: {
    totalLateMarks: number;
    avgLateMarksPerMonth: number | null;
    avgLateMinutes: number | null;
    worstMonth: { month: string; lateMarks: number } | null;
  };
}

export interface KpiMonth {
  period: string;
  avgAchievementPct: number | null;
  metricsMeasured: number;
  atTarget: boolean | null;
  finalScore: number | null;
  rating: string | null;
}

export interface KpiSection {
  months: KpiMonth[];
  monthsWithData: number;
  monthsAtTarget: number;
  atTargetPct: number | null;
  best: { period: string; avgAchievementPct: number } | null;
  worst: { period: string; avgAchievementPct: number } | null;
}

export interface LeaveByType {
  leaveType: string;
  paid: boolean;
  requests: number;
  days: number;
  shortNotice: number;
  weekendAdjacent: number;
}

export interface LeaveSection {
  byType: LeaveByType[];
  totalRequests: number;
  totalDays: number;
  paidDays: number;
  unpaidDays: number;
  shortNoticeRequests: number;
  shortNoticePct: number | null;
  weekendAdjacentRequests: number;
  weekendAdjacentPct: number | null;
  balances: { leaveType: string; year: number; allocated: number; used: number; available: number }[];
}

export interface LearningSection {
  coursesTotal: number;
  coursesCompleted: number;
  avgCompletionPct: number | null;
  courses: { name: string; completionPct: number; status: string }[];
  certifications: { name: string; issued: string | null; expires: string | null; status: string }[];
}

export interface ConductSection {
  warnings: { id: string; date: string; category: string; severity: string; status: string; description: string | null }[];
  activeWarnings: number;
  finalWarnings: number;
  pips: { id: string; start: string; end: string | null; status: string; outcome: string | null; reason: string | null }[];
  openPip: boolean;
  unacknowledgedAlerts: number;
  completedCoachingSessions: number;
  disciplinaryFlag: { flagged: boolean; reason: string | null; date: string | null; lifted: boolean };
  priorAbscondingExits: number;
  priorRejoins: number;
  priorRejoinRequests: number;
}

export interface ExitSection {
  exitRequestId: string;
  exitType: string | null;
  subType: string | null;
  reasonCategory: string | null;
  reasonText: string | null;
  abscondingSince: string | null;
  lastWorkingDay: string | null;
  status: string;
  notice: { requiredDays: number | null; servedDays: number | null; shortfallDays: number | null };
  clearance: { total: number; done: number; pending: { department: string; remarks: string | null }[] };
  assetsHeld: { name: string; category: string | null; assigned: string | null }[];
  ff: { netPayable: number | null; status: string; paid: boolean } | null;
}

export interface PayrollSection {
  payslips: { month: string; gross: number; net: number; deductions: number }[];
  lastNet: number | null;
  avgNet: number | null;
  currentSalary: { gross: number | null; ctc: number | null } | null;
  pendingRecoveries: { loans: number; advances: number; deductions: number; total: number } | null;
}

export interface TimelineEvent {
  date: string;
  kind: string;
  title: string;
  detail: string | null;
}

export interface TimelineSection {
  events: TimelineEvent[];
  skipped: string[];
}

export interface Dossier {
  request: {
    id: string;
    employeeId: string;
    status: string;
    proposedJoiningDate: string;
    reason: string;
    raisedByRole: string | null;
    gapDays: number;
  };
  window: { start: string; end: string; months: string[] };
  eligibility: RehireVerdict;
  verdict: DossierVerdict;
  sections: {
    header: SectionResult<HeaderSection | null>;
    attendance: SectionResult<AttendanceSection>;
    kpi: SectionResult<KpiSection>;
    leave: SectionResult<LeaveSection>;
    learning: SectionResult<LearningSection>;
    conduct: SectionResult<ConductSection>;
    exit: SectionResult<ExitSection | null>;
    payroll: SectionResult<PayrollSection>;
    timeline: SectionResult<TimelineSection>;
  };
  generatedAt: string;
}

/** Shape of the 400 body /reactivation/initiate and /branch-action return when eligibility refuses. */
export interface RejoinRefusal {
  message?: string;
  reason?: "REQUIRES_FRESH_ONBOARDING" | string;
  eligibility?: RehireVerdict;
}
