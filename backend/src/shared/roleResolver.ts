import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Role priority is shared by authentication and dashboard scope resolution.
 * Every role used by the role dashboards is explicitly ranked so an employee
 * role can never accidentally outrank a scoped WFM, manager, HR or payroll role.
 */
const ROLE_PRIORITY: Readonly<Record<string, number>> = {
  super_admin: 100,
  admin: 98,
  ceo: 96,
  coo: 95,
  management: 94,

  ho_hr: 92,
  hr_admin: 91,
  hr: 90,
  compliance_head: 89,

  ho_payroll: 88,
  payroll_head: 87,
  finance_head: 86,
  accounts_head: 85,
  payroll_admin: 84,
  payroll_hr: 83,
  payroll: 82,
  finance: 81,

  ho_operations: 80,
  operations_head: 79,
  ho_wfm: 78,
  ho_rta: 77,
  wfm: 76,
  wfm_spoc: 75,
  rta: 74,

  branch_head: 70,
  bm: 69,
  branch_manager: 68,
  branch_hr: 67,
  hr_branch: 66,
  branch_finance: 65,
  payroll_branch: 64,
  branch_it: 63,

  process_manager: 60,
  manager: 59,
  assistant_manager: 58,
  team_leader: 57,
  team_lead: 56,
  tl: 55,
  process_hr: 54,
  qa_manager: 53,
  quality_analyst: 52,

  recruiter: 45,
  trainer: 44,
  qa: 43,
  ho_it: 42,

  employee: 10,
  agent: 9,
  trainee: 8,
};

function normalizeRole(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueRoles(values: unknown[]): string[] {
  return Array.from(new Set(values.map(normalizeRole).filter(Boolean)));
}

export async function getUserRoleKeys(userId: string): Promise<string[]> {
  const resolved: string[] = [];

  // MySQL user_roles remains the role authority.
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
      [userId],
    );
    resolved.push(...rows.map((row) => row.role_key));
  } catch (error) {
    console.error("[roleResolver] user_roles lookup failed", error);
  }

  // Scoped assignments also carry a role_key. They must participate in role
  // resolution because many WFM/manager accounts are provisioned through scope.
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT role_key FROM user_assignment_scope WHERE user_id = ? AND active_status = 1",
      [userId],
    );
    resolved.push(...rows.map((row) => row.role_key));
  } catch {
    // Older databases may not have this table yet; user_roles still works.
  }

  // Compatibility fallback for installations that still store one role on auth_user.
  if (resolved.length === 0) {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        "SELECT role FROM auth_user WHERE id = ? LIMIT 1",
        [userId],
      );
      if (rows[0]?.role) resolved.push(rows[0].role);
    } catch {
      // The role column is optional in current schema.
    }
  }

  // A mapped employee with no explicit role receives employee access only.
  if (resolved.length === 0) {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
        [userId],
      );
      if (rows.length > 0) resolved.push("employee");
    } catch {
      // Final fallback below.
    }
  }

  const roles = uniqueRoles(resolved);
  if (roles.length > 0) return roles;

  console.warn(`[roleResolver] Could not resolve roles for user ${userId}; using employee access`);
  return ["employee"];
}

export function resolvePrimaryRole(roleKeys: readonly string[]): string {
  const normalized = uniqueRoles([...roleKeys]);
  if (normalized.length === 0) return "employee";

  return [...normalized].sort((left, right) => {
    const priorityDifference = (ROLE_PRIORITY[right] ?? 0) - (ROLE_PRIORITY[left] ?? 0);
    return priorityDifference !== 0 ? priorityDifference : left.localeCompare(right);
  })[0];
}

export async function getUserRoleContext(userId: string): Promise<{
  roleKeys: string[];
  primaryRole: string;
  isSuperAdmin: boolean;
  isHO: boolean;
}> {
  const roleKeys = await getUserRoleKeys(userId);
  const primaryRole = resolvePrimaryRole(roleKeys);
  const isSuperAdmin = roleKeys.includes("super_admin") || roleKeys.includes("admin");
  const isHO = roleKeys.some((role) =>
    role.startsWith("ho_") || ["ceo", "coo", "management"].includes(role),
  );

  return { roleKeys, primaryRole, isSuperAdmin, isHO };
}
