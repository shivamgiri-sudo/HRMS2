import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";

export type EnterpriseUser = string | { id: string; email?: string | null } | AuthenticatedRequest["authUser"];

export type BusinessScopeAssignment = {
  roleKey: string;
  scopeType: string;
  branchId: string | null;
  processId: string | null;
  lobId: string | null;
  departmentId: string | null;
  managerEmployeeId: string | null;
  clientId: string | null;
};

export type UserBusinessScope = {
  userId: string;
  roles: string[];
  employeeId: string | null;
  employeeCode: string | null;
  branchId: string | null;
  processId: string | null;
  lobId: string | null;
  departmentId: string | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isHr: boolean;
  isPayroll: boolean;
  isFinance: boolean;
  assignments: BusinessScopeAssignment[];
};

export type ScopeCondition = {
  sql: string;
  params: unknown[];
};

type EmployeeLike = {
  id?: string | null;
  employee_id?: string | null;
  branch_id?: string | null;
  process_id?: string | null;
  lob_id?: string | null;
  department_id?: string | null;
  reporting_manager_id?: string | null;
};

type GrievanceLike = {
  id?: string | null;
  employee_id?: string | null;
  is_anonymous?: boolean | number | null;
  confidentiality_level?: string | null;
  assigned_to?: string | null;
};

function userIdFrom(user: EnterpriseUser): string {
  if (typeof user === "string") return user;
  const id = user?.id;
  if (!id) throw new Error("User id is required to resolve business scope");
  return id;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function roleSet(scope: UserBusinessScope): Set<string> {
  return new Set(scope.roles);
}

function canBypassEmployeeScope(scope: UserBusinessScope): boolean {
  const roles = roleSet(scope);
  return scope.isSuperAdmin || scope.isAdmin || scope.isHr || roles.has("ceo");
}

function canBypassPayrollScope(scope: UserBusinessScope): boolean {
  const roles = roleSet(scope);
  return scope.isSuperAdmin || scope.isAdmin || scope.isHr || scope.isFinance || scope.isPayroll || roles.has("ceo");
}

function addAssignmentPredicates(
  scope: UserBusinessScope,
  alias: Record<string, string | undefined>,
  allowedScopeTypes: Set<string>,
): ScopeCondition {
  const ors: string[] = [];
  const params: unknown[] = [];

  for (const assignment of scope.assignments) {
    if (assignment.scopeType === "all") {
      ors.push("1=1");
      continue;
    }
    if (!allowedScopeTypes.has(assignment.scopeType)) continue;

    const parts: string[] = [];
    if (assignment.branchId && alias.branchId) {
      parts.push(`${alias.branchId} = ?`);
      params.push(assignment.branchId);
    }
    if (assignment.processId && alias.processId) {
      parts.push(`${alias.processId} = ?`);
      params.push(assignment.processId);
    }
    if (assignment.lobId && alias.lobId) {
      parts.push(`${alias.lobId} = ?`);
      params.push(assignment.lobId);
    }
    if (assignment.departmentId && alias.departmentId) {
      parts.push(`${alias.departmentId} = ?`);
      params.push(assignment.departmentId);
    }
    if (assignment.managerEmployeeId && alias.managerEmployeeId) {
      parts.push(`${alias.managerEmployeeId} = ?`);
      params.push(assignment.managerEmployeeId);
    }
    if (assignment.clientId && alias.clientId) {
      parts.push(`${alias.clientId} = ?`);
      params.push(assignment.clientId);
    }
    if (parts.length > 0) ors.push(`(${parts.join(" AND ")})`);
  }

  if (ors.length === 0) return { sql: "1=0", params: [] };
  return { sql: ors.join(" OR "), params };
}

async function getEmployeeRow(employeeId: string): Promise<EmployeeLike | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id, process_id, lob_id, department_id, reporting_manager_id
       FROM employees
      WHERE id = ?
      LIMIT 1`,
    [employeeId],
  );
  return (rows[0] as EmployeeLike | undefined) ?? null;
}

export async function resolveUserBusinessScope(user: EnterpriseUser): Promise<UserBusinessScope> {
  const userId = userIdFrom(user);

  const [[roleRows], [scopeRows], [employeeRows]] = await Promise.all([
    db.execute<RowDataPacket[]>(
      "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
      [userId],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT role_key, scope_type, branch_id, process_id, lob_id, department_id, manager_employee_id, client_id
         FROM user_assignment_scope
        WHERE user_id = ? AND active_status = 1`,
      [userId],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT id, employee_code, branch_id, process_id, lob_id, department_id
         FROM employees
        WHERE user_id = ?
          AND active_status = 1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [userId],
    ),
  ]);

  const roles = unique((roleRows as RowDataPacket[]).map((row: any) => String(row.role_key)));
  const roleKeys = new Set(roles);
  const employee = employeeRows[0] as RowDataPacket | undefined;

  return {
    userId,
    roles,
    employeeId: employee ? String(employee.id) : null,
    employeeCode: employee?.employee_code ? String(employee.employee_code) : null,
    branchId: employee?.branch_id ? String(employee.branch_id) : null,
    processId: employee?.process_id ? String(employee.process_id) : null,
    lobId: employee?.lob_id ? String(employee.lob_id) : null,
    departmentId: employee?.department_id ? String(employee.department_id) : null,
    isSuperAdmin: roleKeys.has("super_admin"),
    isAdmin: roleKeys.has("admin"),
    isHr: roleKeys.has("hr"),
    isPayroll: roleKeys.has("payroll"),
    isFinance: roleKeys.has("finance"),
    assignments: (scopeRows as RowDataPacket[]).map((row: any) => ({
      roleKey: String(row.role_key),
      scopeType: String(row.scope_type),
      branchId: row.branch_id ? String(row.branch_id) : null,
      processId: row.process_id ? String(row.process_id) : null,
      lobId: row.lob_id ? String(row.lob_id) : null,
      departmentId: row.department_id ? String(row.department_id) : null,
      managerEmployeeId: row.manager_employee_id ? String(row.manager_employee_id) : null,
      clientId: row.client_id ? String(row.client_id) : null,
    })),
  };
}

