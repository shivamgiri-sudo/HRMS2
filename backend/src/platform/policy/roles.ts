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
  // Extended roles discovered via compile-time audit of existing route files
  HR_ADMIN_ALT:        "hr_admin",         // alternate hr key used in some modules
  QA_MANAGER:          "QA_Manager",       // legacy capitalised form in top-performers module
  QUALITY_MANAGER:     "Quality_Manager",  // another legacy capitalised form
  BRANCH_HR:           "branch_hr",
  BRANCH_IT:           "branch_it",
  HO_HR:               "ho_hr",            // Head-office HR role
  HO_PAYROLL:          "ho_payroll",
  HO_OPERATIONS:       "ho_operations",
  BM:                  "bm",               // Branch Manager (legacy alias)
  OPERATIONS:          "operations",
  OPERATIONS_HEAD:     "operations_head",
  MANAGEMENT:          "management",
  PAYROLL_ADMIN:       "payroll_admin",
  FINANCE_ADMIN:       "finance_admin",
  IT_ADMIN:            "it_admin",
  COMPLIANCE:          "compliance",
  DPO:                 "dpo",              // Data Protection Officer
  SECURITY:            "security",
  SECURITY_HEAD:       "security_head",
  SALES:               "sales",
  ANALYST:             "analyst",
  WFM_SPOC:            "wfm_spoc",
  SUPER_ADMIN_DISPLAY: "Super Admin",      // legacy display name (non-canonical — do not use in new code)
  // Internal / system
  ADMIN:               "admin",
  DEMO:                "demo",
} as const;

export type RoleKey = typeof Role[keyof typeof Role];

const ROLE_VALUES = new Set<RoleKey>(Object.values(Role));

const LEGACY_ROLE_EQUIVALENTS: Readonly<Record<string, RoleKey[]>> = {
  hr_admin: [Role.HR_ADMIN],
  hr_admin_alt: [Role.HR_ADMIN],
  hr_admin_display: [Role.HR_ADMIN],
  branch_hr: [Role.HR_ADMIN],
  ho_hr: [Role.HR_ADMIN],
  hr_admin_: [Role.HR_ADMIN],
  qa_manager: [Role.QA],
  quality_manager: [Role.QA],
  qa_manager_: [Role.QA],
  quality_manager_: [Role.QA],
  operations_manager: [Role.OPERATIONS_MANAGER],
  operations: [Role.OPERATIONS_MANAGER],
  operations_head: [Role.OPERATIONS_MANAGER],
  ho_operations: [Role.OPERATIONS_MANAGER],
  management: [
    Role.CEO,
    Role.COO,
    Role.BRANCH_HEAD,
    Role.OPERATIONS_MANAGER,
    Role.MANAGER,
    Role.PROCESS_MANAGER,
  ],
  ho_payroll: [Role.PAYROLL_HEAD],
  payroll_admin: [Role.PAYROLL],
  wfm_spoc: [Role.WFM],
  ho_wfm: [Role.WFM],
  branch_it: [Role.IT],
  it_admin: [Role.IT],
  bm: [Role.BRANCH_HEAD],
  analyst: [Role.QUALITY_ANALYST],
  finance_admin: [Role.FINANCE, Role.FINANCE_HEAD, Role.ACCOUNTS_HEAD],
  super_admin: [Role.SUPER_ADMIN],
  super_admin_display: [Role.SUPER_ADMIN],
};

function canonicalizeRoleLabel(role: string): string {
  return role.trim().replace(/[\s-]+/g, "_").toLowerCase();
}

function isRoleKey(role: string): role is RoleKey {
  return ROLE_VALUES.has(role as RoleKey);
}

export function normalizeRoleInputs(roles: readonly string[]): RoleKey[] {
  const normalized = new Set<RoleKey>();

  for (const rawRole of roles) {
    const canonical = canonicalizeRoleLabel(rawRole);
    const mapped = LEGACY_ROLE_EQUIVALENTS[canonical];

    if (mapped) {
      mapped.forEach((role) => normalized.add(role));
      continue;
    }

    if (isRoleKey(rawRole)) {
      normalized.add(rawRole);
      continue;
    }

    if (isRoleKey(canonical)) {
      normalized.add(canonical);
      continue;
    }

    normalized.add(rawRole as RoleKey);
  }

  return Array.from(normalized);
}

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
