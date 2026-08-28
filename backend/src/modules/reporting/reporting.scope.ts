import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type { ExecScope, DimensionScope } from './executors/types.js';
import { demoRoleForUserId } from '../../shared/demoAuth.js';

const NO_BRANCH_SCOPE_SENTINEL = '__NO_BRANCH_SCOPE__';

export interface BranchScope {
  isSuperAdmin: boolean;
  branchIds: string[];  // empty = all only for super admin or explicit all-scope users
}

const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo'];

export async function resolveBranchScope(userId: string): Promise<BranchScope> {
  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  const dbRoles = (roleRows as { role_key: string }[]).map(r => r.role_key);

  // Same demo-identity gap as resolveFullScope below: these ids exist in DEMO_TOKEN_MAP but
  // in neither user_roles nor employees, so without this the branch scope falls through to
  // the NO_BRANCH_SCOPE sentinel and every scoped report returns nothing. Both entry points
  // need it — patching only one leaves the report suite still empty, which is exactly what
  // happened on the first attempt at this fix.
  const demoRole = demoRoleForUserId(userId);
  const roles = demoRole ? [...dbRoles, demoRole] : dbRoles;

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

  // Fail closed: a non-super-admin user without explicit all-scope and without an
  // employee branch must not receive company-wide report data.
  if (branchIds.length === 0) branchIds.push(NO_BRANCH_SCOPE_SENTINEL);

  return { isSuperAdmin: false, branchIds };
}

// ---------------------------------------------------------------------------
// resolveFullScope — extended multi-dimensional scope for the executor layer
// ---------------------------------------------------------------------------

const ROLE_ALIASES: Record<string, string[]> = {
  finance_head:    ['finance'],
  accounts_head:   ['finance'],
  payroll_head:    ['payroll'],
  payroll_branch:  ['payroll'],
  payroll_hr:      ['payroll'],
  recruitment_hr:  ['recruiter'],
  quality_analyst: ['quality'],
  qa:              ['quality'],
  branch_hr:       ['hr'],
  hr_branch:       ['hr'],
  team_leader:     ['manager'],
  tl:              ['manager'],
};

function normRoles(raw: string[]): string[] {
  const flat = [...raw, ...raw.flatMap(r => ROLE_ALIASES[r] ?? [])];
  return [...new Set(flat)];
}

function dimAll(): DimensionScope   { return { mode: 'all',        ids: [] }; }
function dimRestricted(ids: string[]): DimensionScope { return { mode: 'restricted', ids }; }

/**
 * Resolve the complete multi-dimensional scope for a user.
 * Returns an ExecScope that all category executors must use.
 * Never returns ambiguous empty arrays — each dimension carries an explicit mode.
 */
