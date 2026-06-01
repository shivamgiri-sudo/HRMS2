/**
 * Role catalog and visibility matrix for MCN HRMS.
 * Defines what each role can access — used by RBAC middleware and frontend feature flags.
 * Super Admin and Admin have full access.
 */

export const ROLES = [
  "super_admin",
  "admin",
  "hr",
  "recruiter",
  "employee",
  "wfm",
  "process_manager",
  "assistant_manager",
  "team_leader",
  "qa",
  "trainer",
  "finance",
  "payroll",
  "branch_head",
  "ceo",
  "client_user",
  "mcp_server",
] as const;

export type PeopleOSRole = (typeof ROLES)[number];

/** Module keys used across the app */
export const MODULES = [
  "dashboard",
  "employees",
  "ats",
  "documents",
  "lifecycle",
  "assets",
  "helpdesk",
  "leave",
  "attendance",
  "wfm_roster",
  "wfm_rta",
  "wfm_shrinkage",
  "payroll",
  "payslip",
  "tax_declaration",
  "kpi",
  "quality",
  "performance",
  "performance_feedback",
  "engagement",
  "coaching",
  "lms",
  "exit",
  "org",
  "workflow",
  "workforce_mandate",
  "client_portal",
  "leadership_dashboard",
  "reports",
  "audit_logs",
  "settings",
  "access_control",
  "demo_seed",
  "account_control",
] as const;

export type PeopleOSModule = (typeof MODULES)[number];

/**
 * Role → allowed modules mapping.
 * Used for sidebar filtering and API access hints.
 * Specific row-level scoping is enforced server-side via user_assignment_scope.
 */
export const ROLE_MODULE_ACCESS: Record<PeopleOSRole, PeopleOSModule[]> = {
  super_admin: [...MODULES] as PeopleOSModule[],
  admin: [...MODULES] as PeopleOSModule[],

  hr: [
    "dashboard", "employees", "ats", "documents", "lifecycle", "assets",
    "helpdesk", "leave", "attendance", "exit", "org", "workflow",
    "workforce_mandate", "reports", "audit_logs", "account_control",
    "lms", "kpi", "performance_feedback", "engagement",
  ],

  recruiter: [
    "dashboard", "ats", "helpdesk", "engagement",
  ],

  employee: [
    "dashboard", "employees", "documents", "assets", "helpdesk",
    "leave", "attendance", "payslip", "tax_declaration",
    "lms", "performance", "performance_feedback", "engagement", "wfm_roster",
  ],

  wfm: [
    "dashboard", "employees", "attendance", "wfm_roster", "wfm_rta",
    "wfm_shrinkage", "workforce_mandate", "leave", "reports", "engagement",
  ],

  process_manager: [
    "dashboard", "employees", "attendance", "wfm_roster", "wfm_rta",
    "wfm_shrinkage", "workforce_mandate", "leave", "kpi", "performance",
    "performance_feedback", "engagement", "coaching", "reports", "helpdesk",
  ],

  assistant_manager: [
    "dashboard", "employees", "attendance", "wfm_roster",
    "leave", "kpi", "performance", "performance_feedback", "engagement", "coaching", "helpdesk",
  ],

  team_leader: [
    "dashboard", "employees", "attendance", "leave",
    "kpi", "performance", "performance_feedback", "engagement", "coaching", "helpdesk",
  ],

  qa: [
    "dashboard", "employees", "quality", "performance", "coaching",
    "kpi", "reports", "helpdesk", "engagement",
  ],

  trainer: [
    "dashboard", "lms", "employees", "helpdesk", "engagement",
  ],

  finance: [
    "dashboard", "payroll", "payslip", "tax_declaration", "org",
    "workforce_mandate", "reports", "audit_logs", "engagement",
  ],

  payroll: [
    "dashboard", "payroll", "payslip", "tax_declaration",
    "reports", "audit_logs", "engagement",
  ],

  branch_head: [
    "dashboard", "employees", "attendance", "wfm_roster", "wfm_rta",
    "wfm_shrinkage", "workforce_mandate", "leave", "kpi", "performance",
    "performance_feedback", "engagement", "coaching", "reports", "ats",
  ],

  ceo: [
    "dashboard", "leadership_dashboard", "workforce_mandate",
    "kpi", "performance", "performance_feedback", "engagement", "reports", "wfm_shrinkage",
    "client_portal", "org",
  ],

  client_user: [
    "client_portal",
  ],

  mcp_server: [],
};

/** Pages explicitly blocked from client portal regardless of role */
export const CLIENT_PORTAL_BLOCKED_DATA = [
  "payroll",
  "payslip",
  "tax_declaration",
  "documents",
  "attendance_reasons",
  "raw_roster_rows",
  "grievance",
  "disciplinary",
  "candidate_pii",
  "employee_personal",
] as const;

/**
 * Check if a role has access to a module.
 * Does not check row-level scope — use hasProcessScope() for that.
 */
export function roleCanAccess(role: PeopleOSRole | string, module: PeopleOSModule | string): boolean {
  const access = ROLE_MODULE_ACCESS[role as PeopleOSRole];
  if (!access) return false;
  return access.includes(module as PeopleOSModule);
}