export function buildEmployeeScopeCondition(
  scope: UserBusinessScope,
  alias: { employeeId?: string; branchId?: string; processId?: string; lobId?: string; departmentId?: string; managerEmployeeId?: string },
): ScopeCondition {
  if (canBypassEmployeeScope(scope)) return { sql: "1=1", params: [] };

  const ors: string[] = [];
  const params: unknown[] = [];
  if (scope.employeeId && alias.employeeId) {
    ors.push(`${alias.employeeId} = ?`);
    params.push(scope.employeeId);
  }

  const scoped = addAssignmentPredicates(
    scope,
    alias,
    new Set(["all", "branch", "process", "branch_process", "lob", "department", "team"]),
  );
  if (scoped.sql !== "1=0") {
    ors.push(`(${scoped.sql})`);
    params.push(...scoped.params);
  }

  if (ors.length === 0) return { sql: "1=0", params: [] };
  return { sql: ors.join(" OR "), params };
}

export function buildClientScopeCondition(
  scope: UserBusinessScope,
  alias: { clientId?: string; processId?: string; branchId?: string; lobId?: string },
): ScopeCondition {
  if (scope.isSuperAdmin || scope.isAdmin || scope.isHr || roleSet(scope).has("ceo")) return { sql: "1=1", params: [] };
  return addAssignmentPredicates(scope, alias, new Set(["all", "client", "process", "branch_process", "branch", "lob"]));
}

export function buildProcessScopeCondition(
  scope: UserBusinessScope,
  alias: { processId?: string; branchId?: string; lobId?: string; departmentId?: string },
): ScopeCondition {
  if (scope.isSuperAdmin || scope.isAdmin || scope.isHr || roleSet(scope).has("ceo")) return { sql: "1=1", params: [] };
  return addAssignmentPredicates(scope, alias, new Set(["all", "process", "branch_process", "branch", "lob", "department"]));
}

export async function canViewEmployee(user: EnterpriseUser, employeeId: string): Promise<boolean> {
  const scope = await resolveUserBusinessScope(user);
  if (canBypassEmployeeScope(scope)) return true;
  if (scope.employeeId === employeeId) return true;

  const employee = await getEmployeeRow(employeeId);
  if (!employee) return false;

  return scope.assignments.some((assignment) => {
    if (assignment.scopeType === "all") return true;
    if (assignment.scopeType === "branch") return Boolean(assignment.branchId && assignment.branchId === employee.branch_id);
    if (assignment.scopeType === "process") return Boolean(assignment.processId && assignment.processId === employee.process_id);
    if (assignment.scopeType === "branch_process") return Boolean(
      assignment.branchId && assignment.processId &&
      assignment.branchId === employee.branch_id &&
      assignment.processId === employee.process_id
    );
    if (assignment.scopeType === "lob") return Boolean(assignment.lobId && assignment.lobId === employee.lob_id);
    if (assignment.scopeType === "department") return Boolean(assignment.departmentId && assignment.departmentId === employee.department_id);
    if (assignment.scopeType === "team") return Boolean(assignment.managerEmployeeId && assignment.managerEmployeeId === employee.reporting_manager_id);
    return false;
  });
}

export async function canViewPayroll(user: EnterpriseUser, employeeId: string): Promise<boolean> {
  const scope = await resolveUserBusinessScope(user);
  if (canBypassPayrollScope(scope)) return true;
  return scope.employeeId === employeeId;
}

export async function canViewSensitiveEmployeeData(user: EnterpriseUser, employeeId: string): Promise<boolean> {
  const scope = await resolveUserBusinessScope(user);
  if (scope.isSuperAdmin || scope.isAdmin || scope.isHr) return true;
  return scope.employeeId === employeeId;
}

export async function canManageGrievance(user: EnterpriseUser): Promise<boolean> {
  const scope = await resolveUserBusinessScope(user);
  const roles = roleSet(scope);
  return scope.isSuperAdmin || scope.isAdmin || scope.isHr || roles.has("grievance_officer");
}

export async function canViewGrievance(user: EnterpriseUser, grievance: GrievanceLike): Promise<boolean> {
  const scope = await resolveUserBusinessScope(user);
  const roles = roleSet(scope);
  if (scope.isSuperAdmin || scope.isAdmin || scope.isHr || roles.has("grievance_officer")) return true;
  if (!grievance.employee_id || !scope.employeeId) return false;
  if (String(grievance.employee_id) !== scope.employeeId) return false;
  return !(grievance.is_anonymous === true || grievance.is_anonymous === 1);
}

export async function canViewClientPortal(user: EnterpriseUser, clientId: string, processId?: string | null): Promise<boolean> {
  const scope = await resolveUserBusinessScope(user);
  if (scope.isSuperAdmin || scope.isAdmin || scope.isHr || roleSet(scope).has("ceo")) return true;

  return scope.assignments.some((assignment) => {
    if (assignment.scopeType === "all") return true;
    if (assignment.clientId && assignment.clientId === clientId) return true;
    if (processId && assignment.processId && assignment.processId === processId) return true;
    return false;
  });
}
