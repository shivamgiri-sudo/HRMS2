export const PAGE_CODE_BY_ROUTE: Record<string, string> = {
  "/advanced-reports": "ADVANCED_REPORTS",
  "/agent-performance": "AGENT_PERFORMANCE",
  "/assets-manager": "ASSETS_MANAGER",
  "/ats/bgv": "ATS_BGV",
  "/ats/bgv-report": "ATS_BGV_REPORT",
  "/ats/bulk-import": "ATS_BULK_IMPORT",
  "/ats/candidate-master": "ATS_CANDIDATE_MASTER",
  "/ats/command-center": "ATS_DASHBOARD",
  "/ats/extensions": "ATS_EXTENSIONS",
  "/ats/joining-control-room": "ATS_JOINING_CONTROL_ROOM",
  "/ats/joining-documents-tracker": "ATS_JOINING_DOCUMENTS_TRACKER",
  "/ats/name-consistency": "NAME_CONSISTENCY_MATRIX",
  "/ats/offer-approvals": "ATS_OFFER_APPROVALS",
  "/ats/onboarding-bridge": "ATS_ONBOARDING_BRIDGE",
  "/ats/onboarding-requests": "ATS_ONBOARDING_REQUESTS",
  "/ats/payroll-hr": "ATS_PAYROLL_HR",
  "/ats/payroll-hr-validation": "ATS_PAYROLL_HR",
  "/ats/recruiter-portal": "ATS_RECRUITER_PORTAL",
  "/ats/recruiter/hiring-dashboard": "RECRUITER_DASHBOARD",
  "/ats/recruiter/hiring-entry": "ATS_RECRUITER_QUEUE",
  "/ats/recruiter/my-candidates": "ATS_RECRUITER_QUEUE",
  "/ats/recruiter/workspace": "ATS_RECRUITER_WORKSPACE",
  "/ats/waiting-queue": "ATS_WAITING_QUEUE",
  "/ats/walkin-queue": "ATS_WALKIN_QUEUE",
  "/attendance-regularization": "ATTENDANCE_REGULARIZATION",
  "/attendance/regularizations": "ATTENDANCE_REGULARIZATION",
  "/attendance/disputes": "ATTENDANCE_DISPUTES",
  "/admin/discard-center": "DISCARD_CENTER",
  "/audit-log": "AUDIT_LOG",
  "/benefits": "BENEFITS",
  "/bulk-upload": "BULK_UPLOAD",
  "/career-planning": "CAREER_PLANNING",
  "/ceo/dashboard": "CEO_DASHBOARD",
  "/communication/email-centre": "EMAIL_COMMAND_CENTRE",
  "/compliance/audit-report": "COMPLIANCE_AUDIT_REPORT",
  "/compliance/dpdp": "DPDP_COMPLIANCE",
  "/compliance/dpdp-withdrawal-admin": "DPDP_WITHDRAWAL_ADMIN",
  "/compliance/labour": "LABOUR_COMPLIANCE",
  "/compliance/statutory": "STATUTORY_COMPLIANCE",
  "/control-tower": "CONTROL_TOWER",
  "/employee-lifecycle": "EMPLOYEE_LIFECYCLE",
  "/employee-lifecycle-v2": "EMPLOYEE_LIFECYCLE",
  "/employee-stat-card": "EMPLOYEE_STAT_CARD",
  "/employee-journey": "EMPLOYEE_MANAGEMENT",
  "/employees": "EMPLOYEE_MANAGEMENT",
  "/erp": "ERP",
  "/exit/command-center": "EXIT_COMMAND_CENTER",
  "/exit-management": "EXIT_COMMAND_CENTER",
  "/exit/resignation": "RESIGNATION_MY_REQUEST",
  "/exit/resignation-command-center": "RESIGNATION_COMMAND_CENTER",
  "/expenses": "MY_EXPENSES",
  "/expenses/approvals": "EXPENSE_APPROVALS",
  "/expenses/finance": "EXPENSE_FINANCE",
  "/finance/billability": "FINANCE_BILLABILITY_SEAT_COST",
  "/finance/salary-voucher": "FINANCE_SALARY_VOUCHER",
  "/finance/branch-budget": "FINANCE_BRANCH_BUDGET",
  "/finance/annual-budget-summary": "FINANCE_ANNUAL_BUDGET_SUMMARY",
  "/finance/unlinked-grn-review": "FINANCE_UNLINKED_GRN_REVIEW",
  // Granted in production and mounted with these exact gate codes, but unmapped here, so
  // nothing verified the page they point at exists and the module launcher had to fall back
  // to page_catalog.page_path. Each pairing is taken from the route's own Gate.
  "/finance/grn": "FINANCE_GRN",
  "/finance/budget-consolidation": "FINANCE_BUDGET_CONSOLIDATION",
  "/finance/process-pnl": "FINANCE_PROCESS_PNL",
  "/finance/process-pnl/lobs": "FINANCE_PNL_LOBS",
  "/finance/process-pnl/period-close": "FINANCE_PNL_PERIOD_CLOSE",
  // Both routes carry these exact Gate codes (finance.routes.tsx) but were missing from this map,
  // so getRoutePageCode() returned undefined for them and nav visibility silently stopped
  // tracking the page-access grant — a role revoked from the code still saw the menu item and
  // then met the Gate's denial page. That is the precise drift this map exists to prevent.
  "/finance/process-pnl/configuration": "FINANCE_PNL_CONFIG",
  "/finance/cost-centres": "FINANCE_COST_CENTRES",
  "/finance/masters": "FINANCE_MASTERS",
  "/finance/vendor-payment-tracking": "FINANCE_VENDOR_PAYMENTS",
  "/quality/audit-forms": "QA_EVALUATION",
  "/expenses/new": "EXPENSE_CREATE",
  "/expenses/reports": "EXPENSE_REPORTS",
  "/goals": "GOALS",
  "/governance/tat-dashboard": "TAT_DASHBOARD",
  "/governance/tat-matrix": "TAT_MATRIX",
  "/hr/attendance-lookup": "ATTENDANCE_LOOKUP",
  "/hr/dashboard": "HR_DASHBOARD",
  "/integration-hub": "INTEGRATION_HUB",
  "/it-admin/exit-pass": "ASSET_EXIT_PASS",
  "/it-provisioning": "IT_PROVISIONING_TRACKER",
  "/kpi-config": "KPI_CONFIG",
  "/kpi-master": "KPI_MASTER",
  "/leave-types": "LEAVE_TYPES",
  "/letters": "LETTERS",
  "/lms/admin": "LMS_ADMIN",
  "/lms/coordinator": "LMS_COORDINATOR",
  "/lms/integration": "LMS_INTEGRATION",
  "/lms/management-dashboard": "LMS_MANAGEMENT_DASHBOARD",
  "/lms/module-launch": "LMS_MODULE_LAUNCH",
  "/lms/my-learning": "LMS_MY_LEARNING",
  "/lms/progress-dashboard": "LMS_PROGRESS_DASHBOARD",
  "/management/dashboard": "MANAGEMENT_DASHBOARD",
  "/migration-console": "MIGRATION_CONSOLE",
  "/mobility": "MOBILITY",
  "/my-dashboard": "EMPLOYEE_SELF_DASHBOARD",
  "/my-kpi": "MY_KPI",
  "/onboarding": "ATS_ONBOARDING_BRIDGE",
  "/operations-kpi": "OPERATIONS_KPI",
  "/operations/dashboard": "OPERATIONS_DASHBOARD",
  "/operations-dashboard": "OPERATIONS_DASHBOARD",
  "/payroll": "PAYROLL",
  "/payroll-hr/dashboard": "PAYROLL_HR_DASHBOARD",
  "/payroll/audit-trail": "PAYROLL_AUDIT_TRAIL",
  "/payroll/attendance-control-tower": "PAYROLL_ATTENDANCE_CONTROL_TOWER",
  "/payroll/bank-readiness": "PAYROLL_BANK_READINESS",
  "/payroll/branch-readiness": "PAYROLL_BRANCH_READINESS",
  "/payroll/bulk-outputs": "PAYROLL_BULK_OUTPUTS",
  "/payroll/calendar": "PAYROLL_CALENDAR",
  "/payroll/cheque-validation": "PAYROLL_CHEQUE_VALIDATION",
  "/payroll/config-flags": "PAYROLL_CONFIG_FLAGS",
  "/payroll/cost-summary": "PAYROLL_COST_SUMMARY",
  "/payroll/disbursal": "PAYROLL_DISBURSAL",
  "/payroll/epf-compliance": "PAYROLL_EPF_COMPLIANCE",
  "/payroll/full-final": "FULL_FINAL",
  "/payroll/holiday-master": "PAYROLL_HOLIDAY_MASTER",
  "/payroll/holiday-work-approvals": "PAYROLL_HOLIDAY_WORK_APPROVALS",
  "/payroll/holiday-work-requests": "PAYROLL_HOLIDAY_WORK_REQUESTS",
  "/payroll/ho-queues": "PAYROLL_HO_QUEUES",
  "/payroll/incentives": "PAYROLL_INCENTIVES",
  "/payroll/loans": "PAYROLL_LOANS",
  "/payroll/masters": "PAYROLL_MASTERS",
  "/payroll/noc": "PAYROLL_NOC",
  "/payroll/overtime": "PAYROLL_OVERTIME",
  "/payroll/package-admin": "SALARY_PACKAGE_ADMIN",
  "/payroll/payslips": "PAYROLL_PAYSLIPS",
  "/payroll/pf-batches": "PAYROLL_PF_BATCHES",
  "/payroll/pf-creation-queue": "PAYROLL_PF_CREATION_QUEUE",
  "/payroll/process-readiness": "PAYROLL_PROCESS_READINESS",
  "/payroll/recalculation-queue": "PAYROLL_RECALCULATION_QUEUE",
  "/payroll/reimbursements": "PAYROLL_REIMBURSEMENTS",
  "/payroll/running-breakdown": "PAYROLL_RUNNING_BREAKDOWN",
  "/payroll/salary-certificates": "SALARY_CERTIFICATE",
  "/payroll/salary-packages": "SALARY_PACKAGES",
  "/payroll/sign-off": "PAYROLL_SIGN_OFF",
  "/payroll/statutory-config": "STATUTORY_CONFIG",
  "/payroll/statutory-filing": "PAYROLL_STATUTORY_FILING",
  "/payroll/tax-declaration": "TAX_DECLARATION",
  "/payroll/validation": "PAYROLL_VALIDATION",
  "/payroll/variance": "PAYROLL_VARIANCE",
  "/people-experience/command-center": "PEOPLE_EXPERIENCE_COMMAND_CENTER",
  // Was missing entirely, which is why the page-access contract test never noticed
  // that page_catalog pointed WORKFORCE_COMMAND_CENTER at '/workforce/command-center'
  // — a route that has never been mounted — leaving eight roles on a 404.
  "/performance/command-center": "WORKFORCE_COMMAND_CENTER",
  "/pip-management": "PIP_MANAGEMENT",
  "/portal-data-manager": "PORTAL_DATA_MANAGER",
  "/privacy/dpdp-withdrawal": "DPDP_WITHDRAWAL",
  "/procurement": "PROCUREMENT",
  "/profile": "MY_PROFILE",
  "/provisioning/admin": "PROVISIONING_ADMIN",
  "/provisioning/appointment-letter": "PROVISIONING_APPOINTMENT_LETTER",
  "/provisioning/it": "PROVISIONING_IT",
  "/provisioning/wfm-alignment": "PROVISIONING_WFM_ALIGNMENT",
  "/quality-dashboard": "QUALITY_DASHBOARD",
  "/quality/dashboard": "QUALITY_DASHBOARD",
  "/recruiter-dashboard": "RECRUITER_DASHBOARD",
  "/recruitment/job-requisition": "JOB_REQUISITION",
  "/reports": "REPORTS_CENTER",
  "/roster-master-builder": "ROSTER_MASTER",
  // Deliberately the same code as /reports: this route renders the Reports hub's own `aon`
  // view from the same API, so its audience must be identical rather than a second grant
  // that can drift out of step with it.
  "/workforce/aon-analytics": "REPORTS_CENTER",
  "/rta-board": "RTA_BOARD",
  "/salary-increment": "SALARY_INCREMENT",
  "/security-center": "SECURITY_CENTER",
  "/security/exit-pass-verify": "ASSET_EXIT_PASS_VERIFY",
  "/settings/access-control": "ACCESS_CONTROL",
  "/settings/email-templates/bulk-import": "EMAIL_TEMPLATE_BULK_IMPORT",
  "/super-admin/dashboard": "SUPER_ADMIN_DASHBOARD",
  "/super-admin/module-access": "MODULE_ACCESS",
  "/super-admin/page-access": "ACCESS_CONTROL",
  "/support/command-center": "SUPPORT_COMMAND_CENTER",
  "/support/grievance-command-center": "GRIEVANCE_COMMAND_CENTER",
  "/uat/checklist": "UAT_CHECKLIST_ADMIN",
  "/uat/feedback": "UAT_FEEDBACK",
  "/uat/triage": "UAT_TRIAGE_CONSOLE",
  "/uat/releases": "UAT_RELEASE_BOARD",
  "/vendors": "VENDOR_MANAGEMENT",
  "/wfm-attendance": "WFM_ATTENDANCE_DASHBOARD",
  "/wfm/auto-roster": "WFM_AUTO_ROSTER",
  "/wfm/branch-spoc-config": "WFM_BRANCH_SPOC_CONFIG",
  "/wfm/dashboard": "WFM_DASHBOARD",
  "/wfm/extensions": "WFM_EXTENSIONS",
  "/wfm/live-tracker": "WFM_LIVE_TRACKER",
  "/wfm/mismatch-queue": "WFM_LIVE_TRACKER",
  // Own code as of migration 1083 — WFM_LIVE_TRACKER is shared with 4 unrelated pages and
  // excluded payroll, who own the payable-days blockers this page lists.
  "/wfm/attendance-exceptions": "WFM_ATTENDANCE_EXCEPTIONS",
  // Its own code, not WFM_LIVE_TRACKER: this page is for reporting managers, who are
  // not in that code's audience, and the string must match workforce.routes.tsx and
  // navConfig.tsx exactly or nav visibility and page access disagree.
  "/wfm/team-attendance": "TEAM_ATTENDANCE",
  "/wfm/planning-rules": "WFM_PLANNING_RULES",
  "/wfm/roster": "WFM_ROSTER",
  "/wfm/roster-builder": "WFM_ROSTER_BUILDER",
  "/wfm/roster-rules": "WFM_ROSTER",
  "/wfm/roster-requests": "WFM_ROSTER",
  "/wfm/roster-insights": "WFM_ROSTER",
  "/wfm/roster-view": "WFM_ROSTER",
  "/roster-preference": "WFM_ROSTER",
  "/wfm-manager-approvals": "WFM_ROSTER",
  "/wfm/slot-requirements": "WFM_SLOT_REQUIREMENTS",
  "/wfm/weekoff-day-rules": "WFM_WEEKOFF_DAY_RULES",
  "/work-inbox": "WORK_INBOX",
  "/workflow-admin": "WORKFLOW_ADMIN",
  "/workforce-planning": "WFM_AUTO_ROSTER",

  // Added closing the page-catalog-route-drift ratchet (see that test file's docstring for
  // the WORKFORCE_COMMAND_CENTER history this guards against). Each of these was granted in
  // rbacPageMatrix.ts with no route mapping at all, so nothing verified the page it pointed at
  // actually existed. Resolved per-code by finding the real, currently-mounted route — see
  // that test's KNOWN_UNMAPPED_PAGE_CODES comment for the codes that could NOT be added here
  // because their real route is already claimed by a different, currently-mapped code.
  "/ats/branch-head-approval": "ATS_BRANCH_HEAD_APPROVAL",
  "/business-actions": "BUSINESS_ACTION_QUEUE",
  "/business-command-center": "BUSINESS_COMMAND_CENTER",
  "/call-master": "CALL_MASTER",
  "/call-master/inbound": "CALL_MASTER_INBOUND",
  "/candidate-onboarding-full": "CANDIDATE_ONBOARDING_FULL",
  "/admin/configuration": "CONFIGURATION_CENTER",
  "/engagement/command-center": "ENGAGEMENT_COMMAND_CENTER",
  // /helpdesk itself has no grant/mapping of its own (HELPDESK is in the drift test's known-
  // unmapped list) — Knowledge Base is a tab inside the one mounted /helpdesk page, not a
  // separate route, so this is the correct existing page for the grant to point at.
  "/helpdesk": "HELPDESK_KB",
  "/jobs": "JOBS",
  "/modules": "MODULE_LAUNCHER",
  "/onboard-full": "ONBOARDING_FULL",
  "/performance-command-center": "PERFORMANCE_SCORECARD_COMMAND_CENTER",
  "/performance-hub": "PERFORMANCE_HUB",
  "/quality/executive": "QUALITY_EXECUTIVE",
  "/quality/team": "QUALITY_TEAM",
  "/sales/brand-analytics": "SALES_BRAND_ANALYTICS",
  "/my-team": "TEAM_ROSTER",
  "/week-off-preferences": "WEEK_OFF_PREFERENCES",
};

