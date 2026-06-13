import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

export interface BranchScope {
  isSuperAdmin: boolean;
  branchIds: string[];  // empty = all, non-empty = restricted list
}

const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo'];

export async function resolveBranchScope(userId: string): Promise<BranchScope> {
  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  const roles = (roleRows as { role_key: string }[]).map(r => r.role_key);

  if (roles.some(r => SUPER_ADMIN_ROLES.includes(r))) {
    return { isSuperAdmin: true, branchIds: [] };
  }

  const [scopeRows] = await db.execute<RowDataPacket[]>(
    `SELECT scope_type, branch_id
       FROM user_assignment_scope
      WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  const scopes = scopeRows as { scope_type: string; branch_id: string | null }[];

  if (scopes.some(s => s.scope_type === 'all')) {
    return { isSuperAdmin: false, branchIds: [] };
  }

  const branchIds = scopes
    .map(s => s.branch_id)
    .filter((id): id is string => !!id);

  if (branchIds.length === 0) {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
      [userId]
    );
    const emp = empRows as { branch_id: string | null }[];
    if (emp[0]?.branch_id) branchIds.push(emp[0].branch_id);
  }

  return { isSuperAdmin: false, branchIds };
}
