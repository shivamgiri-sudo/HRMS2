import { Role, type RoleKey } from "./roles.js";

/**
 * Domain permission codes.
 *
 * Each code represents a discrete action on a resource. Route handlers call
 * checkPermission() or the can() helper with one of these codes and the
 * caller's roles; the policy table below resolves the decision.
 *
 * Adding a new permission: add the code here, add it to PERMISSION_MAP,
 * write a test in backend/tests/policy.test.ts.
 */
export const Permission = {
  // Employee
  EMPLOYEE_READ:              "employee:read",
  EMPLOYEE_WRITE:             "employee:write",
  EMPLOYEE_PII_READ:          "employee:pii:read",
  EMPLOYEE_PAYROLL_READ:      "employee:payroll:read",
  EMPLOYEE_REACTIVATE:        "employee:reactivate",

  // ATS
  ATS_CANDIDATE_READ:         "ats:candidate:read",
  ATS_CANDIDATE_WRITE:        "ats:candidate:write",
  ATS_OFFER_APPROVE:          "ats:offer:approve",
  ATS_BGV_MANAGE:             "ats:bgv:manage",
  ATS_PAYROLL_VALIDATE:       "ats:payroll:validate",
  ATS_BULK_IMPORT:            "ats:bulk:import",

  // Attendance
  ATTENDANCE_READ_SELF:       "attendance:self:read",
  ATTENDANCE_READ_TEAM:       "attendance:team:read",
  ATTENDANCE_READ_ALL:        "attendance:all:read",
  ATTENDANCE_REGULARIZE_SELF: "attendance:regularize:self",
  ATTENDANCE_REGULARIZE_TEAM: "attendance:regularize:team",
  ATTENDANCE_REGULARIZE_ALL:  "attendance:regularize:all",

  // Leave
  LEAVE_APPLY:                "leave:apply",
  LEAVE_APPROVE_TEAM:         "leave:approve:team",
  LEAVE_APPROVE_ALL:          "leave:approve:all",
  LEAVE_CONFIG:               "leave:config",

  // Payroll
  PAYROLL_RUN:                "payroll:run",
  PAYROLL_APPROVE:            "payroll:approve",
  PAYROLL_VIEW_SELF:          "payroll:self:view",
  PAYROLL_VIEW_BRANCH:        "payroll:branch:view",
  PAYROLL_VIEW_ALL:           "payroll:all:view",
  PAYROLL_CONFIG:             "payroll:config",
  PAYROLL_SIGN_OFF:           "payroll:signoff",
  PAYROLL_DISBURSEMENT:       "payroll:disbursement",

  // WFM / Roster
  ROSTER_READ:                "roster:read",
  ROSTER_PUBLISH:             "roster:publish",
  ROSTER_MANAGE:              "roster:manage",
  WFM_LIVE_TRACKER:           "wfm:live:read",

  // Performance / KPI
  KPI_READ:                   "kpi:read",
  KPI_MANAGE:                 "kpi:manage",
  QUALITY_READ:               "quality:read",
  QUALITY_MANAGE:             "quality:manage",

  // LMS
  LMS_LEARNER:                "lms:learner",
  LMS_COORDINATOR:            "lms:coordinator",
  LMS_ADMIN:                  "lms:admin",

  // Compliance / statutory
  COMPLIANCE_READ:            "compliance:read",
  COMPLIANCE_MANAGE:          "compliance:manage",

  // Finance / ERP
  FINANCE_READ:               "finance:read",
  FINANCE_MANAGE:             "finance:manage",
  VENDOR_MANAGE:              "vendor:manage",
  PROCUREMENT_MANAGE:         "procurement:manage",

  // Platform / admin
  ACCESS_CONTROL:             "platform:access:control",
  AUDIT_LOG_READ:             "platform:audit:read",
  INTEGRATION_HUB:            "platform:integration",
  MIGRATION_CONSOLE:          "platform:migration",
  AI_PROVIDER_CONFIG:         "platform:ai:config",
  CLIENT_MASTER_MANAGE:       "platform:client:manage",

  // Client portal — restricted to non-PII aggregate data
  PORTAL_PROCESS_READ:        "portal:process:read",
} as const;

export type PermissionCode = typeof Permission[keyof typeof Permission];

/**
 * Policy map: permission → minimal set of roles that satisfy it.
 * super_admin satisfies every permission (enforced in can() below).
 */
