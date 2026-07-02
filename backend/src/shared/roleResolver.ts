import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const ROLE_PRIORITY: Record<string, number> = {
  super_admin: 100, admin: 95, ceo: 90, management: 88,
  ho_hr: 85, ho_payroll: 84, ho_operations: 83, ho_wfm: 82, ho_rta: 81, ho_it: 80,
  compliance_head: 78, finance_head: 77, payroll_head: 76, operations_head: 75,
  branch_head: 60, bm: 59, branch_manager: 58,
  branch_hr: 50, hr_branch: 49,
  branch_finance: 45, branch_it: 44,
  process_manager: 40, team_lead: 38,
  wfm_spoc: 35, qa_manager: 34, quality_analyst: 33, process_hr: 32,
  payroll_hr: 30, recruiter: 28,
  employee: 10, agent: 9, trainee: 8,
};

export async function getUserRoleKeys(userId: string): Promise<string[]> {
  // Try user_roles table first
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
      [userId]
    );
    if ((rows as any[]).length > 0) return (rows as any[]).map((r: any) => r.role_key);
  } catch {}
  // Fallback: auth_user table role column
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT role FROM auth_user WHERE id = ? LIMIT 1",
      [userId]
    );
    if ((rows as any[]).length > 0 && (rows as any)[0].role) {
      return [(rows as any)[0].role as string];
    }
  } catch {}
  // Fallback: employees table
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT role FROM employees WHERE auth_user_id = ? LIMIT 1",
      [userId]
    );
    if ((rows as any[]).length > 0 && (rows as any)[0].role) {
      return [(rows as any)[0].role as string];
    }
  } catch {}
  console.warn(`[roleResolver] Could not resolve roles for user ${userId} — falling back to 'employee'`);
  return ['employee'];
}

export function resolvePrimaryRole(roleKeys: string[]): string {
  if (!roleKeys.length) return 'employee';
  return roleKeys.sort((a, b) => (ROLE_PRIORITY[b] ?? 0) - (ROLE_PRIORITY[a] ?? 0))[0];
}

export async function getUserRoleContext(userId: string): Promise<{
  roleKeys: string[];
  primaryRole: string;
  isSuperAdmin: boolean;
  isHO: boolean;
}> {
  const roleKeys = await getUserRoleKeys(userId);
  const primaryRole = resolvePrimaryRole(roleKeys);
  const isSuperAdmin = roleKeys.includes('super_admin') || roleKeys.includes('admin');
  const isHO = roleKeys.some(r => r.startsWith('ho_') || r === 'ceo' || r === 'management');
  return { roleKeys, primaryRole, isSuperAdmin, isHO };
}
