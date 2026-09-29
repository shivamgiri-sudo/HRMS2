/**
 * Operations Command — the ONE place metric logic is defined.
 *
 * Every number on /operations-dashboard is computed by ops-command.domains.ts using
 * the formulas documented here, and this catalogue is served to the UI (GET /definitions)
 * so a reader can see the exact formula behind any column.
 *
 * Attribution rule (all domains): a fact row belongs to the employee's CURRENT
 * branch / process / LOB / reporting manager (employees.*), because that is the same
 * key the row-scope filter uses — so what a user may see and where it is counted agree.
 */

export type OpsDomain =
  | "headcount"
  | "attendance"
  | "shrinkage"
  | "roster"
  | "attrition"
  | "hiring"
  | "quality"
  | "conduct"
  | "training"
  | "risk"
  | "breaks"
  | "live";

export type OpsUnit = "count" | "pct" | "hours" | "minutes" | "days";
export type OpsDirection = "higher_is_better" | "lower_is_better" | "neutral";

/** Drill-through list a metric cell opens (see ops-command.records.ts). */
export type OpsRecordDomain =
  | "headcount"
  | "joiners"
  | "exits"
  | "notice"
  | "absent"
  | "late"
  | "unrostered"
  | "warnings"
  | "pip"
  | "training_risk"
  | "low_quality"
  | "at_risk";

export interface OpsMetricDef {
  id: string;
  label: string;
  domain: OpsDomain;
  unit: OpsUnit;
  direction: OpsDirection;
  formula: string;
  /** warn / bad thresholds on the displayed value (direction decides which side is bad). */
  warn?: number;
  bad?: number;
  records?: OpsRecordDomain;
}

