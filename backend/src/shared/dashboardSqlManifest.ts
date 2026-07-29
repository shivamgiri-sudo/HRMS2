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
    usedBy: "modules/dashboards/dashboard.routes.ts",
    table: "work_item",
    columns: ["assigned_to_user_id", "assigned_to_role", "status", "due_at"],
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

  // ── Tables the audit script expects to exist ───────────────────────────────
  {
    usedBy: "scripts/dashboard-data-audit.ts (REQUIRED_TABLES)",
    table: "statutory_filing_tracker",
    columns: [],
    optional: true,
    note: "Listed in REQUIRED_TABLES but exists in neither the migrations nor production.",
  },
];
