export type RoleDashboardVariant =
  | "employee"
  | "wfm"
  | "wfm_attendance"
  | "hr"
  | "ceo"
  | "payroll"
  | "manager"
  | "super_admin"
  | "quality"
  | "operations"
  | "recruiter"
  | "it_manager";

export const ROLE_VARIANT_MAP: Readonly<Record<RoleDashboardVariant, readonly string[]>> = {
  super_admin: ["super_admin", "admin"],
  ceo: ["ceo", "coo"],
  hr: ["hr", "hr_admin", "branch_hr", "ho_hr"],
  wfm: ["wfm", "ho_wfm", "wfm_spoc", "rta", "ho_rta"],
  wfm_attendance: ["wfm", "ho_wfm", "wfm_spoc", "rta", "ho_rta", "admin", "super_admin"],
  payroll: [
    "payroll",
    "payroll_hr",
    "payroll_head",
    "payroll_branch",
    "payroll_admin",
    "finance",
    "finance_head",
    "accounts_head",
    "branch_finance",
    "ho_payroll",
  ],
  manager: [
    "manager",
    "process_manager",
    "assistant_manager",
    "branch_head",
    "branch_manager",
    "team_leader",
    "team_lead",
    "tl",
  ],
  employee: ["employee", "agent", "trainee"],
  quality: ["qa", "quality_analyst", "quality_lead", "qa_analyst", "qa_lead"],
  operations: ["operations_manager", "ops_manager", "floor_manager", "process_lead"],
  recruiter: ["recruiter", "recruitment_hr", "talent_acquisition", "ta_lead"],
  it_manager: ["it", "branch_it", "it_admin"],
};

const RESOLUTION_PRIORITY: readonly RoleDashboardVariant[] = [
  "super_admin",
  "ceo",
  "hr",
  "wfm_attendance",
  "wfm",
  "payroll",
  "quality",
  "operations",
  "recruiter",
  "it_manager",
  "manager",
  "employee",
];

export function resolveRoleDashboardVariant(roleKeys: readonly string[]): RoleDashboardVariant {
  const normalized = new Set(roleKeys.map((role) => String(role).trim().toLowerCase()));
  for (const variant of RESOLUTION_PRIORITY) {
    if (ROLE_VARIANT_MAP[variant].some((role) => normalized.has(role))) return variant;
  }
  return "employee";
}

export function canAccessRoleDashboard(
  variant: RoleDashboardVariant,
  roleKeys: readonly string[],
): boolean {
  const normalized = new Set(roleKeys.map((role) => String(role).trim().toLowerCase()));
  if (normalized.has("super_admin")) return true;
  return ROLE_VARIANT_MAP[variant].some((role) => normalized.has(role));
}
