export type DashboardCode =
  | "SUPER_ADMIN_DASHBOARD"
  | "CEO_DASHBOARD"
  | "HR_DASHBOARD"
  | "WFM_DASHBOARD"
  | "WFM_ATTENDANCE_DASHBOARD"
  | "PAYROLL_HR_DASHBOARD"
  | "QUALITY_DASHBOARD"
  | "OPERATIONS_DASHBOARD"
  | "RECRUITER_DASHBOARD"
  | "IT_MANAGER_DASHBOARD"
  | "MANAGEMENT_DASHBOARD"
  | "EMPLOYEE_SELF_DASHBOARD"
  | "PERFORMANCE_SCORECARD";

export type DashboardScopeType =
  | "ORGANISATION"
  | "BRANCH"
  | "PROCESS"
  | "TEAM"
  | "SELF"
  | "CUSTOM";

export type DashboardAccessDefinition = {
  code: DashboardCode;
  variant: string;
  displayName: string;
  route: string;
  pageCode: string;
  allowedRoleKeys: readonly string[];
  scopeTypes: readonly DashboardScopeType[];
  sensitiveMetrics: readonly string[];
  permissions: {
    drilldown: boolean;
    export: boolean;
    filters: boolean;
  };
};

export const DASHBOARD_ROLE_ALIASES: Readonly<Record<string, string>> = {
  bm: "branch_manager",
  hr_branch: "branch_hr",
  ho_rta: "rta",
  it_admin: "it",
  ops_manager: "operations_manager",
  qa_analyst: "quality_analyst",
  qa_lead: "quality_lead",
  recruitment_hr: "recruiter",
  ta_lead: "recruiter",
  talent_acquisition: "recruiter",
  team_lead: "team_leader",
  tl: "team_leader",
  payroll_admin: "payroll",
  payroll_hr: "payroll",
};

const definition = (
  value: DashboardAccessDefinition,
): DashboardAccessDefinition => Object.freeze(value);

export const DASHBOARD_ACCESS_REGISTRY: Readonly<
  Record<DashboardCode, DashboardAccessDefinition>
