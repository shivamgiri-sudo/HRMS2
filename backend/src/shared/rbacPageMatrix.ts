export const COMMON_USER_PAGE_CODES = [
  "MY_PROFILE",
  "WORK_INBOX",
  "EMPLOYEE_SELF_DASHBOARD",
  "EMPLOYEE_STAT_CARD",
  "ATTENDANCE_REGULARIZATION",
  "PAYROLL_PAYSLIPS",
  "TAX_DECLARATION",
  "MY_EXPENSES",
  "EXPENSE_CREATE",
  "LMS_MY_LEARNING",
  "MY_KPI",
  "RESIGNATION_MY_REQUEST",
  "DPDP_WITHDRAWAL",
] as const;

export const ROLE_DASHBOARD_PAGE_CODES = [
  "CEO_DASHBOARD",
  "PAYROLL_HR_DASHBOARD",
  "WFM_DASHBOARD",
  "WFM_ATTENDANCE_DASHBOARD",
  "HR_DASHBOARD",
  "QUALITY_DASHBOARD",
  "OPERATIONS_DASHBOARD",
  "RECRUITER_DASHBOARD",
  "IT_MANAGER_DASHBOARD",
  "MANAGEMENT_DASHBOARD",
  "EMPLOYEE_SELF_DASHBOARD",
  "SUPER_ADMIN_DASHBOARD",
] as const;

