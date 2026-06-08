import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { Employee, PaginatedResult } from "./employee.types.js";
import type { CreateEmployeeInput, EmployeeFilters, UpdateEmployeeInput } from "./employee.validation.js";

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

    return employee;
  },

  async getEmployee(id: string): Promise<Employee> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employees WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as Employee[])[0];
    if (!rec) throw new Error("Employee not found");
    return rec;
  },

  async listEmployees(filters: EmployeeFilters & { scopeFilter?: string }): Promise<PaginatedResult<Employee>> {
    const { page, limit, status, processId, branchId, search, scopeFilter } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = ["active_status = 1"];
    const params: unknown[] = [];

    if (status)    { conds.push("employment_status = ?"); params.push(status); }
    if (processId) { conds.push("process_id = ?");        params.push(processId); }
    if (branchId)  { conds.push("branch_id = ?");         params.push(branchId); }
    if (search)    { conds.push("(full_name LIKE ? OR employee_code LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

    // Apply scope filter from middleware
    if (scopeFilter) {
      const scopeClause = String(scopeFilter).replace(/^WHERE\s+/i, '').trim();
      if (scopeClause) conds.push(`(${scopeClause})`);
    }

    const where = `WHERE ${conds.join(" AND ")}`;

    // Use string interpolation for LIMIT/OFFSET to avoid parameter binding issues
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM employees ${where} ORDER BY employee_code ASC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM employees ${where}`, params
    );
    return { data: rows as Employee[], total: (countRows as any)[0]?.total ?? 0, page, limit };
  },

  async updateEmployee(id: string, input: UpdateEmployeeInput, _userId: string): Promise<Employee> {
    await this.getEmployee(id);
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.firstName         !== undefined) { sets.push("first_name = ?");           params.push(input.firstName); }
    if (input.lastName          !== undefined) { sets.push("last_name = ?");            params.push(input.lastName ?? null); }
    if (input.email             !== undefined) { sets.push("email = ?");                params.push(input.email ?? null); }
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
};