> = Object.freeze({
  SUPER_ADMIN_DASHBOARD: definition({
    code: "SUPER_ADMIN_DASHBOARD",
    variant: "super_admin",
    displayName: "Super Admin",
    route: "/super-admin/dashboard",
    pageCode: "SUPER_ADMIN_DASHBOARD",
    allowedRoleKeys: ["super_admin"],
    scopeTypes: ["ORGANISATION"],
    sensitiveMetrics: ["security", "sessions", "audit", "infrastructure"],
    permissions: { drilldown: true, export: true, filters: false },
  }),
  CEO_DASHBOARD: definition({
    code: "CEO_DASHBOARD",
    variant: "ceo",
    displayName: "CEO",
    route: "/ceo/dashboard",
    pageCode: "CEO_DASHBOARD",
    allowedRoleKeys: ["ceo", "coo", "management", "super_admin"],
    scopeTypes: ["ORGANISATION", "BRANCH", "PROCESS"],
    sensitiveMetrics: ["payroll", "revenue", "attrition"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
  HR_DASHBOARD: definition({
    code: "HR_DASHBOARD",
    variant: "hr",
    displayName: "HR",
    route: "/hr/dashboard",
    pageCode: "HR_DASHBOARD",
    allowedRoleKeys: ["hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "super_admin"],
    scopeTypes: ["ORGANISATION", "BRANCH", "PROCESS"],
    sensitiveMetrics: ["candidate", "employee", "bgv", "dpdp"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
  WFM_DASHBOARD: definition({
    code: "WFM_DASHBOARD",
    variant: "wfm",
    displayName: "WFM",
    route: "/wfm/dashboard",
    pageCode: "WFM_DASHBOARD",
    // 'manager' added 2026-08-22: plain team/branch managers had no WFM Dashboard entitlement
    // at all — not deliberate scoping, just never granted. They already hold the same-shaped
    // Operations Dashboard grant; this brings WFM into parity with that.
    allowedRoleKeys: ["wfm", "ho_wfm", "wfm_spoc", "rta", "manager", "super_admin"],
    scopeTypes: ["ORGANISATION", "BRANCH", "PROCESS"],
    sensitiveMetrics: ["attendance", "productivity"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
  WFM_ATTENDANCE_DASHBOARD: definition({
    code: "WFM_ATTENDANCE_DASHBOARD",
    variant: "wfm_attendance",
    displayName: "WFM Attendance",
    route: "/wfm-attendance",
    pageCode: "WFM_ATTENDANCE_DASHBOARD",
    allowedRoleKeys: ["wfm", "ho_wfm", "wfm_spoc", "rta", "hr", "operations_manager", "super_admin"],
    scopeTypes: ["ORGANISATION", "BRANCH", "PROCESS", "TEAM"],
    sensitiveMetrics: ["attendance", "biometric"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
  PAYROLL_HR_DASHBOARD: definition({
    code: "PAYROLL_HR_DASHBOARD",
    variant: "payroll",
    displayName: "Payroll",
    route: "/payroll-hr/dashboard",
    pageCode: "PAYROLL_HR_DASHBOARD",
    allowedRoleKeys: ["payroll", "payroll_head", "payroll_branch", "ho_payroll", "finance", "finance_head", "accounts_head", "branch_finance", "super_admin"],
    scopeTypes: ["ORGANISATION", "BRANCH", "PROCESS"],
    sensitiveMetrics: ["salary", "bank", "statutory"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
  QUALITY_DASHBOARD: definition({
    code: "QUALITY_DASHBOARD",
    variant: "quality",
    displayName: "Quality",
    route: "/quality-dashboard",
    pageCode: "QUALITY_DASHBOARD",
    // 'manager' added 2026-08-22: role_page_access already had a grant row for manager here,
    // deactivated (active_status=0) — a leftover from the 2026-07-25 RBAC cleanup sweep, not a
    // deliberate lock-out. This registry list is the other, independently-enforced gate
    // (dashboard.routes.ts:65) — both need to agree or the DB grant alone does nothing.
    allowedRoleKeys: ["qa", "quality_analyst", "quality_lead", "qa_manager", "operations_manager", "tq_head", "branch_head", "ceo", "coo", "manager", "super_admin"],
    scopeTypes: ["ORGANISATION", "BRANCH", "PROCESS", "TEAM"],
    sensitiveMetrics: ["quality", "coaching"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
  OPERATIONS_DASHBOARD: definition({
    code: "OPERATIONS_DASHBOARD",
    variant: "operations",
    displayName: "Operations",
    route: "/operations-dashboard",
    pageCode: "OPERATIONS_DASHBOARD",
    allowedRoleKeys: ["operations_manager", "operations_head", "ho_operations", "process_manager", "branch_head", "qa", "tq_head", "ceo", "manager", "super_admin"],
    scopeTypes: ["ORGANISATION", "BRANCH", "PROCESS", "TEAM"],
    sensitiveMetrics: ["revenue", "productivity", "quality"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
  RECRUITER_DASHBOARD: definition({
    code: "RECRUITER_DASHBOARD",
    variant: "recruiter",
    displayName: "Recruiter",
    route: "/recruiter-dashboard",
    pageCode: "RECRUITER_DASHBOARD",
    allowedRoleKeys: ["recruiter", "hr", "hr_admin", "ho_hr", "super_admin"],
    scopeTypes: ["ORGANISATION", "BRANCH", "PROCESS", "CUSTOM"],
    sensitiveMetrics: ["candidate", "offer"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
  IT_MANAGER_DASHBOARD: definition({
    code: "IT_MANAGER_DASHBOARD",
    variant: "it_manager",
    displayName: "IT Manager",
    route: "/it/dashboard",
    pageCode: "IT_MANAGER_DASHBOARD",
    allowedRoleKeys: ["it", "branch_it", "ho_it", "it_head", "super_admin"],
    scopeTypes: ["ORGANISATION", "BRANCH"],
    sensitiveMetrics: ["account", "asset", "access"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
  MANAGEMENT_DASHBOARD: definition({
    code: "MANAGEMENT_DASHBOARD",
    variant: "manager",
    displayName: "Manager",
    route: "/manager/dashboard",
    pageCode: "MANAGEMENT_DASHBOARD",
    allowedRoleKeys: ["manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "ceo", "super_admin"],
    scopeTypes: ["BRANCH", "PROCESS", "TEAM"],
    sensitiveMetrics: ["performance", "attendance", "attrition"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
  EMPLOYEE_SELF_DASHBOARD: definition({
    code: "EMPLOYEE_SELF_DASHBOARD",
    variant: "employee",
    displayName: "My Dashboard",
    route: "/my-dashboard",
    pageCode: "EMPLOYEE_SELF_DASHBOARD",
    allowedRoleKeys: ["employee", "agent", "trainee", "manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "recruiter", "qa", "quality_analyst", "quality_lead", "qa_manager", "operations_manager", "wfm", "ho_wfm", "wfm_spoc", "rta", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "payroll", "payroll_head", "payroll_branch", "payroll_admin", "payroll_hr", "ho_payroll", "finance", "finance_head", "accounts_head", "branch_finance", "it", "branch_it", "ho_it", "it_head", "tq_head", "ceo", "coo", "management", "admin", "branch_admin", "interviewer", "trainer", "super_admin"],
    scopeTypes: ["SELF"],
    sensitiveMetrics: ["attendance", "leave", "payroll", "performance"],
    permissions: { drilldown: true, export: false, filters: false },
  }),
  PERFORMANCE_SCORECARD: definition({
    code: "PERFORMANCE_SCORECARD",
    variant: "performance_scorecard",
    displayName: "Performance Scorecard",
    route: "/performance-command-center",
    pageCode: "PERFORMANCE_SCORECARD_COMMAND_CENTER",
    allowedRoleKeys: ["manager", "process_manager", "assistant_manager", "branch_head", "branch_manager", "team_leader", "tl", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr", "ceo", "coo", "management", "super_admin"],
    scopeTypes: ["ORGANISATION", "TEAM", "BRANCH", "PROCESS"],
    sensitiveMetrics: ["attendance", "performance", "attrition", "revenue"],
    permissions: { drilldown: true, export: true, filters: true },
  }),
});

export function normalizeDashboardRole(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  return DASHBOARD_ROLE_ALIASES[normalized] ?? normalized;
}

// Lazy-built map from variant name → DashboardCode for backward-compat aliases
// e.g. "hr" → "HR_DASHBOARD", "wfm" → "WFM_DASHBOARD"
let _variantIndex: Map<string, DashboardCode> | null = null;
function variantIndex(): Map<string, DashboardCode> {
  if (!_variantIndex) {
    _variantIndex = new Map();
    for (const def of Object.values(DASHBOARD_ACCESS_REGISTRY)) {
      if (def.variant) _variantIndex.set(def.variant.toLowerCase(), def.code);
    }
  }
  return _variantIndex;
}

export function getDashboardDefinition(code: unknown): DashboardAccessDefinition | null {
  const raw = String(code ?? "").trim();
  const upper = raw.toUpperCase() as DashboardCode;
  // Direct match (e.g. "HR_DASHBOARD")
  if (DASHBOARD_ACCESS_REGISTRY[upper]) return DASHBOARD_ACCESS_REGISTRY[upper];
  // Variant alias (e.g. "hr" → HR_DASHBOARD, "wfm" → WFM_DASHBOARD)
  const byVariant = variantIndex().get(raw.toLowerCase());
  return byVariant ? DASHBOARD_ACCESS_REGISTRY[byVariant] : null;
}

export function canAccessDashboard(code: unknown, roleKeys: readonly string[]): boolean {
  const dashboard = getDashboardDefinition(code);
  if (!dashboard) return false;
  const normalizedRoles = new Set(roleKeys.map(normalizeDashboardRole));
  return dashboard.allowedRoleKeys.some((role) => normalizedRoles.has(normalizeDashboardRole(role)));
}

/**
 * Every role key entitled to at least one of the named dashboards.
 *
 * A role dashboard passes four independent gates before it renders: the React variant
 * check, the `role_page_access` grant, this registry on `/api/dashboards/*`, and a
 * separate `requireRole(...)` on each secondary endpoint the page calls. The first three
 * are all driven from `allowedRoleKeys` below; the fourth was hand-written per module and
 * had drifted from it on nine endpoints — so a role opened the page it was entitled to and
 * then watched half the tiles return 403. Measured live 2026-08-28: `ceo` was denied
 * `/api/ats/stats` (its own hiring tiles), `it_head` was denied both endpoints the IT
 * Manager dashboard calls, and `assistant_manager` / `team_leader` / `branch_head` were
 * denied six of the Manager dashboard's endpoints. Only `super_admin` saw a whole page,
 * because requireRole short-circuits for it — which is exactly why the pages tested clean.
 *
 * Endpoints that feed dashboards therefore derive their gate from here rather than
 * restating it. Pass the dashboards whose layouts actually call the endpoint; extra roles
 * an endpoint serves outside the dashboards stay as literals alongside the spread.
 *
 * Returns raw (un-normalised) keys because requireRole normalises and expands its own
 * inputs; handing it the alias forms as well would be redundant, not wrong.
 */
export function dashboardConsumerRoles(...codes: readonly DashboardCode[]): string[] {
  const roles = new Set<string>();
  for (const code of codes) {
    const definition = DASHBOARD_ACCESS_REGISTRY[code];
    if (!definition) continue;
    for (const role of definition.allowedRoleKeys) roles.add(role);
  }
  return [...roles];
}
