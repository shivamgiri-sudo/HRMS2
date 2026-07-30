/**
 * Snapshot of the roles that actually exist in `workforce_role_catalog`.
 *
 * This matters because `user_roles.role_key` is FK-constrained to that table: a role
 * key that is not here CANNOT be assigned to anyone, no matter what the code says.
 * The dashboard registry had drifted onto an aspirational vocabulary (`ho_hr`,
 * `wfm_spoc`, `quality_lead`, `branch_manager`, `operations_head`, …) that the database
 * has never contained, while real roles the business does use (`it_head`, `tq_head`,
 * `branch_admin`, `interviewer`) were unknown to the code — so those users got no
 * dashboard at all.
 *
 * Captured 2026-07-30 from mas_hrms. The four *_head roles were added 2026-07-30 00:25.
 * Refresh with: npx tsx scripts/role-dashboard-gap.ts (it reads the live table).
 */
export const WORKFORCE_ROLE_CATALOG = [
  "accounts_head",
  "admin",
  "assistant_manager",
  "branch_admin",
  "branch_head",
  "branch_it",
  "ceo",
  "employee",
  "finance",
  "finance_head",
  "hr",
  "interviewer",
  "it",
  "it_head",
  "manager",
  "payroll",
  "payroll_admin",
  "payroll_head",
  "payroll_hr",
  "process_manager",
  "qa",
  "recruiter",
  "super_admin",
  "team_leader",
  "tl",
  "tq_head",
  "trainer",
  "wfm",
] as const;

export type WorkforceRoleKey = (typeof WORKFORCE_ROLE_CATALOG)[number];

const CATALOG_SET: ReadonlySet<string> = new Set(WORKFORCE_ROLE_CATALOG);

export function isAssignableRole(roleKey: string): boolean {
  return CATALOG_SET.has(String(roleKey).trim().toLowerCase());
}

/**
 * Roles intentionally granted only the self dashboard: administrative or specialist
 * roles with no dedicated data surface of their own. They are NOT locked out — every
 * assignable role must reach at least one dashboard.
 */
export const SELF_DASHBOARD_ONLY_ROLES: readonly string[] = [
  "admin",
  "branch_admin",
  "interviewer",
  "trainer",
];
