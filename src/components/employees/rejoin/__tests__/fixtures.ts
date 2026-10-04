import type {
  AttendanceSection,
  ConductSection,
  Dossier,
  ExitSection,
  HeaderSection,
  KpiSection,
  LeaveSection,
  LearningSection,
  PayrollSection,
  TimelineSection,
} from "../rejoinTypes";

/** Shaped exactly like the section loaders' output (backend/src/modules/employees/rehire/dossier). */
export const header: HeaderSection = {
  employeeId: "e-1",
  employeeCode: "MAS10234",
  name: "Asha Kumari",
  photoUrl: null,
  designation: "Customer Care Executive",
  department: "Operations",
  branch: "Noida",
  process: "SBI Card Inbound",
  manager: "Ravi Verma (MAS00012)",
  dateOfJoining: "2024-04-01",
  dateOfExit: "2026-08-31",
  employmentStatus: "inactive",
  tenureMonths: 28,
};

export const windowMonths = [
  "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
  "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
];

export const attendance: AttendanceSection = {
  months: [
    { month: "2026-06", workingDays: 26, present: 22, halfDay: 2, absent: 1, leave: 1, missingPunch: 0, lateMarks: 3, lopDays: 1, lateMinutes: 45 },
    { month: "2026-07", workingDays: 27, present: 25, halfDay: 0, absent: 2, leave: 0, missingPunch: 0, lateMarks: 6, lopDays: 2, lateMinutes: 120 },
    // Only week-offs/holidays recorded: a gap, not 0%.
    { month: "2026-08", workingDays: 0, present: 0, halfDay: 0, absent: 0, leave: 0, missingPunch: 0, lateMarks: 0, lopDays: 0, lateMinutes: 0 },
  ],
  totals: { workingDays: 53, present: 47, halfDay: 2, absent: 3, leave: 1, missingPunch: 0, lateMarks: 9, lopDays: 3, lateMinutes: 165 },
  attendancePct: 92.5,
  regularizations: { total: 4, approved: 2, rejected: 1, pending: 1 },
  late: { totalLateMarks: 9, avgLateMarksPerMonth: 3, avgLateMinutes: 18.3, worstMonth: { month: "2026-07", lateMarks: 6 } },
};

export const kpi: KpiSection = {
  months: [
    { period: "2026-06", avgAchievementPct: 100, metricsMeasured: 3, atTarget: true, finalScore: null, rating: null },
    { period: "2026-07", avgAchievementPct: 82.5, metricsMeasured: 3, atTarget: false, finalScore: 3.2, rating: "Meets" },
    { period: "2026-08", avgAchievementPct: null, metricsMeasured: 0, atTarget: null, finalScore: null, rating: null },
  ],
  monthsWithData: 2,
  monthsAtTarget: 1,
  atTargetPct: 50,
  best: { period: "2026-06", avgAchievementPct: 100 },
  worst: { period: "2026-07", avgAchievementPct: 82.5 },
};

export const leave: LeaveSection = {
  byType: [
    { leaveType: "CL", paid: true, requests: 3, days: 4, shortNotice: 2, weekendAdjacent: 1 },
    { leaveType: "Leave Without Pay", paid: false, requests: 1, days: 2, shortNotice: 1, weekendAdjacent: 1 },
  ],
  totalRequests: 4,
  totalDays: 6,
  paidDays: 4,
  unpaidDays: 2,
  shortNoticeRequests: 3,
  shortNoticePct: 75,
  weekendAdjacentRequests: 2,
  weekendAdjacentPct: 50,
  balances: [{ leaveType: "CL", year: 2026, allocated: 12, used: 4, available: 8 }],
};

export const learning: LearningSection = {
  coursesTotal: 2,
  coursesCompleted: 1,
  avgCompletionPct: 70,
  courses: [
    { name: "POSH", completionPct: 100, status: "completed" },
    { name: "Product basics", completionPct: 40, status: "in_progress" },
  ],
  certifications: [{ name: "Collections Level 1", issued: "2025-01-10", expires: null, status: "active" }],
};