export async function resolveFullScope(userId: string): Promise<ExecScope> {
  // 1. Fetch roles
  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  const rawRoles = (roleRows as { role_key: string }[]).map(r => r.role_key);

  // A demo-bypass identity has no row in user_roles and none in employees, so the query
  // above returns nothing and this function would conclude "no roles, no scope" — which
  // appendScopeConditions renders as `1 = 0`. Logged in as the demo super_admin, every
  // employee-grain report then returned 200 with totalCount 0, indistinguishable from a
  // broken report. Take the role from the same map authMiddleware authenticated against.
  //
  // demoRoleForUserId returns null unless INTERNAL_DEMO_BYPASS=true and NODE_ENV is not
  // production — the identical gate requireAuth applies — so production is unaffected.
  const demoRole = demoRoleForUserId(userId);
  const roles    = normRoles(demoRole ? [...rawRoles, demoRole] : rawRoles);
  const isSuperAdmin = roles.some(r => SUPER_ADMIN_ROLES.includes(r));

  // 2. Fetch employee record for self-service and fallback branch
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, branch_id, process_id, department_id, cost_centre_id,
            reporting_manager_id, manager_id
       FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [userId]
  );
  const emp = (empRows as any[])[0] ?? null;

  // 3. Fetch assignment scopes — cost_centre_id may not exist on older prod schema
  let scopeRows: RowDataPacket[];
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT scope_type, branch_id, process_id, department_id, cost_centre_id
         FROM user_assignment_scope
        WHERE user_id = ? AND active_status = 1`,
      [userId]
    );
    scopeRows = rows;
  } catch {
    // Fallback: query without cost_centre_id
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT scope_type, branch_id, process_id, department_id
         FROM user_assignment_scope
        WHERE user_id = ? AND active_status = 1`,
      [userId]
    );
    scopeRows = rows;
  }
  const scopes = scopeRows as {
    scope_type:     string;
    branch_id:      string | null;
    process_id:     string | null;
    department_id:  string | null;
    cost_centre_id: string | null;
  }[];

  const hasAllScope = isSuperAdmin || scopes.some(s => s.scope_type === 'all');

  // 4. Build dimension scopes
  function buildDim(
    field: 'branch_id' | 'process_id' | 'department_id' | 'cost_centre_id',
    fallback?: string | null
  ): DimensionScope {
    if (hasAllScope) return dimAll();

    const ids = scopes
      .map(s => s[field])
      .filter((id): id is string => !!id);

    if (ids.length > 0) return dimRestricted(ids);

    // An explicit assignment grant exists (branch/process/self) but does not restrict
    // this particular dimension — e.g. a process manager's scope_type 'process' row
    // carries no branch_id. That is a grant across every branch for their process, not
    // "narrow them to their own employee record's branch instead" — the grant is what
    // was given, the employee record is just where the person happens to sit.
    // departmentScope and costCentreScope below already treat an unrestricted dimension
    // this way; this brings branch_id and process_id in line with them. Confirmed live,
    // not theoretical: 20 active scope_type 'process' rows have branch_id NULL (real
    // process-manager accounts), and one branch_head's scope_type 'branch' row with
    // process_id NULL was turning "see this whole branch" into "see the one employee who
    // shares your own process" on every AON & Attrition report.
    if (scopes.length > 0) return dimAll();

    // No assignment scope at all — a bare, ungranted account. Self-service narrows to the
    // caller's own record rather than dimAll(), so an unmapped employee sees their own
    // branch/process instead of everyone's.
    if (fallback) return dimRestricted([fallback]);

    // No scope data and no fallback → fail closed
    return dimRestricted([NO_BRANCH_SCOPE_SENTINEL]);
  }

  const branchScope     = buildDim('branch_id',      emp?.branch_id);
  const processScope    = buildDim('process_id',     emp?.process_id);
  const departmentScope = hasAllScope ? dimAll() : (
    scopes.some(s => s.department_id) ? dimRestricted(
      scopes.map(s => s.department_id).filter((id): id is string => !!id)
    ) : dimAll()
  );
  const costCentreScope = hasAllScope ? dimAll() : (
    scopes.some(s => s.cost_centre_id) ? dimRestricted(
      scopes.map(s => s.cost_centre_id).filter((id): id is string => !!id)
    ) : dimAll()
  );

  // 5. Determine capabilities
  const SENSITIVE_ROLES = ['super_admin', 'admin', 'payroll', 'payroll_head', 'hr', 'ceo', 'coo'];
  const EXPORT_SENSITIVE_ROLES = ['super_admin', 'payroll', 'payroll_head', 'ceo'];

  return {
    companyId:              '1', // single-tenant; extend when multi-tenant
    isSuperAdmin,
    branchScope,
    processScope,
    departmentScope,
    costCentreScope,
    managerEmployeeId:      emp ? String(emp.id) : undefined,
    selfEmployeeId:         emp ? String(emp.id) : undefined,
    subordinateEmployeeIds: [], // populated lazily by team-report executors that need it
    canViewAllEmployees:    hasAllScope,
    canViewSensitiveFields: roles.some(r => SENSITIVE_ROLES.includes(r)),
    canExportSensitiveReports: roles.some(r => EXPORT_SENSITIVE_ROLES.includes(r)),
    roles,
  };
}
