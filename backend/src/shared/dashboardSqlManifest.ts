/**
 * Declares the table/column surface that dashboard SQL depends on.
 *
 * This is checked two ways:
 *  - offline, against the parsed `backend/sql/*.sql` migrations
 *    (`dashboard-sql-schema-contract.test.ts`)
 *  - online, against live `information_schema`
 *    (`npm run dashboard:audit -- --schema`)
 *
 * Keep an entry here whenever dashboard code adds a column reference. The cost of a
 * stale manifest is a missed bug; the cost of omitting it entirely has already been
 * three audit cycles that failed to spot a hard 500 and a permanently empty panel.
 */

export type SqlDependency = {
  /** Source file that issues the query, for the failure message. */
  readonly usedBy: string;
  readonly table: string;
  readonly columns: readonly string[];
  /** Set when the table is legitimately absent and the code must tolerate that. */
  readonly optional?: boolean;
  readonly note?: string;
};

export const DASHBOARD_SQL_MANIFEST: readonly SqlDependency[] = [
  // ── Core dashboard summary + metrics ───────────────────────────────────────
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts",
    table: "employees",
    columns: [
      "id", "active_status", "employment_status", "branch_id", "process_id",
      "reporting_manager_id", "manager_id", "user_id",
    ],
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts",
    table: "attendance_daily_record",
    columns: ["employee_id", "record_date", "attendance_status", "late_mark"],
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts",
    table: "wfm_attendance_session",
    columns: ["employee_id", "session_date", "current_status"],
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts",
    table: "ats_onboarding_bridge",
    columns: ["id", "candidate_id", "status"],
    note:
      "bridge_status / branch_id / process_id were queried here but exist on neither " +
      "this table nor any migration, so the ONBOARDING metric failed on every CEO, HR " +
      "and Recruiter dashboard. Scope now routes via ats_candidate.applied_for_*.",
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts (onboarding scope join)",
    table: "ats_candidate",
    columns: ["id", "applied_for_branch", "applied_for_process"],
    note: "applied_for_* hold branch/process NAMES, not FK ids — join on *_master name.",
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts (onboarding scope join)",
    table: "branch_master",
    columns: ["id", "branch_name"],
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts (onboarding scope join)",
    table: "process_master",
    columns: ["id", "process_name"],
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts",
    table: "candidate_onboarding_profile",
    columns: ["otp_verified"],
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts",
    table: "exit_request",
    columns: ["id"],
  },
  {
    usedBy: "modules/work-inbox/work-inbox.service.ts (getUnifiedInboxSummary)",
    table: "work_item",
    columns: [
      "assigned_to_user_id", "assigned_to_role", "status", "due_at", "item_type",
      "priority", "created_at",
    ],
  },
  {
    usedBy: "modules/work-inbox/work-inbox.service.ts (getUnifiedInboxSummary)",
    table: "work_inbox_item",
    columns: ["user_id", "type", "priority", "is_read", "is_actioned", "action_url", "created_at"],
    note:
      "The second of two work-inbox tables, both actively written. Dashboards read only " +
      "work_item (2 rows) while this one holds 65k and grows continuously, so every " +
      "dashboard showed an empty inbox. Has no branch_id/process_id and no due_at, so it " +
      "is addressable per-user only and its rows can never be counted as overdue.",
  },
  {
    usedBy: "modules/dashboards/dashboard.routes.ts (root-causes)",
    table: "ats_onboarding_bridge",
    columns: ["id", "candidate_id", "status", "bridge_date", "created_at"],
    note:
      "root-causes queried bridge_status, branch_id, process_id and updated_at — none of " +
      "which exist here — so the panel threw ER_BAD_FIELD_ERROR on all 12 dashboards. " +
      "bridge_date and created_at are the only dates on this table.",
  },
  {
    usedBy: "modules/dashboards/dashboard.routes.ts (root-causes)",
    table: "ats_candidate",
    columns: ["id", "full_name"],
    note: "first_name / last_name were queried here but the column is full_name.",
  },

  // ── Payroll operational summary (B1: this shipped 6 nonexistent columns) ────
  {
    usedBy: "modules/dashboards/dashboard.routes.ts (PAYROLL_HR_DASHBOARD/operational-summary)",
    table: "salary_prep_run",
    columns: [
      "id", "run_month", "status", "branch_filter", "total_employees",
      "created_at", "auto_closed_at", "attendance_snapshot_locked", "tds_mode",
    ],
    note:
      "run_label and closed_at were queried here but exist in no migration. " +
      "attendance_snapshot_locked comes from 391_, which the runner does not source " +
      "even though production has it applied.",
  },
  {
    usedBy: "modules/dashboards/dashboard.routes.ts (PAYROLL_HR_DASHBOARD/operational-summary)",
    table: "salary_prep_line",
    columns: [
      "run_id", "employee_id", "gross_salary", "net_salary", "total_deductions",
      "pf_employer", "esic_employer",
    ],
    note: "gross_pay / gross_amount / net_pay / net_amount were queried but never existed.",
  },

  // ── KPI org summary (B2: 3 nonexistent columns, error swallowed) ───────────
  {
    usedBy: "modules/kpi/kpi.routes.ts (org-summary)",
    table: "kpi_daily_actual",
    columns: ["employee_id", "metric_id", "score_date", "actual_value"],
    note:
      "score_pct / process_id / record_date were queried here but do not exist. " +
      "process_id_at_event exists but is 0% populated, so per-process grouping must " +
      "join employees.process_id instead.",
  },
  {
    usedBy: "modules/kpi/kpi.routes.ts (org-summary)",
    table: "kpi_metric_master",
    columns: ["id", "metric_name", "unit"],
  },

  // ── Scope resolution ───────────────────────────────────────────────────────
  {
    usedBy: "shared/dashboardScope.ts",
    table: "user_assignment_scope",
    columns: ["user_id", "role_key", "scope_type", "branch_id", "process_id", "manager_employee_id", "active_status"],
  },
  {
    usedBy: "shared/dashboardScope.ts",
    table: "branch_master",
    columns: ["id", "active_status"],
  },
  {
    usedBy: "shared/dashboardScope.ts",
    table: "process_master",
    columns: ["id", "active_status"],
  },
  {
    usedBy: "shared/roleResolver.ts",
    table: "user_roles",
    columns: ["user_id", "role_key", "active_status"],
  },

  // ── Management / CEO ───────────────────────────────────────────────────────
  {
    usedBy: "modules/management/management.routes.ts",
    table: "kpi_daily_actual",
    columns: ["score_date", "actual_value"],
  },

  // ── IT manager dashboard ───────────────────────────────────────────────────
  {
    usedBy: "modules/it-provisioning/it-provisioning.routes.ts",
    table: "it_provisioning_request",
    columns: ["employee_id", "request_type", "status", "sla_due_at", "assigned_role"],
  },

  // ── Metric trend / target enrichment ───────────────────────────────────────
  {
    usedBy: "modules/dashboards/dashboard-target.service.ts + dashboard.routes.ts (trend)",
    table: "dashboard_metric_snapshot",
    columns: ["metric_code", "scope_type", "scope_id", "snapshot_date", "value", "previous_value", "trend"],
    note:
      "Queried as metric_value / metric_status / dashboard_code / role_code / branch_id / " +
      "process_id — six columns this table has never had. Result: the trend endpoint 500'd " +
      "for every metric and previousValue/variancePct were null on all 38 metric instances, " +
      "so no dashboard tile could show a period-on-period arrow. The table is also never " +
      "written to; an empty series is expected until a snapshot writer exists.",
  },
  {
    usedBy: "modules/dashboards/dashboard.routes.ts (:dashboardCode/metrics)",
    table: "dashboard_metric_catalog",
    columns: ["metric_code", "metric_name", "unit", "higher_is_better", "is_active"],
    note: "Unseeded in production, so /metrics returns [] and no metric has a target.",
  },
  {
    usedBy: "modules/dashboards/dashboard-target.service.ts",
    table: "dashboard_role_metric_config",
    columns: ["role_code", "dashboard_code", "metric_code", "display_order", "is_primary", "scope_level"],
  },

  // ── New metric sources (each column verified against live information_schema) ──
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts (ATTENDANCE_EXCEPTIONS)",
    table: "attendance_reconciliation_issue",
    columns: [
      "id", "issue_date", "employee_id", "employee_code", "issue_type", "severity",
      "resolved_at", "auto_fix_status",
    ],
    note:
      "Has NO created_at and NO status column — the date is issue_date and open-ness is " +
      "resolved_at IS NULL. 996 of 4,389 rows in a 30-day window carry no employee_id " +
      "(mostly unmapped_cosec_user) and so cannot be branch-scoped.",
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts (DOC_COMPLIANCE)",
    table: "employee_documents",
    columns: ["employee_id", "verified", "expiry_date"],
    note:
      "The verification flag is `verified` (tinyint), not verification_status. " +
      "expiry_date is 0% populated for active employees, so expiry is deliberately not " +
      "reported — it would be a permanent zero.",
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts (BIOMETRIC_ACTIVITY)",
    table: "integration_biometric_daily",
    columns: [
      "employee_code", "activity_date", "first_punch", "last_punch", "total_punches",
      "biometric_minutes",
    ],
    note:
      "Keyed by employee_code, not employee_id, and the date is activity_date not " +
      "attendance_date. Used in place of cosec_punch_sync, which holds 3.19M rows but " +
      "has not been written since 2026-06-18.",
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts (SALARY_COMPONENTS)",
    table: "salary_prep_line_component",
    columns: [
      "run_id", "line_id", "employee_id", "component_code", "component_name",
      "component_type", "amount", "taxable",
    ],
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts (RECRUITER_ACTIVITY)",
    table: "ats_recruiter_hiring_activity",
    columns: [
      "activity_date", "recruiter_name_snapshot", "branch_name", "process_name",
      "contacted_flag", "walkin_flag", "hr_interview_status", "final_selection_flag",
      "joined_flag",
    ],
    note:
      "recruiter_employee_id / recruiter_id / recruiter_code are each populated on only " +
      "10 of 16,857 rows, so grouping or scoping by them would discard 99.94% of the " +
      "data. Only recruiter_name_snapshot is fully populated, and it is a name not an " +
      "FK — scope therefore routes via branch_name/process_name joined by name. " +
      "offer_letter_status is 100% NULL and is not reported.",
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts (TRAINING_PROGRESS)",
    table: "lms_learning_progress_snapshot",
    columns: ["employee_id", "course_id", "course_name", "completion_pct", "score", "status", "synced_at"],
    note:
      "The synced copy inside mas_hrms. Read here so the deployed LMS stays the system " +
      "of record and is never queried directly (CLAUDE.md LMS boundary).",
  },
  {
    usedBy: "modules/dashboards/dashboard-metric.service.ts (LEAVE_APPROVALS)",
    table: "leave_request",
    columns: [
      "id", "employee_id", "status", "from_date", "to_date", "total_days", "applied_at",
      "leave_type_id", "requires_branch_head_approval",
    ],
    note:
      "Leave type resolves via leave_type_id -> leave_type_master, NOT the legacy " +
      "leave_request.leave_type_code: that column is 0% populated and is only defined in " +
      "064_leave_legacy_sync.sql, which 000_run_all.sql does not source because " +
      "064_leave_type_updated_at.sql shares its numeric prefix.",
  },
  {
    usedBy: "modules/dashboards/dashboard-drilldown.service.ts (LEAVE_APPROVALS)",
    table: "leave_type_master",
    columns: ["id", "leave_code", "leave_name"],
  },

  // ── Tables the audit script expects to exist ───────────────────────────────
  {
    usedBy: "scripts/dashboard-data-audit.ts (REQUIRED_TABLES)",
    table: "statutory_filing_tracker",
    columns: [],
    optional: true,
    note: "Listed in REQUIRED_TABLES but exists in neither the migrations nor production.",
  },
];
