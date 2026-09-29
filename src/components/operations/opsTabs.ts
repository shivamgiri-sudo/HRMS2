import type { OpsDimension } from "./opsTypes";

export type OpsTabId = "overview" | "attendance" | "shrinkage" | "roster" | "attrition" | "hiring" | "performance" | "quality" | "live";

export interface OpsTabConfig {
  id: OpsTabId;
  label: string;
  blurb: string;
  kpis: string[];
  columns: string[];
  trend?: Array<{ key: "attendancePct" | "shrinkagePct" | "absentPct" | "latePct" | "exits" | "joiners"; label: string; color: string }>;
}

const C = { blue: "#2563eb", rose: "#e11d48", amber: "#d97706", green: "#059669", violet: "#7c3aed" };

export const OPS_TABS: OpsTabConfig[] = [
  {
    id: "overview", label: "Overview",
    blurb: "Every operations vital signs in one row: people, attendance, shrinkage, roster, attrition, hiring and quality.",
    kpis: ["hc_closing", "attendance_pct", "shrinkage_pct", "roster_adherence_pct", "attrition_pct", "mandate_fill_pct", "open_positions", "qa_score_pct"],
    columns: ["hc_closing", "mandate_fill_pct", "attendance_pct", "shrinkage_pct", "roster_adherence_pct", "attrition_pct", "notice_hc", "open_positions", "qa_score_pct", "live_login_pct"],
    trend: [{ key: "attendancePct", label: "Attendance %", color: C.green }, { key: "shrinkagePct", label: "Shrinkage %", color: C.rose }],
  },
  {
    id: "attendance", label: "Attendance",
    blurb: "Daily attendance, punctuality and login hours from the attendance ledger.",
    kpis: ["attendance_pct", "absent_pct", "missing_punch_pct", "late_pct", "avg_login_hours", "open_mismatches"],
    columns: ["hc_closing", "scheduled_days", "present_days", "half_days", "leave_days", "absent_days", "absent_pct", "missing_punch_days", "late_marks", "late_pct", "avg_login_hours", "attendance_pct", "open_mismatches"],
    trend: [{ key: "attendancePct", label: "Attendance %", color: C.green }, { key: "absentPct", label: "Absent %", color: C.rose }, { key: "latePct", label: "Late %", color: C.amber }],
  },
  {
    id: "shrinkage", label: "Shrinkage",
    blurb: "Time lost against time scheduled, split planned (leave) vs unplanned, judged against the mandate's shrinkage budget.",
    kpis: ["shrinkage_pct", "planned_shrinkage_pct", "absence_shrinkage_pct", "missing_punch_pct", "shrinkage_mandate_pct", "avg_break_minutes"],
    columns: ["scheduled_days", "leave_days", "absent_days", "half_days", "missing_punch_days", "planned_shrinkage_pct", "absence_shrinkage_pct", "missing_punch_pct", "unplanned_shrinkage_pct", "shrinkage_pct", "shrinkage_mandate_pct", "avg_break_minutes", "break_exceeded_days"],
    trend: [{ key: "shrinkagePct", label: "Shrinkage %", color: C.rose }, { key: "absentPct", label: "Absent %", color: C.amber }],
  },
  {
    id: "roster", label: "Roster",
    blurb: "Roster coverage, publication, acknowledgement and adherence, plus demand-vs-roster shortage.",
    kpis: ["roster_coverage_pct", "roster_published_pct", "roster_adherence_pct", "ack_pending", "cycles_open", "demand_shortage_slots"],
    columns: ["hc_closing", "rostered_days", "rostered_hours", "weekoff_days", "training_days", "roster_coverage_pct", "roster_published_pct", "ack_pending", "ack_rejected", "roster_adherence_pct", "cycles_open", "demand_shortage_slots"],
  },
  {
    id: "attrition", label: "Attrition",
    blurb: "Exits over average headcount, by type and tenure, plus the notice-period pipeline.",
    kpis: ["attrition_pct", "exits", "early_attrition_pct", "notice_hc", "risk_high", "risk_medium"],
    columns: ["hc_avg", "exits", "attrition_pct", "attrition_annualised_pct", "voluntary_exits", "involuntary_exits", "absconding_exits", "unclassified_exits", "exits_0_30", "exits_31_90", "exits_91_180", "exits_180_plus", "early_attrition_pct", "not_joined", "notice_hc", "pending_resignations", "lwd_next_30", "risk_high", "risk_medium", "risk_avg"],
    trend: [{ key: "exits", label: "Exits", color: C.rose }, { key: "joiners", label: "Joiners", color: C.green }],
  },
  {
    id: "hiring", label: "Headcount & Hiring",
    blurb: "Opening to closing headcount, joiners, mandate gap and open requisitions.",
    kpis: ["hc_closing", "mandate_hc", "mandate_gap", "open_positions", "joiners", "backfill_need"],
    columns: ["hc_opening", "hc_closing", "joiners", "new_joiner_hc", "mandate_hc", "mandate_gap", "mandate_fill_pct", "open_positions", "urgent_positions", "overdue_positions", "notice_hc", "backfill_need"],
    trend: [{ key: "joiners", label: "Joiners", color: C.green }, { key: "exits", label: "Exits", color: C.rose }],
  },
  { id: "performance", label: "Process Performance", blurb: "Client / process KPIs (AHT, SL, occupancy, conversion, quality) with target attainment.", kpis: [], columns: [] },
  {
    id: "quality", label: "Quality & Risk",
    blurb: "Call quality, fatals, conduct (warnings, PIPs) and training risk.",
    kpis: ["qa_score_pct", "qa_fatal_pct", "manual_qa_score_pct", "warnings_active", "pip_active", "training_at_risk"],
    columns: ["qa_audits", "qa_score_pct", "qa_fatal", "qa_fatal_pct", "manual_qa_score_pct", "warnings_active", "warnings_final", "pip_active", "training_learners", "training_at_risk", "training_ready_pct", "avg_readiness"],
  },
  {
    id: "live", label: "Live Today",
    blurb: "Today's roster against actual login, plus break behaviour. Not affected by the period filter.",
    kpis: ["live_planned", "live_logged_in", "live_not_in", "live_login_pct", "live_on_break", "avg_break_minutes"],
    columns: ["live_planned", "live_logged_in", "live_logged_out", "live_not_in", "live_login_pct", "live_on_break", "avg_break_minutes", "break_exceeded_days", "break_no_punch_days"],
  },
];

export const DIMENSIONS: Array<{ id: OpsDimension; label: string }> = [
  { id: "branch", label: "Branch" },
  { id: "process", label: "Process" },
  { id: "lob", label: "LOB" },
  { id: "manager", label: "Team / Manager" },
  { id: "employee", label: "Analyst" },
];

/** The natural drill order. Clicking a row filters by its id and moves to the next dimension. */
export const NEXT_DIM: Record<OpsDimension, OpsDimension> = {
  all: "branch", branch: "process", process: "manager", lob: "manager", manager: "employee", employee: "employee",
};
