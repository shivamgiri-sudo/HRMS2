import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Employee, PaginatedResult } from "./employee.types.js";
import type { CreateEmployeeInput, EmployeeFilters, UpdateEmployeeInput } from "./employee.validation.js";
import { provisionLmsIdentityForEmployee } from "../lms/lms-provisioning.service.js";

const SENSITIVE_FIELDS: Array<{ inputKey: keyof UpdateEmployeeInput; dbCol: string; label: string }> = [
  { inputKey: "branchId",           dbCol: "branch_id",           label: "Branch" },
  { inputKey: "departmentId",       dbCol: "department_id",       label: "Department" },
  { inputKey: "processId",          dbCol: "process_id",          label: "Process" },
  { inputKey: "designationId",      dbCol: "designation_id",      label: "Designation" },
  { inputKey: "reportingManagerId", dbCol: "reporting_manager_id",label: "Reporting Manager" },
  { inputKey: "employmentStatus",   dbCol: "employment_status",   label: "Employment Status" },
  { inputKey: "employmentType",     dbCol: "employment_type",     label: "Employment Type" },
];

const assignSalary = async (employeeId: string, structureId: string, ctcAnnual: number, effectiveFrom: string) => {
  await db.execute(
    "UPDATE employee_salary_assignment SET active_status = 0 WHERE employee_id = ? AND active_status = 1",
    [employeeId]
  );
  const asgId = randomUUID();
  await db.execute(
    "INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from) VALUES (?, ?, ?, ?, ?)",
    [asgId, employeeId, structureId, ctcAnnual, effectiveFrom]
  );
};

/**
 * Auto-create auth_user for employee with valid email.
 * Links employees.user_id to auth_user.id so employee can login via password reset.
 */
const createAuthUserForEmployee = async (employeeId: string, email: string): Promise<string | null> => {
  const normalizedEmail = email.toLowerCase().trim();

  // Check if auth_user already exists for this email
  const [existingAuth] = await db.execute<RowDataPacket[]>(
    'SELECT id, is_blocked FROM auth_user WHERE LOWER(email) = LOWER(?) LIMIT 1',
    [normalizedEmail]
  );

  if (existingAuth.length > 0) {
    const authUser = existingAuth[0];
    if (Number(authUser.is_blocked ?? 0) === 1) {
      return null; // Don't link to blocked accounts
    }
    // Link existing auth_user to this employee
    await db.execute('UPDATE employees SET user_id = ? WHERE id = ?', [authUser.id, employeeId]);
    return String(authUser.id);
  }

  // Create new auth_user with random password (user must reset via "Forgot Password")
  const userId = randomUUID();
  const randomPassword = randomUUID(); // Secure random password
  const passwordHash = await bcrypt.hash(randomPassword, 10);

  await db.execute(
    'INSERT INTO auth_user (id, email, password_hash, must_change_password, is_blocked) VALUES (?, ?, ?, 1, 0)',
    [userId, normalizedEmail, passwordHash]
  );

  // Link employee to auth_user
  await db.execute('UPDATE employees SET user_id = ? WHERE id = ?', [userId, employeeId]);

  // Assign default "employee" role if exists
  try {
    const [roleCheck] = await db.execute<RowDataPacket[]>(
      'SELECT role_key FROM workforce_role_catalog WHERE role_key = ? AND active_status = 1 LIMIT 1',
      ['employee']
    );
    if (roleCheck.length > 0) {
      await db.execute(
        'INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (UUID(), ?, ?, 1) ON DUPLICATE KEY UPDATE active_status = 1',
        [userId, 'employee']
      );
    }
  } catch {
    // Non-fatal - role assignment failure shouldn't block employee creation
  }

  return userId;
};