export const OPS_METRICS: OpsMetricDef[] = [
  // ── Headcount ─────────────────────────────────────────────────────────────
  { id: "hc_closing", label: "Headcount", domain: "headcount", unit: "count", direction: "neutral", records: "headcount",
    formula: "Employees active on the period end date: joined on/before it and not exited on/before it (date_of_exit / date_of_leaving)." },
  { id: "hc_opening", label: "Opening HC", domain: "headcount", unit: "count", direction: "neutral",
    formula: "Employees active the day before the period starts." },
  { id: "hc_avg", label: "Average HC", domain: "headcount", unit: "count", direction: "neutral",
    formula: "(Opening HC + Closing HC) / 2 — the denominator for attrition." },
  { id: "joiners", label: "Joiners", domain: "headcount", unit: "count", direction: "higher_is_better", records: "joiners",
    formula: "Employees whose date_of_joining falls inside the period (excludes did-not-join)." },
  { id: "new_joiner_hc", label: "In first 90 days", domain: "headcount", unit: "count", direction: "neutral",
    formula: "Closing HC with tenure of 90 days or less on the period end date." },
  { id: "mandate_hc", label: "Mandated HC", domain: "headcount", unit: "count", direction: "neutral",
    formula: "SUM(workforce_mandate.mandated_hc) for rows effective on the period end (process / branch grain only)." },
  { id: "mandate_gap", label: "Gap to mandate", domain: "headcount", unit: "count", direction: "lower_is_better",
    formula: "Mandated HC − Closing HC. Positive = short of mandate." },
  { id: "mandate_fill_pct", label: "Mandate fill", domain: "headcount", unit: "pct", direction: "higher_is_better", warn: 95, bad: 85,
    formula: "Closing HC / Mandated HC × 100." },

  // ── Attendance ────────────────────────────────────────────────────────────
  { id: "attendance_pct", label: "Attendance %", domain: "attendance", unit: "pct", direction: "higher_is_better", warn: 90, bad: 80,
    formula: "(present + ½ × half_day) / (scheduled days − approved-leave days) × 100, from attendance_daily_record." },
  { id: "scheduled_days", label: "Scheduled days", domain: "attendance", unit: "days", direction: "neutral",
    formula: "Attendance rows excluding week_off, holiday and week_off_worked. This is the denominator shared by attendance and shrinkage." },
  { id: "present_days", label: "Present days", domain: "attendance", unit: "days", direction: "higher_is_better",
    formula: "Rows with attendance_status = present." },
  { id: "absent_days", label: "Absent days", domain: "attendance", unit: "days", direction: "lower_is_better", records: "absent",
    formula: "Rows with attendance_status = absent." },
  { id: "absent_pct", label: "Absent %", domain: "attendance", unit: "pct", direction: "lower_is_better", warn: 8, bad: 15, records: "absent",
    formula: "Absent days / scheduled days × 100." },
  { id: "half_days", label: "Half days", domain: "attendance", unit: "days", direction: "lower_is_better",
    formula: "Rows with attendance_status = half_day." },
  { id: "leave_days", label: "Approved leave days", domain: "attendance", unit: "days", direction: "neutral",
    formula: "Rows with attendance_status = leave_approved." },
  { id: "missing_punch_days", label: "Missing punch days", domain: "attendance", unit: "days", direction: "lower_is_better",
    formula: "Rows with attendance_status = missing_punch or unreconciled (no usable punch)." },
  { id: "late_marks", label: "Late marks", domain: "attendance", unit: "count", direction: "lower_is_better", records: "late",
    formula: "Rows with late_mark = 1 (clock-in later than shift start + grace; dialler staff are never late-marked)." },
  { id: "late_pct", label: "Late %", domain: "attendance", unit: "pct", direction: "lower_is_better", warn: 8, bad: 15, records: "late",
    formula: "Late marks / days worked (present + half_day) × 100." },
  { id: "avg_login_hours", label: "Avg login hrs / day", domain: "attendance", unit: "hours", direction: "higher_is_better",
    formula: "AVG(COALESCE(raw_minutes, biometric_minutes, dialler_minutes)) / 60 over days worked." },
  { id: "open_mismatches", label: "Open mismatches", domain: "attendance", unit: "count", direction: "lower_is_better",
    formula: "Rows with mismatch_flag = 1 and no mismatch_resolved_at (attendance hygiene)." },

  // ── Shrinkage ─────────────────────────────────────────────────────────────
  { id: "shrinkage_pct", label: "Shrinkage %", domain: "shrinkage", unit: "pct", direction: "lower_is_better", warn: 15, bad: 25, records: "absent",
    formula: "(leave + absent + missing/unreconciled + ½ × half_day) / scheduled days × 100  =  100 − (present + ½ half_day) / scheduled days. Planned + Unplanned." },
  { id: "planned_shrinkage_pct", label: "Planned shrinkage %", domain: "shrinkage", unit: "pct", direction: "neutral",
    formula: "Approved-leave days / scheduled days × 100." },
  { id: "unplanned_shrinkage_pct", label: "Unplanned shrinkage %", domain: "shrinkage", unit: "pct", direction: "lower_is_better", warn: 8, bad: 15,
    formula: "(absent + missing/unreconciled + ½ × half_day) / scheduled days × 100." },
  { id: "missing_punch_pct", label: "Missing punch %", domain: "shrinkage", unit: "pct", direction: "lower_is_better", warn: 5, bad: 15,
    formula: "(missing_punch + unreconciled days) / scheduled days × 100. These days have no usable punch and are counted as loss inside Unplanned shrinkage — a high value usually means an attendance-sync / punch problem, not people staying away." },
  { id: "absence_shrinkage_pct", label: "Absence shrinkage %", domain: "shrinkage", unit: "pct", direction: "lower_is_better", warn: 8, bad: 15, records: "absent",
    formula: "(absent + ½ × half_day) / scheduled days × 100 — unplanned shrinkage excluding missing punches." },
  { id: "shrinkage_mandate_pct", label: "Shrinkage budget", domain: "shrinkage", unit: "pct", direction: "neutral",
    formula: "Mandate-weighted workforce_mandate.shrinkage_pct — the budget the actual is judged against (process / branch grain)." },

  // ── Roster ────────────────────────────────────────────────────────────────
  { id: "rostered_days", label: "Rostered shifts", domain: "roster", unit: "days", direction: "neutral",
    formula: "wfm_roster_assignment rows (real roster only) that are working shifts — not week-off / holiday / leave." },
  { id: "rostered_hours", label: "Rostered hours", domain: "roster", unit: "hours", direction: "neutral",
    formula: "SUM(scheduled_minutes) / 60 of working shifts." },
  { id: "weekoff_days", label: "Week-off days", domain: "roster", unit: "days", direction: "neutral",
    formula: "Roster rows flagged is_week_off or assignment_type WEEK_OFF." },
  { id: "training_days", label: "Training days", domain: "roster", unit: "days", direction: "neutral",
    formula: "Roster rows with assignment_type = TRAINING." },
  { id: "roster_coverage_pct", label: "Roster coverage", domain: "roster", unit: "pct", direction: "higher_is_better", warn: 98, bad: 90, records: "unrostered",
    formula: "Employees with at least one roster row in the period / Closing HC × 100. Below 100 = people with no roster." },
  { id: "roster_published_pct", label: "Published %", domain: "roster", unit: "pct", direction: "higher_is_better", warn: 95, bad: 80,
    formula: "Working shifts with publish_status = published / rostered shifts × 100." },
  { id: "ack_pending", label: "Ack pending", domain: "roster", unit: "count", direction: "lower_is_better",
    formula: "Working shifts still awaiting employee acknowledgement (employee_ack_status = pending)." },
  { id: "ack_rejected", label: "Ack rejected", domain: "roster", unit: "count", direction: "lower_is_better",
    formula: "Working shifts the employee rejected (employee_ack_status = rejected)." },
  { id: "roster_adherence_pct", label: "Roster adherence", domain: "roster", unit: "pct", direction: "higher_is_better", warn: 92, bad: 85,
    formula: "Rostered working days on which the person worked (present / half_day / week_off_worked) / rostered working days that have already fallen due × 100." },
  { id: "cycles_open", label: "Roster cycles not published", domain: "roster", unit: "count", direction: "lower_is_better",
    formula: "weekly_roster_cycle rows overlapping the period still in draft / submitted / reviewed (process / branch grain)." },
  { id: "demand_shortage_slots", label: "Demand shortage slots", domain: "roster", unit: "count", direction: "lower_is_better",
    formula: "wfm_slot_requirement rows in the period with coverage_status = shortage (roster short of required planned HC)." },

  // ── Attrition ─────────────────────────────────────────────────────────────
  { id: "exits", label: "Exits", domain: "attrition", unit: "count", direction: "lower_is_better", records: "exits",
    formula: "Employees whose exit date (date_of_exit, else date_of_leaving) is inside the period, excluding did-not-join." },
  { id: "attrition_pct", label: "Attrition %", domain: "attrition", unit: "pct", direction: "lower_is_better", warn: 4, bad: 8, records: "exits",
    formula: "Exits / Average HC × 100 for the selected period. Shown only when Average HC is at least 10 — a rate on a handful of people is not meaningful (use the Exits count)." },
  { id: "attrition_annualised_pct", label: "Annualised attrition %", domain: "attrition", unit: "pct", direction: "lower_is_better", warn: 40, bad: 80,
    formula: "Attrition % × 365 / days in period." },
  { id: "voluntary_exits", label: "Voluntary", domain: "attrition", unit: "count", direction: "lower_is_better", records: "exits",
    formula: "Exits whose exit_request.exit_type = voluntary." },
  { id: "involuntary_exits", label: "Involuntary", domain: "attrition", unit: "count", direction: "lower_is_better", records: "exits",
    formula: "Exits whose exit_request.exit_type = involuntary (termination etc.)." },
  { id: "absconding_exits", label: "Absconding", domain: "attrition", unit: "count", direction: "lower_is_better", records: "exits",
    formula: "Exit type absconding, sub-type absconding/abandonment, or employment_status absconded." },
  { id: "unclassified_exits", label: "Unclassified exits", domain: "attrition", unit: "count", direction: "neutral", records: "exits",
    formula: "Exits with no exit_request type on file (legacy / direct deactivation)." },
  { id: "exits_0_30", label: "Exits ≤30d tenure", domain: "attrition", unit: "count", direction: "lower_is_better", records: "exits",
    formula: "Exits where exit date − joining date is 0–30 days." },
  { id: "exits_31_90", label: "Exits 31–90d tenure", domain: "attrition", unit: "count", direction: "lower_is_better", records: "exits",
    formula: "Exits where exit date − joining date is 31–90 days." },
  { id: "exits_91_180", label: "Exits 91–180d tenure", domain: "attrition", unit: "count", direction: "lower_is_better", records: "exits",
    formula: "Exits where exit date − joining date is 91–180 days." },
  { id: "exits_180_plus", label: "Exits >180d tenure", domain: "attrition", unit: "count", direction: "neutral", records: "exits",
    formula: "Exits with more than 180 days tenure." },
  { id: "early_attrition_pct", label: "Early attrition %", domain: "attrition", unit: "pct", direction: "lower_is_better", warn: 30, bad: 50, records: "exits",
    formula: "Exits with ≤90 days tenure / all exits × 100." },
  { id: "not_joined", label: "Did not join", domain: "attrition", unit: "count", direction: "lower_is_better",
    formula: "Employees with employment_status = not_joined dated inside the period (offer drop-outs)." },
  { id: "notice_hc", label: "On notice", domain: "attrition", unit: "count", direction: "lower_is_better", records: "notice",
    formula: "Active employees whose exit_request is accepted / notice_serving / notice_active (as of today)." },
  { id: "pending_resignations", label: "Resignations pending review", domain: "attrition", unit: "count", direction: "lower_is_better", records: "notice",
    formula: "Active employees whose exit_request is submitted / manager_review / hr_review / admin_review." },
  { id: "lwd_next_30", label: "LWD in next 30 days", domain: "attrition", unit: "count", direction: "lower_is_better", records: "notice",
    formula: "Open exit requests whose confirmed last working day falls in the next 30 days." },

  // ── Hiring ────────────────────────────────────────────────────────────────
  { id: "open_positions", label: "Open positions", domain: "hiring", unit: "count", direction: "lower_is_better",
    formula: "Approved, active job_requisition: requested_headcount − fulfilled_headcount (floored at 0). Process / branch grain." },
  { id: "urgent_positions", label: "High / urgent open", domain: "hiring", unit: "count", direction: "lower_is_better",
    formula: "Open positions on requisitions with priority high or urgent." },
  { id: "overdue_positions", label: "Past target date", domain: "hiring", unit: "count", direction: "lower_is_better",
    formula: "Open positions whose target_joining_date is already past." },
  { id: "backfill_need", label: "Backfill need", domain: "hiring", unit: "count", direction: "lower_is_better",
    formula: "MAX(0, mandate gap) + on-notice HC — people to hire to stay at mandate once notice-servers leave." },

  // ── Quality ───────────────────────────────────────────────────────────────
  { id: "qa_score_pct", label: "Quality score", domain: "quality", unit: "pct", direction: "higher_is_better", warn: 85, bad: 75, records: "low_quality",
    formula: "Audit-weighted: SUM(quality_percentage) / COUNT(audits) from db_audit.call_quality_assessment (matched on employee_code) in the period." },
  { id: "qa_audits", label: "Audited calls", domain: "quality", unit: "count", direction: "neutral",
    formula: "Number of assessed calls in the period." },
  { id: "qa_fatal", label: "Fatal calls", domain: "quality", unit: "count", direction: "lower_is_better", records: "low_quality",
    formula: "Assessed calls scoring quality_percentage = 0." },
  { id: "qa_fatal_pct", label: "Fatal %", domain: "quality", unit: "pct", direction: "lower_is_better", warn: 2, bad: 5, records: "low_quality",
    formula: "Fatal calls / audited calls × 100." },
  { id: "manual_qa_score_pct", label: "Manual audit score", domain: "quality", unit: "pct", direction: "higher_is_better", warn: 85, bad: 75,
    formula: "AVG(qa_audit.quality_percentage) over submitted / calibrated / closed manual audits in the period." },

  // ── Conduct & training ────────────────────────────────────────────────────
  { id: "warnings_active", label: "Active warnings", domain: "conduct", unit: "count", direction: "lower_is_better", records: "warnings",
    formula: "employee_warning rows with status = active and warning_date in the period." },
  { id: "warnings_final", label: "Final warnings", domain: "conduct", unit: "count", direction: "lower_is_better", records: "warnings",
    formula: "Active warnings with severity = final." },
  { id: "pip_active", label: "Active PIPs", domain: "conduct", unit: "count", direction: "lower_is_better", records: "pip",
    formula: "pip_record rows with status = active (as of today)." },
  { id: "training_learners", label: "Learners (LMS)", domain: "training", unit: "count", direction: "neutral",
    formula: "Employees with a synced LMS progress row (lms_learner_progress)." },
  { id: "training_at_risk", label: "Training at risk", domain: "training", unit: "count", direction: "lower_is_better", records: "training_risk",
    formula: "Learners with attrition_risk_signal = red (best MCQ below 60%)." },
  { id: "training_ready_pct", label: "Handover-ready %", domain: "training", unit: "pct", direction: "higher_is_better", warn: 70, bad: 50,
    formula: "Learners with ops_handover_ready = 1 / learners × 100." },
  { id: "avg_readiness", label: "Avg readiness score", domain: "training", unit: "pct", direction: "higher_is_better", warn: 70, bad: 60,
    formula: "AVG(lms_learner_progress.readiness_score)." },

  // ── Agent risk ────────────────────────────────────────────────────────────
  { id: "risk_high", label: "High-risk agents", domain: "risk", unit: "count", direction: "lower_is_better", records: "at_risk",
    formula: "Active employees with risk score ≥ 65. Score (0–100) adds: absence rate × 1.6 (max 40), late rate × 0.4 (max 15), final warning 15 / any warning 8, active PIP 15, open notice 30 / pending resignation 22, tenure ≤30d 12 / ≤90d 6, audit average <70% (3+ audits) 10, LMS red signal 10. Missing punches are deliberately NOT scored (a feed problem, not behaviour)." },
  { id: "risk_medium", label: "Medium-risk agents", domain: "risk", unit: "count", direction: "lower_is_better", records: "at_risk",
    formula: "Active employees with risk score 45–64 (same score as High-risk agents)." },
  { id: "risk_avg", label: "Avg risk score", domain: "risk", unit: "count", direction: "lower_is_better",
    formula: "Mean risk score of active employees in the group." },

  // ── Breaks ────────────────────────────────────────────────────────────────
  { id: "avg_break_minutes", label: "Avg break min / day", domain: "breaks", unit: "minutes", direction: "lower_is_better", warn: 60, bad: 75,
    formula: "AVG(break_daily_summary.total_break_minutes) over employee-days with any break." },
  { id: "break_exceeded_days", label: "Break-exceeded days", domain: "breaks", unit: "count", direction: "lower_is_better",
    formula: "Employee-days with exceeded_break_count > 0." },
  { id: "break_no_punch_days", label: "Break, no punch days", domain: "breaks", unit: "count", direction: "lower_is_better",
    formula: "Employee-days where final_status = No Punch Found." },

  // ── Live (today) ──────────────────────────────────────────────────────────
  { id: "live_planned", label: "Planned today", domain: "live", unit: "count", direction: "neutral",
    formula: "Employees with a working roster row today." },
  { id: "live_logged_in", label: "Logged in", domain: "live", unit: "count", direction: "neutral",
    formula: "Rostered employees with a wfm_attendance_session today in Logged In / Partial." },
  { id: "live_logged_out", label: "Logged out", domain: "live", unit: "count", direction: "neutral",
    formula: "Rostered employees whose session today is Logged Out." },
  { id: "live_not_in", label: "Not logged in", domain: "live", unit: "count", direction: "lower_is_better",
    formula: "Planned today − logged in − logged out (no session yet)." },
  { id: "live_on_break", label: "On break now", domain: "live", unit: "count", direction: "neutral",
    formula: "break_sessions with status ACTIVE today." },
  { id: "live_login_pct", label: "Login % vs roster", domain: "live", unit: "pct", direction: "higher_is_better", warn: 90, bad: 75,
    formula: "(logged in + logged out) / planned today × 100." },
];

