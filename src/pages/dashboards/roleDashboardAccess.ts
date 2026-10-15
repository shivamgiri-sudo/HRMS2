import {
  DASHBOARD_ACCESS_REGISTRY,
  canAccessDashboard,
  normalizeDashboardRole,
} from "../../../backend/src/shared/dashboardAccessRegistry";

export type RoleDashboardVariant =
  | "employee"
  | "wfm"
  | "wfm_attendance"
  | "hr"
  | "ceo"
  | "branch_head"
  | "payroll"
  | "manager"
  | "super_admin"
  | "quality"
  | "operations"
  | "recruiter"
  | "it_manager";

const DASHBOARD_BY_VARIANT = Object.fromEntries(
  Object.values(DASHBOARD_ACCESS_REGISTRY).map((item) => [item.variant, item]),
) as Record<RoleDashboardVariant, (typeof DASHBOARD_ACCESS_REGISTRY)[keyof typeof DASHBOARD_ACCESS_REGISTRY]>;

export const ROLE_VARIANT_MAP: Readonly<Record<RoleDashboardVariant, readonly string[]>> =
  Object.fromEntries(
    Object.entries(DASHBOARD_BY_VARIANT).map(([variant, item]) => [
      variant,
      item.allowedRoleKeys,
    ]),
  ) as Record<RoleDashboardVariant, readonly string[]>;

const RESOLUTION_PRIORITY: readonly RoleDashboardVariant[] = [
  "super_admin",
  "ceo",
  "branch_head",
  "hr",
  "wfm_attendance",
  "wfm",
  "payroll",
  "manager",
  "quality",
  "operations",
  "recruiter",
  "it_manager",
  "employee",
];

/** Build-time flag; read at call time so tests can stub it. Off => branch_head variant is invisible. */
function branchHeadFlagOn(): boolean {
  return import.meta.env?.VITE_BRANCH_HEAD_HEALTH_ENABLED === "true";
}

export function resolveRoleDashboardVariant(
  roleKeys: readonly string[],
  opts?: { branchHeadEnabled?: boolean },
): RoleDashboardVariant {
  const branchHeadEnabled = opts?.branchHeadEnabled ?? branchHeadFlagOn();
  const normalized = new Set(roleKeys.map(normalizeDashboardRole));
  for (const variant of RESOLUTION_PRIORITY) {
    if (variant === "branch_head" && branchHeadEnabled !== true) continue;
    if (ROLE_VARIANT_MAP[variant].some((role) => normalized.has(role))) return variant;
  }
  return "employee";
}

export function canAccessRoleDashboard(
  variant: RoleDashboardVariant,
  roleKeys: readonly string[],
): boolean {
  if (variant === "branch_head" && !branchHeadFlagOn()) return false;
  const normalized = new Set(roleKeys.map((role) => String(role).trim().toLowerCase()));
  const dashboard = DASHBOARD_BY_VARIANT[variant];
  return dashboard ? canAccessDashboard(dashboard.code, [...normalized]) : false;
}