export const employeeService = {
  async createEmployee(input: CreateEmployeeInput, _userId: string): Promise<Employee> {
    const [dup] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM employees WHERE employee_code = ? LIMIT 1",
      [input.employeeCode]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("Employee code already exists");

    const id = randomUUID();
    // salary_start_date defaults to date_of_joining when not explicitly set
    const salaryStartDate = input.salaryStartDate ?? input.dateOfJoining;
    await db.execute(
      `INSERT INTO employees
         (id, employee_code, first_name, last_name, email, mobile, gender,
          date_of_birth, date_of_joining, salary_start_date, employment_type,
          branch_id, department_id, process_id, designation_id, reporting_manager_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.employeeCode,
        input.firstName,
        input.lastName ?? null,
        input.email ?? null,
        input.mobile ?? null,
        input.gender ?? null,
        input.dateOfBirth ?? null,
        input.dateOfJoining,
        salaryStartDate,
        input.employmentType ?? "Full Time",
        input.branchId ?? null,
        input.departmentId ?? null,
        input.processId ?? null,
        input.designationId ?? null,
        input.reportingManagerId ?? null,
      ]
    );

    // CRITICAL FIX: Auto-create auth_user if employee has valid email
    // This ensures employees can login via "Forgot Password" flow immediately
    if (input.email && input.email.includes('@') && input.email.toLowerCase() !== 'n/a') {
      try {
        await createAuthUserForEmployee(id, input.email);
      } catch (error) {
        // Log but don't block employee creation if auth fails
        console.error(`[WARN] Failed to auto-create auth for employee ${input.employeeCode}:`, error);
      }
    }

    const employee = await this.getEmployee(id);

    // Auto-assign salary when structureId + ctcAnnual provided at creation
    if (input.structureId && input.ctcAnnual) {
      const salaryDate = input.salaryStartDate ?? input.dateOfJoining;
      await assignSalary(id, input.structureId, input.ctcAnnual, salaryDate);
    }

    try {
      const lmsResult = await provisionLmsIdentityForEmployee({ employeeCode: input.employeeCode, createdBy: _userId });
      if (lmsResult.message) {
        console.warn(`[WARN] LMS provisioning for ${input.employeeCode}: ${lmsResult.message}`);
      }
    } catch (error) {
      console.error(`[WARN] Failed to provision LMS identity for employee ${input.employeeCode}:`, error);
    }

    return employee;
  },

  async getEmployee(id: string): Promise<Employee> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT *, COALESCE(NULLIF(TRIM(official_email),''), email) AS email FROM employees WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as Employee[])[0];
    if (!rec) throw new Error("Employee not found");
    return rec;
  },

  async listEmployees(filters: EmployeeFilters & { scopeFilter?: { sql: string; params: unknown[] } }): Promise<PaginatedResult<Employee>> {
    const { page, limit, status, processId, branchId, departmentId, designationId, search, scopeFilter } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = ["e.active_status = 1"];
    const params: unknown[] = [];

    if (status)       { conds.push("e.employment_status = ?"); params.push(status); }
    if (processId)    { conds.push("e.process_id = ?");        params.push(processId); }
    if (branchId)     { conds.push("e.branch_id = ?");         params.push(branchId); }
    if (departmentId) { conds.push("e.department_id = ?");     params.push(departmentId); }
    if (designationId){ conds.push("e.designation_id = ?");    params.push(designationId); }
    if (search)    { conds.push("(e.full_name LIKE ? OR e.employee_code LIKE ? OR e.email LIKE ? OR e.official_email LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }

    // Apply scope filter from middleware
    if (scopeFilter?.sql) {
      const scopeClause = scopeFilter.sql.replace(/^WHERE\s+/i, '').trim();
      if (scopeClause) {
        conds.push(`(${scopeClause})`);
        params.push(...(scopeFilter.params ?? []));
      }
    }

    const where = `WHERE ${conds.join(" AND ")}`;

    // Use string interpolation for LIMIT/OFFSET to avoid parameter binding issues
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id, e.employee_code,
         e.first_name, e.last_name,
         e.mobile, e.avatar_url, e.photo_url,
         e.date_of_joining, e.employment_status, e.employment_type,
         e.designation_id, e.department_id, e.branch_id, e.process_id, e.cost_centre_id,
         e.reporting_manager_id,
         COALESCE(NULLIF(TRIM(e.official_email),''), e.email) AS email,
         desig.designation_name,
         dept.dept_name        AS department_name,
         cc.cost_centre_name,
         pm.process_name,
         bm.branch_name,
         CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name,'')) AS reporting_manager_name
       FROM employees e
       LEFT JOIN designation_master  desig ON desig.id = e.designation_id
       LEFT JOIN department_master   dept  ON dept.id  = e.department_id
       LEFT JOIN cost_centre_master  cc    ON cc.id    = e.cost_centre_id
       LEFT JOIN process_master      pm    ON pm.id    = e.process_id
       LEFT JOIN branch_master       bm    ON bm.id    = e.branch_id
       LEFT JOIN employees           mgr   ON mgr.id   = COALESCE(e.reporting_manager_id, e.manager_id)
       ${where} ORDER BY e.employee_code ASC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM employees e ${where}`, params
    );
    return { data: rows as Employee[], total: (countRows as any)[0]?.total ?? 0, page, limit };
  },

  async updateEmployee(id: string, input: UpdateEmployeeInput, actorUserId: string): Promise<Employee> {
    // Snapshot current sensitive field values before update for audit trail
    const [snapRows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id, department_id, process_id, designation_id,
              reporting_manager_id, employment_status, employment_type
       FROM employees WHERE id = ? LIMIT 1`,
      [id]
    );
    const snap = snapRows[0] ?? {};

    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.firstName         !== undefined) { sets.push("first_name = ?");           params.push(input.firstName); }
    if (input.lastName          !== undefined) { sets.push("last_name = ?");            params.push(input.lastName ?? null); }
    if (input.email             !== undefined) { sets.push("email = ?");                params.push(input.email ?? null); }
    if (input.officialEmail     !== undefined) { sets.push("official_email = ?");       params.push(input.officialEmail ?? null); }
    if (input.mobile            !== undefined) { sets.push("mobile = ?");               params.push(input.mobile ?? null); }
    if (input.gender            !== undefined) { sets.push("gender = ?");               params.push(input.gender); }
    if (input.dateOfBirth       !== undefined) { sets.push("date_of_birth = ?");        params.push(input.dateOfBirth ?? null); }
    if (input.dateOfJoining     !== undefined) { sets.push("date_of_joining = ?");      params.push(input.dateOfJoining); }
    if (input.salaryStartDate   !== undefined) { sets.push("salary_start_date = ?");    params.push(input.salaryStartDate ?? null); }
    if (input.dateOfExit        !== undefined) { sets.push("date_of_exit = ?");         params.push(input.dateOfExit ?? null); }
    if (input.employmentType    !== undefined) { sets.push("employment_type = ?");      params.push(input.employmentType); }
    if (input.employmentStatus  !== undefined) { sets.push("employment_status = ?");    params.push(input.employmentStatus); }
    if (input.branchId          !== undefined) { sets.push("branch_id = ?");            params.push(input.branchId ?? null); }
    if (input.departmentId      !== undefined) { sets.push("department_id = ?");        params.push(input.departmentId ?? null); }
    if (input.processId         !== undefined) { sets.push("process_id = ?");           params.push(input.processId ?? null); }
    if (input.designationId     !== undefined) { sets.push("designation_id = ?");       params.push(input.designationId ?? null); }
    if (input.reportingManagerId !== undefined) { sets.push("reporting_manager_id = ?"); params.push(input.reportingManagerId ?? null); }
    if (input.photoUrl          !== undefined) { sets.push("photo_url = ?");            params.push(input.photoUrl ?? null); }
    if (input.userId            !== undefined) { sets.push("user_id = ?");              params.push(input.userId ?? null); }

    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`, params);

      // Audit any sensitive field changes
      const changedSensitive = SENSITIVE_FIELDS.filter(
        (f) => input[f.inputKey] !== undefined && String(input[f.inputKey] ?? "") !== String(snap[f.dbCol] ?? "")
      );
      if (changedSensitive.length > 0) {
        const oldVals: Record<string, unknown> = {};
        const newVals: Record<string, unknown> = {};
        for (const f of changedSensitive) {
          oldVals[f.label] = snap[f.dbCol] ?? null;
          newVals[f.label] = input[f.inputKey] ?? null;
        }
        void logSensitiveAction({
          actor_user_id: actorUserId,
          action_type: "EMPLOYEE_PROFILE_UPDATED",
          module_key: "employees",
          entity_type: "employee",
          entity_id: id,
          employee_id: id,
          change_summary: { fields: changedSensitive.map((f) => f.label) },
          old_value_json: oldVals,
          new_value_json: newVals,
        });
      }
    }

    // Sync auth_user.email = official_email when official_email updated
    if (input.officialEmail) {
      const newEmail = input.officialEmail.toLowerCase().trim();
      const [empRows] = await db.execute<RowDataPacket[]>(
        'SELECT user_id FROM employees WHERE id = ? LIMIT 1', [id]
      );
      const userId = (empRows as any[])[0]?.user_id;
      if (userId) {
        const [conflict] = await db.execute<RowDataPacket[]>(
          'SELECT id FROM auth_user WHERE LOWER(email) = ? AND id != ? LIMIT 1', [newEmail, userId]
        );
        if (!(conflict as any[]).length) {
          await db.execute('UPDATE auth_user SET email = ? WHERE id = ?', [newEmail, userId]);
        }
      }
    }

    return this.getEmployee(id);
  },

  async deactivateEmployee(id: string, _userId: string): Promise<void> {
    await this.getEmployee(id);
    await db.execute(
      "UPDATE employees SET active_status = 0, employment_status = 'Inactive' WHERE id = ?",
      [id]
    );
  },

  // ── Org Chart tree endpoint ──────────────────────────────────────────────
  async getOrgTree(params: {
    userId: string;
    processId?: string;
    branchId?: string;
    departmentId?: string;
  }): Promise<{ nodes: OrgTreeServiceNode[]; totalCount: number }> {
    const { userId, processId, branchId, departmentId } = params;

    // Resolve requester roles
    const [roleRows] = await db.execute<RowDataPacket[]>(
      "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
      [userId]
    );
    const roles = (roleRows as { role_key: string }[]).map((r) => r.role_key);

    const isSuperAdmin = roles.includes("super_admin");
    const isAdmin      = roles.includes("admin");
    const isCeo        = roles.includes("ceo");
    const isHr         = roles.includes("hr");
    const isBranchHead = roles.includes("branch_head");
    const isProcMgr    = roles.includes("process_manager") || roles.includes("manager");
    const isWfm        = roles.includes("wfm") || roles.includes("operations_manager");

    // Resolve own employee record for scope lookups
    const [selfRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, branch_id, process_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
      [userId]
    );
    const self = (selfRows as { id: string; branch_id: string | null; process_id: string | null }[])[0];

    // Build scope WHERE
    const wheres: string[] = ["e.active_status = 1"];
    const qp: unknown[] = [];

    if (isSuperAdmin || isAdmin || isCeo || isHr) {
      if (processId)    { wheres.push("e.process_id = ?");    qp.push(processId); }
      if (branchId)     { wheres.push("e.branch_id = ?");     qp.push(branchId); }
      if (departmentId) { wheres.push("e.department_id = ?"); qp.push(departmentId); }
    } else if (isBranchHead) {
      const scopeBranch = self?.branch_id;
      if (!scopeBranch) return { nodes: [], totalCount: 0 };
      wheres.push("e.branch_id = ?");
      qp.push(scopeBranch);
    } else if (isProcMgr || isWfm) {
      const scopeProcess = self?.process_id;
      if (!scopeProcess) return { nodes: [], totalCount: 0 };
      wheres.push("e.process_id = ?");
      qp.push(scopeProcess);
    } else {
      // Employee / executive / agent: scope to own process
      const scopeProcess = self?.process_id;
      if (scopeProcess) {
        wheres.push("e.process_id = ?");
        qp.push(scopeProcess);
      } else if (self?.id) {
        wheres.push("e.id = ?");
        qp.push(self.id);
      } else {
        return { nodes: [], totalCount: 0 };
      }
    }

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id,
         e.employee_code,
         TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
         d.designation_name AS designation,
         p.process_name,
         b.branch_name,
         dept.dept_name AS department_name,
         e.process_id,
         e.branch_id AS emp_branch_id,
         COALESCE(NULLIF(TRIM(e.avatar_url), ''), NULLIF(TRIM(e.photo_url), '')) AS avatar_url,
         COALESCE(e.reporting_manager_id, e.manager_id) AS reporting_manager_id,
         (SELECT ur2.role_key FROM user_roles ur2
          WHERE ur2.user_id = e.user_id AND ur2.active_status = 1
          ORDER BY FIELD(ur2.role_key,
            'super_admin','admin','ceo','hr','branch_head',
            'process_manager','manager','team_leader','tl',
            'assistant_manager','employee') LIMIT 1
         ) AS role_key,
         e.active_status
       FROM employees e
       LEFT JOIN designation_master d    ON d.id    = e.designation_id
       LEFT JOIN process_master    p     ON p.id    = e.process_id
       LEFT JOIN branch_master     b     ON b.id    = e.branch_id
       LEFT JOIN department_master dept  ON dept.id = e.department_id
      WHERE ${wheres.join(" AND ")}
      ORDER BY e.date_of_joining ASC`,
      qp
    );

    const employees = empRows as OrgTreeServiceNode[];
    const totalCount = employees.length;

    // Build tree strictly from real reporting_manager_id data — no synthetic inference
    const byId = new Map<string, OrgTreeServiceNode & { children: OrgTreeServiceNode[] }>();
    for (const emp of employees) {
      byId.set(emp.id, { ...emp, children: [] });
    }

    const scopedIds = new Set(employees.map((e) => e.id));
    const roots: (OrgTreeServiceNode & { children: OrgTreeServiceNode[] })[] = [];

    for (const emp of employees) {
      const mgr = emp.reporting_manager_id;
      if (!mgr || !scopedIds.has(mgr)) {
        roots.push(byId.get(emp.id)!);
      } else {
        byId.get(mgr)!.children.push(byId.get(emp.id)!);
      }
    }

    return { nodes: roots, totalCount };
  },
};

// Internal type for org tree — not exported to avoid polluting Employee types
interface OrgTreeServiceNode {
  id: string;
  employee_code: string;
  name: string;
  designation: string | null;
  process_name: string | null;
  branch_name: string | null;
  department_name: string | null;
  avatar_url: string | null;
  reporting_manager_id: string | null;
  role_key: string | null;
  active_status: number;
  children: OrgTreeServiceNode[];
}
