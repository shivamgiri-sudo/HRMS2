/**
 * Canonical role registry for MAS PeopleOS.
 *
 * All roles used in requireRole(), frontend ProtectedRoute, and DB user_roles
 * must be members of this enum. Adding a new role: add it here, then add it to
 * user_roles FK constraint (or its equivalent enum column) in a new migration.
 *
 * Rule: never use a raw string where Role is expected — import this enum.
 */
export const Role = {
  SUPER_ADMIN:         "super_admin",
  HR_ADMIN:            "hr",
  RECRUITMENT_HR:      "recruitment_hr",
  RECRUITER:           "recruiter",
  FINANCE:             "finance",
  FINANCE_HEAD:        "finance_head",
  ACCOUNTS_HEAD:       "accounts_head",
  PAYROLL:             "payroll",
  PAYROLL_HEAD:        "payroll_head",
  PAYROLL_BRANCH:      "payroll_branch",
  PAYROLL_HR:          "payroll_hr",
  WFM:                 "wfm",
  WFM_ANALYST:         "wfm_analyst",
  BRANCH_HEAD:         "branch_head",
  OPERATIONS_MANAGER:  "operations_manager",
  PROCESS_MANAGER:     "process_manager",
  MANAGER:             "manager",
  TEAM_LEADER:         "team_leader",
  TL:                  "tl",
  ASSISTANT_MANAGER:   "assistant_manager",
  TRAINER:             "trainer",
  QA:                  "qa",
  QUALITY_ANALYST:     "quality_analyst",
  EMPLOYEE:            "employee",
  CEO:                 "ceo",
  COO:                 "coo",
  IT:                  "it",
  BRANCH_ADMIN:        "branch_admin",
  CLIENT:              "client",
  // Internal / system
  ADMIN:               "admin",
  DEMO:                "demo",
} as const;

export type RoleKey = typeof Role[keyof typeof Role];

/**
 * Canonical role aliases. Bidirectional pairs that are treated as equivalent
 * by requireRole() and any RBAC check.
 */
export const ROLE_ALIASES: Readonly<Partial<Record<RoleKey, RoleKey[]>>> = {
  [Role.PROCESS_MANAGER]: [Role.MANAGER],
  [Role.MANAGER]:         [Role.PROCESS_MANAGER],
  [Role.TEAM_LEADER]:     [Role.TL],
  [Role.TL]:              [Role.TEAM_LEADER],
  [Role.WFM]:             [Role.WFM_ANALYST],
  [Role.WFM_ANALYST]:     [Role.WFM],
};

/** Expand a set of roles to include all known aliases */
export function expandRoles(roles: RoleKey[]): RoleKey[] {
  const expanded = new Set(roles);
  for (const r of roles) {
    (ROLE_ALIASES[r] ?? []).forEach(a => expanded.add(a));
  }
  return Array.from(expanded);
}

/**
 * Roles that are considered "management" for purposes of cross-branch
 * data access and visibility (not scope bypass — scope is enforced separately).
 */
export const MANAGEMENT_ROLES: RoleKey[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.CEO,
  Role.COO,
];

/**
 * Roles that have payroll-data visibility. NEVER expose payroll data to roles
 * outside this set via any API response.
 */
export const PAYROLL_ROLES: RoleKey[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.PAYROLL,
  Role.PAYROLL_HEAD,
  Role.PAYROLL_BRANCH,
  Role.PAYROLL_HR,
  Role.FINANCE,
  Role.FINANCE_HEAD,
  Role.ACCOUNTS_HEAD,
];

/**
 * Roles that can read employee PII (name, DOB, address, bank, PAN/Aadhaar).
 * Client role is intentionally excluded — never expose PII to client portal.
 */
export const PII_READ_ROLES: RoleKey[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.HR_ADMIN,
  Role.PAYROLL,
  Role.PAYROLL_HEAD,
  Role.PAYROLL_BRANCH,
  Role.PAYROLL_HR,
  Role.RECRUITMENT_HR,
  Role.RECRUITER,
  Role.BRANCH_HEAD,
  Role.OPERATIONS_MANAGER,
  Role.FINANCE,
  Role.FINANCE_HEAD,
];