export const PAGE_CODE_BY_ROUTE_PATTERN: Record<string, string> = {
  "/employee-stat-card/:id": "EMPLOYEE_STAT_CARD",
  "/employees/:id": "EMPLOYEE_MANAGEMENT",
  "/employees/:id/360": "EMPLOYEE_MANAGEMENT",
  "/employees/:employeeId/joining-documents": "EMPLOYEE_JOINING_DOCUMENTS",
  "/letters/:id/preview": "LETTERS",
};

function normalizeRoutePath(href: string): string {
  const [path] = href.split("?");
  if (!path) return "/";
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

function matchesRoutePattern(path: string, pattern: string): boolean {
  const pathSegments = path.split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);

  if (pathSegments.length !== patternSegments.length) return false;

  return patternSegments.every((segment, index) => segment.startsWith(":") || segment === pathSegments[index]);
}

export function getRoutePageCode(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const path = normalizeRoutePath(href);
  const exact = PAGE_CODE_BY_ROUTE[href] ?? PAGE_CODE_BY_ROUTE[path];
  if (exact) return exact;

  for (const [pattern, pageCode] of Object.entries(PAGE_CODE_BY_ROUTE_PATTERN)) {
    if (matchesRoutePattern(path, pattern)) return pageCode;
  }

  return undefined;
}