export const ROLE_SPECIFIC_PAGE_CODES = {
  admin: [
    "ACCESS_CONTROL",
    "ATTENDANCE_DISPUTES",
    "MODULE_ACCESS",
    "SECURITY_CENTER",
    "AUDIT_LOG",
    "CUSTOMIZATION_MANAGER",
    "INTEGRATION_HUB",
    "WORKFLOW_ADMIN",
    "ORG_MASTERS",
    "PROCESS_CONFIG",
    "CLIENT_MASTER",
    "EMAIL_TEMPLATE_BULK_IMPORT",
    "MIGRATION_CONSOLE",
    "ADVANCED_REPORTS",
  ],
  hr: [
    "HR_DASHBOARD",
    "EMPLOYEE_MANAGEMENT",
    "ATTENDANCE_DISPUTES",
    "EMPLOYEE_LIFECYCLE",
    "ORG_CHART",
    "LEAVE_MANAGEMENT",
    "LEAVE_TYPES",
    "LETTERS",
    "APPOINTMENT_ESIGN",
    "BENEFITS",
    "CAREER_PLANNING",
    "PIP_MANAGEMENT",
    "ATS_DASHBOARD",
    "ATS_CANDIDATE_MASTER",
    "ATS_WAITING_QUEUE",
    "ATS_ONBOARDING_BRIDGE",
    "ATS_ONBOARDING_REQUESTS",
    "ATS_JOINING_DOCUMENTS_TRACKER",
    "ATS_OFFER",
    "ATS_OFFER_APPROVALS",
    "ATS_BGV",
    "ATS_BGV_REPORT",
    "BULK_UPLOAD",
    "STATUTORY_COMPLIANCE",
    "LABOUR_COMPLIANCE",
    "DPDP_COMPLIANCE",
    "DPDP_WITHDRAWAL_ADMIN",
  ],
  recruiter: [
    "RECRUITER_DASHBOARD",
    "ATS_DASHBOARD",
    "ATS_RECRUITER_QUEUE",
    "ATS_RECRUITER_WORKSPACE",
    "ATS_RECRUITER_PORTAL",
    "ATS_WAITING_QUEUE",
    "ATS_CANDIDATE_MASTER",
    "ATS_WALKIN_QUEUE",
    "ATS_EXTENSIONS",
  ],
  manager: [
    "MANAGEMENT_DASHBOARD",
    "ATTENDANCE_DISPUTES",
    "WFM_ROSTER",
    "WFM_LIVE_TRACKER",
    "WFM_ROSTER_MANAGER_QUEUE",
    "RTA_BOARD",
    "WORKFORCE_COMMAND_CENTER",
    "KPI_CONFIG",
    "KPI_DASHBOARD",
    "OPERATIONS_KPI",
    "GOALS",
    "CAREER_PLANNING",
    "PIP_MANAGEMENT",
    "EXPENSE_APPROVALS",
    "REPORTS_CENTER",
  ],
  process_manager: [
    "MANAGEMENT_DASHBOARD",
    "WFM_ROSTER",
    "WFM_LIVE_TRACKER",
    "WFM_ROSTER_MANAGER_QUEUE",
    "RTA_BOARD",
    "WORKFORCE_COMMAND_CENTER",
    "KPI_CONFIG",
    "KPI_DASHBOARD",
    "OPERATIONS_KPI",
    "GOALS",
    "CAREER_PLANNING",
    "PIP_MANAGEMENT",
    "EXPENSE_APPROVALS",
    "REPORTS_CENTER",
  ],
  team_leader: [
    "WFM_ROSTER",
    "RTA_BOARD",
    "GOALS",
    "CAREER_PLANNING",
    "MY_KPI",
    "EXPENSE_APPROVALS",
  ],
  tl: [
    "WFM_ROSTER",
    "RTA_BOARD",
    "GOALS",
    "CAREER_PLANNING",
    "MY_KPI",
    "EXPENSE_APPROVALS",
  ],
  wfm: [
    "WFM_DASHBOARD",
    "WFM_ATTENDANCE_DASHBOARD",
    "ATTENDANCE_DISPUTES",
    "DISCARD_CENTER",
    "WFM_ROSTER",
    "WFM_LIVE_TRACKER",
    "WFM_AUTO_ROSTER",
    "WFM_EXTENSIONS",
    "WFM_PLANNING_RULES",
    "WFM_SLOT_REQUIREMENTS",
    "WFM_WEEKOFF_DAY_RULES",
    "ROSTER_MASTER",
    "RTA_BOARD",
    "WORKFORCE_COMMAND_CENTER",
    "PROVISIONING_WFM_ALIGNMENT",
  ],
  payroll: [
    "PAYROLL_HR_DASHBOARD",
    "PAYROLL",
    "PAYROLL_PAYSLIPS",
    "TAX_DECLARATION",
    "FULL_FINAL",
    "STATUTORY_CONFIG",
    "PAYROLL_MASTERS",
    "SALARY_PACKAGES",
    "PAYROLL_INCENTIVES",
    "PAYROLL_EPF_COMPLIANCE",
    "PAYROLL_PF_CREATION_QUEUE",
    "PAYROLL_PF_BATCHES",
    "PAYROLL_PROCESS_READINESS",
    "SALARY_PREP",
    "SALARY_INCREMENT",
  ],
  payroll_head: [
    "PAYROLL_HR_DASHBOARD",
    "ATTENDANCE_DISPUTES",
    "PAYROLL",
    "FULL_FINAL",
    "STATUTORY_CONFIG",
    "PAYROLL_MASTERS",
    "SALARY_PACKAGES",
    "PAYROLL_INCENTIVES",
    "PAYROLL_EPF_COMPLIANCE",
    "PAYROLL_PF_CREATION_QUEUE",
    "PAYROLL_PF_BATCHES",
    "PAYROLL_PROCESS_READINESS",
    "SALARY_PREP",
    "SALARY_INCREMENT",
    "REPORTS_CENTER",
  ],
  payroll_hr: [
    "PAYROLL_HR_DASHBOARD",
    "ATS_PAYROLL_HR",
    "ATS_JOINING_DOCUMENTS_TRACKER",
    "PAYROLL_PF_CREATION_QUEUE",
    "PAYROLL_PF_BATCHES",
    "EMPLOYEE_EPF_COMPLIANCE",
  ],
  finance: [
    "PAYROLL_HR_DASHBOARD",
    "EXPENSE_FINANCE",
    "EXPENSE_REPORTS",
    "PROCUREMENT",
    "VENDOR_MANAGEMENT",
    "ERP",
    "REPORTS_CENTER",
  ],
  qa: [
    "QUALITY_DASHBOARD",
    "OPERATIONS_DASHBOARD",
    "AGENT_PERFORMANCE",
    "OPERATIONS_KPI",
    "KPI_DASHBOARD",
    "GOALS",
    "REPORTS_CENTER",
  ],
  quality_analyst: [
    "QUALITY_DASHBOARD",
    "AGENT_PERFORMANCE",
    "OPERATIONS_KPI",
    "KPI_DASHBOARD",
  ],
  operations_manager: [
    "OPERATIONS_DASHBOARD",
    "WORKFORCE_COMMAND_CENTER",
    "CLIENT_MASTER",
    "PROCESS_CONFIG",
    "OPERATIONS_KPI",
    "ATS_WALKIN_QUEUE",
    "JOB_REQUISITION",
    "REPORTS_CENTER",
  ],
  ceo: [
    "CEO_DASHBOARD",
    "MANAGEMENT_DASHBOARD",
    "OPERATIONS_DASHBOARD",
    "QUALITY_DASHBOARD",
    "WORKFORCE_COMMAND_CENTER",
    "REPORTS_CENTER",
    // ADVANCED_REPORTS and KPI_DASHBOARD removed 31-Jul-2026 (CEO UAT).
    // Neither has a page behind it:
    //   ADVANCED_REPORTS -> /advanced-reports is a bare <Navigate to="/reports">
    //     legacy stub (config/routes/finance.routes.tsx). The report builder,
    //     cross-module query and scheduled email delivery it advertises were
    //     never built at that path.
    //   KPI_DASHBOARD  -> /kpi/dashboard has never been mounted in the router.
    //     Seeded by sql/216_missing_page_catalog_entries.sql; already
    //     active_status=0 in the live catalog, but still listed here, so the
    //     generated UAT matrix kept sending testers to a 404. The real page is
    //     OPERATIONS_KPI (/operations-kpi), which the CEO already holds below.
    "OPERATIONS_KPI",
  ],
  trainer: [
    "LMS_MY_LEARNING",
    "LMS_COORDINATOR",
    "LMS_ADMIN",
    "LMS_MANAGEMENT_DASHBOARD",
    "LMS_INTEGRATION",
    "LMS_PROGRESS_DASHBOARD",
    "LMS_MODULE_LAUNCH",
  ],
  it: [
    "IT_MANAGER_DASHBOARD",
    "PROVISIONING_IT",
    "IT_PROVISIONING_TRACKER",
    "ASSETS_MANAGER",
  ],
  branch_it: [
    "IT_MANAGER_DASHBOARD",
    "PROVISIONING_IT",
    "IT_PROVISIONING_TRACKER",
    "ASSETS_MANAGER",
  ],
  it_admin: [
    "IT_MANAGER_DASHBOARD",
    "PROVISIONING_IT",
    "IT_PROVISIONING_TRACKER",
    "ASSETS_MANAGER",
  ],
  // HO-level functional head roles
  it_head: [
    "IT_MANAGER_DASHBOARD",
    "IT_PROVISIONING_TRACKER",
    "PROVISIONING_IT",
    "PROVISIONING_DASHBOARD",
    "PROVISIONING_ADMIN",
    "ASSETS_MANAGER",
    "HELPDESK",
    "DIALER_INTEGRATION",
    "INTEGRATION_HUB",
    "SECURITY_CENTER",
    "EMPLOYEES",
    "EMPLOYEE_MANAGEMENT",
    "AUDIT_LOG",
    "WORKFLOW_ADMIN",
    "MODULE_ACCESS",
  ],
  finance_head: [
    "FINANCE_HEAD_DASHBOARD",
    "PAYROLL_HR_DASHBOARD",
    "PAYROLL_COST_SUMMARY",
    "PAYROLL_VARIANCE",
    "PAYROLL_AUDIT_TRAIL",
    "PAYROLL_BULK_OUTPUTS",
    "PAYROLL_SIGN_OFF",
    "PAYROLL_STATUTORY_FILING",
    "PAYROLL_EPF_COMPLIANCE",
    "STATUTORY_COMPLIANCE",
    "SALARY_REGISTER",
    "FULL_FINAL",
    "PAYROLL_DISBURSAL",
    "EXPENSE_FINANCE",
    "EXPENSE_REPORTS",
    "SALARY_INCREMENT",
    "SALARY_PROPOSAL_APPROVALS",
    "REPORTS_CENTER",
    "COMPLIANCE_DASHBOARD",
    "LABOUR_COMPLIANCE",
    "EMPLOYEES",
  ],
  tq_head: [
    "QUALITY_DASHBOARD",
    "AGENT_PERFORMANCE",
    "KPI_DASHBOARD",
    "KPI_MASTER",
    "KPI_CONFIG",
    "OPERATIONS_KPI",
    "PERFORMANCE_DASHBOARD",
    "OPERATIONS_DASHBOARD",
    "TAT_DASHBOARD",
    "TAT_MATRIX",
    "COACHING",
    "LMS_COORDINATOR",
    "LMS_PROGRESS_DASHBOARD",
    "LMS_MANAGEMENT_DASHBOARD",
    "LMS_INTEGRATION",
    "EMPLOYEES",
    "TEAM_ATTENDANCE",
    "PIP_MANAGEMENT",
    "REPORTS_CENTER",
    "PROCESS_MANAGER_DASHBOARD",
  ],
  accounts_head: [
    "FINANCE_HEAD_DASHBOARD",
    "PAYROLL_COST_SUMMARY",
    "PAYROLL_AUDIT_TRAIL",
    "PAYROLL_STATUTORY_FILING",
    "EXPENSE_FINANCE",
    "EXPENSE_APPROVALS",
    "EXPENSE_REPORTS",
    "SALARY_REGISTER",
    "COMPLIANCE_DASHBOARD",
    "LABOUR_COMPLIANCE",
    "REPORTS_CENTER",
    "PROCESS_MANAGER_DASHBOARD",
  ],
  employee: [],
} as const satisfies Record<string, readonly string[]>;