export const OPS_METRIC_BY_ID = new Map(OPS_METRICS.map((m) => [m.id, m]));

/** Attendance statuses. Shared constants live in shared/attendanceStatus.ts; these are the
 *  exact SQL sets Operations Command builds its two denominators from. */
export const SQL_NOT_SCHEDULED = `('week_off','holiday','week_off_worked')`;
export const SQL_WORKED = `('present','half_day','week_off_worked')`;

export const EXIT_OPEN_STATUSES = ["accepted", "notice_serving", "notice_active"] as const;
export const EXIT_PENDING_STATUSES = ["submitted", "manager_review", "hr_review", "admin_review"] as const;
export const EXIT_IGNORED_STATUSES = ["draft", "rejected", "revoked", "withdrawn"] as const;

/** Quality bands used for tone on the Quality tab. */
export const QA_TARGET_PCT = 85;

/** Headline process metrics shown first on the Performance tab, in this order, when present. */
export const PERFORMANCE_HEADLINE_KEYS = [
  "AHT", "INBOUND_SL_PCT", "INBOUND_AL_PCT", "OUTBOUND_CONNECT_PCT", "AGENT_OCCUPANCY_PCT",
  "AGENT_UTILISATION_PCT", "SHRINKAGE_PCT", "PROC_ATTENDANCE_PCT", "FUNNEL_SALE_PCT", "SALES_COUNT",
  "QA_QUALITY_PCT",
];