export const conduct: ConductSection = {
  warnings: [
    { id: "w2", date: "2026-07-14", category: "attendance", severity: "final", status: "active", description: "Repeated unapproved absence" },
    { id: "w1", date: "2026-03-02", category: "behaviour", severity: "verbal", status: "withdrawn", description: null },
  ],
  activeWarnings: 1,
  finalWarnings: 1,
  pips: [{ id: "p1", start: "2026-05-01", end: null, status: "active", outcome: null, reason: "Low QA scores" }],
  openPip: true,
  unacknowledgedAlerts: 2,
  completedCoachingSessions: 3,
  disciplinaryFlag: { flagged: true, reason: "Customer abuse complaint", date: "2026-08-20", lifted: true },
  priorAbscondingExits: 1,
  priorRejoins: 0,
  priorRejoinRequests: 1,
};

export const exit: ExitSection = {
  exitRequestId: "x-1",
  exitType: "resignation",
  subType: "absconding",
  reasonCategory: "absconding",
  reasonText: null,
  abscondingSince: "2026-08-25",
  lastWorkingDay: "2026-08-31",
  status: "completed",
  notice: { requiredDays: 30, servedDays: 6, shortfallDays: 24 },
  clearance: { total: 4, done: 2, pending: [{ department: "IT", remarks: "Laptop not returned" }, { department: "Finance", remarks: null }] },
  assetsHeld: [{ name: "Dell Latitude 5420", category: "laptop", assigned: "2024-04-02" }],
  ff: { netPayable: 18450.4, status: "approved", paid: false },
};

export const payroll: PayrollSection = {
  payslips: [
    { month: "2026-08", gross: 21000, net: 18900, deductions: 2100 },
    { month: "2026-07", gross: 21000, net: 19100, deductions: 1900 },
  ],
  lastNet: 18900,
  avgNet: 19000,
  currentSalary: { gross: 21000, ctc: 252000 },
  pendingRecoveries: { loans: 5000, advances: 0, deductions: 1200, total: 6200 },
};

export const timeline: TimelineSection = {
  events: [
    { date: "2026-09-20", kind: "rejoin_request", title: "Rejoin request raised", detail: "pending" },
    { date: "2026-08-31", kind: "exit", title: "Exit: absconding", detail: "completed" },
    { date: "2024-04-01", kind: "joining", title: "Joined", detail: null },
  ],
  skipped: [],
};

export function dossier(over: Partial<Dossier> = {}): Dossier {
  return {
    request: {
      id: "r-1",
      employeeId: "e-1",
      status: "pending",
      proposedJoiningDate: "2026-10-06",
      reason: "Good agent, wants to return",
      raisedByRole: "hr",
      gapDays: 36,
    },
    window: { start: "2025-09-01", end: "2026-08-31", months: windowMonths },
    eligibility: {
      status: "blocked",
      reasons: [
        { code: "GAP_EXCEEDS_30", severity: "blocked", message: "Gap exceeds 30 days; fresh ATS onboarding is required." },
        { code: "ABSCONDING", severity: "review", message: "Left by absconding; the branch head must acknowledge and give remarks." },
      ],
      requiresFreshOnboarding: true,
      requiresAbscondingAck: true,
    },
    verdict: {
      rating: "weak",
      reasons: [
        { tone: "bad", text: "Has a final warning on record (1 active warning in total)." },
        { tone: "good", text: "Served 28 months." },
      ],
    },
    sections: {
      header: { status: "ok", data: header },
      attendance: { status: "ok", data: attendance },
      kpi: { status: "ok", data: kpi },
      leave: { status: "ok", data: leave },
      learning: { status: "ok", data: learning },
      conduct: { status: "ok", data: conduct },
      exit: { status: "ok", data: exit },
      payroll: { status: "ok", data: payroll },
      timeline: { status: "ok", data: timeline },
    },
    generatedAt: "2026-10-04T06:00:00.000Z",
    ...over,
  };
}