export type RbacRoleKey = keyof typeof ROLE_SPECIFIC_PAGE_CODES | "super_admin";

/**
 * Pages withheld from a role even though COMMON_USER_PAGE_CODES grants them to
 * everyone.
 *
 * COMMON_USER_PAGE_CODES is a blanket self-service grant, which is correct for
 * things every employee has — a profile, a payslip, a leave request. It is wrong
 * for self-service pages that only apply to some populations, and there was
 * previously no way to say so: the union in getRolePageCodes() had no exclusion
 * step, so the only options were "everyone" or "remove the page from the product".
 *
 * Keep this list very short. It is for pages that are structurally meaningless for
 * a role, not for permission tuning — that belongs in role_page_access.
 */
export const ROLE_EXCLUDED_PAGE_CODES: Readonly<Record<string, readonly string[]>> = {
  // The CEO is not measured on operational KPIs, so "My KPI" has nothing to show
  // him. The CEO UAT reported the page as hollow — 3 KPIs tracked, 0 with data,
  // Overall Score 0% — and the right fix is to not offer the page rather than to
  // make an empty one look better.
  //
  // Note the underlying data disagrees and should be looked at separately: as of
  // 31-Jul-2026 MAS00001 carries 3 rows in kpi_employee_resolved and 28 in
  // kpi_daily_actual, because KPI assignment resolves by process and the CEO sits
  // in one. Those assignments also feed the org-wide leaderboard and averages.
  ceo: ["MY_KPI"],
};

export function uniquePageCodes(pageCodes: readonly string[]): string[] {
  return Array.from(new Set(pageCodes));
}

export function getRolePageCodes(roleKey: string, allPageCodes: readonly string[] = []): string[] {
  // super_admin receives exactly the pages the caller says are active — no union with
  // COMMON_USER_PAGE_CODES. That is deliberate: page_catalog decides which pages exist, and
  // granting a code that is not active there would hand out a page the platform does not
  // have. When EMPLOYEE_STAT_CARD went missing for super admin the cause was upstream —
  // the code was absent from the caller's list AND from page_catalog entirely (see
  // migration 604) — so it is fixed there rather than by widening this function.
  if (roleKey === "super_admin") return uniquePageCodes(allPageCodes);

  const excluded = new Set(ROLE_EXCLUDED_PAGE_CODES[roleKey] ?? []);

  return uniquePageCodes([
    ...COMMON_USER_PAGE_CODES,
    ...(ROLE_SPECIFIC_PAGE_CODES[roleKey as keyof typeof ROLE_SPECIFIC_PAGE_CODES] ?? []),
  ]).filter((pageCode) => !excluded.has(pageCode));
}
