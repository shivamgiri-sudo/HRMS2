import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { Employee, PaginatedResult } from "./employee.types.js";
import type { CreateEmployeeInput, EmployeeFilters, UpdateEmployeeInput } from "./employee.validation.js";
import { assignRole } from "../access/access.service.js";

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

  async listEmployees(filters: EmployeeFilters & { scopeFilter?: { sql: string; params: unknown[] } | string }): Promise<PaginatedResult<Employee>> {
    const { page, limit, status, processId, branchId, search, scopeFilter } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = ["e.active_status = 1"];
    const params: unknown[] = [];

    if (status)    { conds.push("e.employment_status = ?"); params.push(status); }
    if (processId) { conds.push("e.process_id = ?");        params.push(processId); }
    if (branchId)  { conds.push("e.branch_id = ?");         params.push(branchId); }
    if (search)    {
      conds.push("(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) LIKE ? OR e.employee_code LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    // Apply scope filter from middleware (object {sql, params} or legacy string)
    if (scopeFilter) {
      if (typeof scopeFilter === 'object' && scopeFilter.sql) {
        const scopeClause = String(scopeFilter.sql).replace(/^WHERE\s+/i, '').trim();
        if (scopeClause) {
          conds.push(`(${scopeClause})`);
          params.push(...(scopeFilter.params || []));
        }
      } else if (typeof scopeFilter === 'string') {
        const scopeClause = scopeFilter.replace(/^WHERE\s+/i, '').trim();
        if (scopeClause) conds.push(`(${scopeClause})`);
      }
    }

    const where = `WHERE ${conds.join(" AND ")}`;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.*,
         dept.dept_name         AS department_name,
         desig.designation_name AS designation_name,
         b.branch_name,
         p.process_name
       FROM employees e
       LEFT JOIN department_master  dept  ON dept.id  = e.department_id
       LEFT JOIN designation_master desig ON desig.id = e.designation_id
       LEFT JOIN branch_master      b     ON b.id     = e.branch_id
       LEFT JOIN process_master     p     ON p.id     = e.process_id
       ${where}
       ORDER BY e.employee_code ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM employees e ${where}`, params
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

    // Auto-assign roles mapped to the new designation (additive only, never removes)
    if (input.designationId) {
      try {
        const updated = await this.getEmployee(id);
        if (updated.user_id) {
          const [mapRows] = await db.execute<RowDataPacket[]>(
            `SELECT role_key FROM designation_role_map
             WHERE designation_id = ? AND active_status = 1`,
            [input.designationId]
          );
          for (const { role_key } of mapRows as any[]) {
            await assignRole(updated.user_id, role_key as string, _userId, undefined);
          }
        }
      } catch (err) {
        // Non-fatal — log but don't fail the update
        console.error("[employee.service] designation role auto-assign failed:", err);
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
};
