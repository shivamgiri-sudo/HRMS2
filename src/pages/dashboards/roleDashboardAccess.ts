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
  const normalized = new Set(roleKeys.map(normalizeDashboardRole));
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
  const dashboard = DASHBOARD_BY_VARIANT[variant];
  return dashboard ? canAccessDashboard(dashboard.code, [...normalized]) : false;
}