const PERMISSION_MAP: Record<PermissionCode, RoleKey[]> = {
  "employee:read":              [Role.ADMIN, Role.HR_ADMIN, Role.PAYROLL, Role.PAYROLL_HEAD, Role.PAYROLL_HR, Role.BRANCH_HEAD, Role.OPERATIONS_MANAGER, Role.MANAGER, Role.PROCESS_MANAGER, Role.RECRUITER, Role.RECRUITMENT_HR, Role.FINANCE, Role.FINANCE_HEAD, Role.WFM],
  "employee:write":             [Role.ADMIN, Role.HR_ADMIN, Role.PAYROLL_HR, Role.RECRUITMENT_HR],
  "employee:pii:read":          [Role.ADMIN, Role.HR_ADMIN, Role.PAYROLL, Role.PAYROLL_HEAD, Role.PAYROLL_HR, Role.FINANCE, Role.FINANCE_HEAD, Role.RECRUITMENT_HR, Role.RECRUITER],
  "employee:payroll:read":      [Role.ADMIN, Role.PAYROLL, Role.PAYROLL_HEAD, Role.PAYROLL_BRANCH, Role.PAYROLL_HR, Role.FINANCE, Role.FINANCE_HEAD, Role.ACCOUNTS_HEAD],
  "employee:reactivate":        [Role.ADMIN, Role.HR_ADMIN, Role.BRANCH_HEAD, Role.PAYROLL_HEAD],

  "ats:candidate:read":         [Role.ADMIN, Role.HR_ADMIN, Role.RECRUITMENT_HR, Role.RECRUITER, Role.BRANCH_HEAD],
  "ats:candidate:write":        [Role.ADMIN, Role.HR_ADMIN, Role.RECRUITMENT_HR, Role.RECRUITER],
  "ats:offer:approve":          [Role.ADMIN, Role.HR_ADMIN, Role.BRANCH_HEAD, Role.OPERATIONS_MANAGER],
  "ats:bgv:manage":             [Role.ADMIN, Role.HR_ADMIN],
  "ats:payroll:validate":       [Role.ADMIN, Role.HR_ADMIN, Role.PAYROLL_HR, Role.PAYROLL],
  "ats:bulk:import":            [Role.ADMIN],

  "attendance:self:read":       [Role.EMPLOYEE, Role.MANAGER, Role.PROCESS_MANAGER, Role.TEAM_LEADER, Role.HR_ADMIN, Role.PAYROLL, Role.WFM],
  "attendance:team:read":       [Role.MANAGER, Role.PROCESS_MANAGER, Role.TEAM_LEADER, Role.TL, Role.BRANCH_HEAD, Role.HR_ADMIN, Role.WFM],
  "attendance:all:read":        [Role.ADMIN, Role.HR_ADMIN, Role.PAYROLL_HEAD, Role.PAYROLL, Role.WFM],
  "attendance:regularize:self": [Role.EMPLOYEE, Role.MANAGER, Role.PROCESS_MANAGER, Role.TEAM_LEADER],
  "attendance:regularize:team": [Role.MANAGER, Role.PROCESS_MANAGER, Role.TEAM_LEADER, Role.BRANCH_HEAD, Role.HR_ADMIN, Role.WFM],
  "attendance:regularize:all":  [Role.ADMIN, Role.HR_ADMIN, Role.WFM, Role.PAYROLL],

  "leave:apply":                [Role.EMPLOYEE, Role.MANAGER, Role.PROCESS_MANAGER, Role.TEAM_LEADER, Role.HR_ADMIN],
  "leave:approve:team":         [Role.MANAGER, Role.PROCESS_MANAGER, Role.TEAM_LEADER, Role.BRANCH_HEAD, Role.HR_ADMIN],
  "leave:approve:all":          [Role.ADMIN, Role.HR_ADMIN],
  "leave:config":               [Role.ADMIN, Role.HR_ADMIN],

  "payroll:run":                [Role.ADMIN, Role.PAYROLL_HEAD],
  "payroll:approve":            [Role.ADMIN, Role.PAYROLL_HEAD, Role.FINANCE_HEAD],
  "payroll:self:view":          [Role.EMPLOYEE, Role.MANAGER, Role.PROCESS_MANAGER, Role.TEAM_LEADER, Role.HR_ADMIN, Role.PAYROLL, Role.PAYROLL_HEAD, Role.FINANCE],
  "payroll:branch:view":        [Role.ADMIN, Role.PAYROLL_HEAD, Role.PAYROLL_BRANCH, Role.FINANCE_HEAD, Role.BRANCH_HEAD],
  "payroll:all:view":           [Role.ADMIN, Role.PAYROLL_HEAD, Role.FINANCE_HEAD, Role.ACCOUNTS_HEAD, Role.CEO, Role.COO],
  "payroll:config":             [Role.ADMIN, Role.PAYROLL_HEAD],
  "payroll:signoff":            [Role.ADMIN, Role.PAYROLL_HEAD, Role.FINANCE_HEAD, Role.CEO],
  "payroll:disbursement":       [Role.ADMIN, Role.PAYROLL, Role.FINANCE],

  "roster:read":                [Role.EMPLOYEE, Role.MANAGER, Role.PROCESS_MANAGER, Role.TEAM_LEADER, Role.BRANCH_HEAD, Role.HR_ADMIN, Role.WFM],
  "roster:publish":             [Role.ADMIN, Role.WFM, Role.PROCESS_MANAGER, Role.MANAGER],
  "roster:manage":              [Role.ADMIN, Role.WFM, Role.HR_ADMIN],
  "wfm:live:read":              [Role.ADMIN, Role.WFM, Role.BRANCH_HEAD, Role.OPERATIONS_MANAGER, Role.PROCESS_MANAGER],

  "kpi:read":                   [Role.ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.PROCESS_MANAGER, Role.BRANCH_HEAD, Role.OPERATIONS_MANAGER, Role.CEO, Role.COO, Role.EMPLOYEE],
  "kpi:manage":                 [Role.ADMIN, Role.HR_ADMIN, Role.OPERATIONS_MANAGER],
  "quality:read":               [Role.ADMIN, Role.HR_ADMIN, Role.QA, Role.QUALITY_ANALYST, Role.MANAGER, Role.PROCESS_MANAGER, Role.BRANCH_HEAD, Role.OPERATIONS_MANAGER, Role.CEO],
  "quality:manage":             [Role.ADMIN, Role.HR_ADMIN, Role.QA],

  "lms:learner":                [Role.EMPLOYEE, Role.MANAGER, Role.PROCESS_MANAGER, Role.TEAM_LEADER, Role.TRAINER],
  "lms:coordinator":            [Role.ADMIN, Role.HR_ADMIN, Role.TRAINER],
  "lms:admin":                  [Role.ADMIN, Role.HR_ADMIN],

  "compliance:read":            [Role.ADMIN, Role.HR_ADMIN, Role.FINANCE, Role.FINANCE_HEAD, Role.PAYROLL_HEAD],
  "compliance:manage":          [Role.ADMIN, Role.HR_ADMIN],

  "finance:read":               [Role.ADMIN, Role.FINANCE, Role.FINANCE_HEAD, Role.ACCOUNTS_HEAD, Role.PAYROLL_HEAD, Role.CEO, Role.COO],
  "finance:manage":             [Role.ADMIN, Role.FINANCE_HEAD, Role.ACCOUNTS_HEAD],
  "vendor:manage":              [Role.ADMIN, Role.FINANCE, Role.FINANCE_HEAD, Role.MANAGER],
  "procurement:manage":         [Role.ADMIN, Role.FINANCE, Role.FINANCE_HEAD],

  "platform:access:control":    [Role.ADMIN],
  "platform:audit:read":        [Role.ADMIN, Role.HR_ADMIN, Role.PAYROLL_HEAD, Role.WFM],
  "platform:integration":       [Role.ADMIN],
  "platform:migration":         [Role.ADMIN],
  "platform:ai:config":         [Role.ADMIN],
  "platform:client:manage":     [Role.ADMIN, Role.BRANCH_HEAD, Role.OPERATIONS_MANAGER],

  "portal:process:read":        [Role.CLIENT],
};

/**
 * Synchronous role-based permission check.
 * Caller is responsible for providing the full expanded role list (from requireRole middleware).
 *
 * Usage:
 *   import { can, Permission } from "@/platform/policy/permissions.js";
 *   if (!can(req.userRoles, Permission.PAYROLL_VIEW_ALL)) return res.status(403)...
 */
export function can(userRoles: string[], permission: PermissionCode): boolean {
  if (!userRoles || userRoles.length === 0) return false;
  if (userRoles.includes(Role.SUPER_ADMIN)) return true;
  const allowed = PERMISSION_MAP[permission] as string[];
  return allowed.some(r => userRoles.includes(r));
}

/**
 * Assert a permission, throw 403 payload if denied.
 * Use in route handlers after requireRole() has populated req.userRoles.
 */
export function assertPermission(userRoles: string[], permission: PermissionCode): void {
  if (!can(userRoles, permission)) {
    const err: any = new Error(`Permission denied: ${permission}`);
    err.status = 403;
    err.payload = { success: false, message: `Access denied — insufficient permission for: ${permission}` };
    throw err;
  }
}
