import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { Employee, PaginatedResult } from "./employee.types.js";
import type { CreateEmployeeInput, EmployeeFilters, UpdateEmployeeInput } from "./employee.validation.js";
import { assignRole } from "../access/access.service.js";
import { appendJourneyEvent } from "./journeyLog.service.js";

const assignSalary = async (
  employeeId: string,
  structureId: string,
  ctcAnnual: number,
  effectiveFrom: string,
  actorUserId: string
) => {
  const [currentRows] = await db.execute<RowDataPacket[]>(
    "SELECT ctc_annual FROM employee_salary_assignment WHERE employee_id = ? AND active_status = 1 LIMIT 1",
    [employeeId]
  );
  const previousCtc = currentRows[0]?.ctc_annual ?? null;
  await db.execute(
    "UPDATE employee_salary_assignment SET active_status = 0 WHERE employee_id = ? AND active_status = 1",
    [employeeId]
  );
  const asgId = randomUUID();
  await db.execute(
    "INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from) VALUES (?, ?, ?, ?, ?)",
    [asgId, employeeId, structureId, ctcAnnual, effectiveFrom]
  );
  await db.execute("UPDATE employees SET ctc = ? WHERE id = ?", [ctcAnnual, employeeId]);
  await appendJourneyEvent({
    employeeId,
    eventType: previousCtc == null ? "salary_setup" : "increment",
    eventDate: effectiveFrom,
    description: previousCtc == null ? "Initial annual CTC assigned" : "Annual compensation revised",
    oldValue: previousCtc == null ? undefined : String(previousCtc),
    newValue: String(ctcAnnual),
    module: "PAYROLL",
    triggeredBy: actorUserId,
    metadata: { structure_id: structureId, salary_assignment_id: asgId },
  });
};

async function getEmployeeContext(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.*,
            COALESCE(NULLIF(TRIM(e.official_email), ''), e.email) AS email,
            d.designation_name, dept.dept_name, b.branch_name, p.process_name,
            CONCAT(m.first_name, ' ', COALESCE(m.last_name, '')) AS manager_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
      WHERE e.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export const employeeService = {
  async createEmployee(input: CreateEmployeeInput, userId: string): Promise<Employee> {
    const [dup] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM employees WHERE employee_code = ? LIMIT 1",
      [input.employeeCode]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("Employee code already exists");

    const id = randomUUID();
    const salaryStartDate = input.salaryStartDate ?? input.dateOfJoining;
    await db.execute(
      `INSERT INTO employees
         (id, employee_code, first_name, last_name, email, official_email, mobile, gender,
          date_of_birth, date_of_joining, salary_start_date, employment_type,
          branch_id, department_id, process_id, designation_id, reporting_manager_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.employeeCode,
        input.firstName,
        input.lastName ?? null,
        input.email ?? null,
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

    if (input.structureId && input.ctcAnnual) {
      const salaryDate = input.salaryStartDate ?? input.dateOfJoining;
      await assignSalary(id, input.structureId, input.ctcAnnual, salaryDate, userId);
    }

    await appendJourneyEvent({
      employeeId: id,
      eventType: "joining",
      eventDate: input.dateOfJoining,
      description: `Employee joined as ${employee.designation_id ? "a designated team member" : "an employee"}`,
      module: "ONBOARDING",
      triggeredBy: userId,
      metadata: {
        branch_id: input.branchId,
        department_id: input.departmentId,
        process_id: input.processId,
        designation_id: input.designationId,
        reporting_manager_id: input.reportingManagerId,
      },
    });

    return employee;
  },

  async getEmployee(id: string): Promise<Employee> {
    const rec = await getEmployeeContext(id) as Employee | null;
    if (!rec) throw new Error("Employee not found");
    return rec;
  },

  async listEmployees(filters: EmployeeFilters & { scopeFilter?: { sql: string; params: unknown[] } | string }): Promise<PaginatedResult<Employee>> {
    const { page, limit, status, recordStatus, processId, branchId, departmentId, search, scopeFilter } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];

    if (recordStatus === "active") {
      conds.push("e.active_status = 1 AND LOWER(COALESCE(e.employment_status, 'active')) NOT IN ('inactive', 'terminated', 'offboarded', 'absconded')");
    } else if (recordStatus === "inactive") {
      conds.push("LOWER(COALESCE(e.employment_status, '')) IN ('inactive', 'terminated', 'offboarded', 'absconded')");
    } else {
      conds.push("(e.active_status = 1 OR LOWER(COALESCE(e.employment_status, '')) IN ('inactive', 'terminated', 'offboarded', 'absconded'))");
    }

    if (status)    { conds.push("LOWER(e.employment_status) = LOWER(?)"); params.push(status); }
    if (processId) {
      conds.push(`(
        e.process_id = ?
        OR LOWER(TRIM(p.process_name)) = (
          SELECT LOWER(TRIM(process_name)) FROM process_master WHERE id = ? LIMIT 1
        )
      )`);
      params.push(processId, processId);
    }
    if (branchId)  {
      conds.push(`(
        e.branch_id = ?
        OR LOWER(TRIM(b.branch_name)) = (
          SELECT LOWER(TRIM(branch_name)) FROM branch_master WHERE id = ? LIMIT 1
        )
      )`);
      params.push(branchId, branchId);
    }
    if (departmentId) {
      conds.push(`(
        e.department_id = ?
        OR LOWER(TRIM(dept.dept_name)) = (
          SELECT LOWER(TRIM(dept_name)) FROM department_master WHERE id = ? LIMIT 1
        )
      )`);
      params.push(departmentId, departmentId);
    }
    if (search)    {
      const term = `%${search}%`;
      conds.push(`(
        COALESCE(e.full_name, '') LIKE ?
        OR CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')) LIKE ?
        OR COALESCE(e.first_name, '') LIKE ?
        OR COALESCE(e.last_name, '') LIKE ?
        OR e.employee_code LIKE ?
        OR COALESCE(e.biometric_code, '') LIKE ?
        OR COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email, '') LIKE ?
        OR COALESCE(e.email, '') LIKE ?
        OR COALESCE(e.mobile, '') LIKE ?
        OR COALESCE(e.alternate_mobile, '') LIKE ?
        OR COALESCE(dept.dept_name, '') LIKE ?
        OR COALESCE(desig.designation_name, '') LIKE ?
        OR COALESCE(b.branch_name, '') LIKE ?
        OR COALESCE(p.process_name, '') LIKE ?
        OR COALESCE(cc.cost_centre_name, '') LIKE ?
        OR COALESCE(e.cost_center_code, '') LIKE ?
        OR COALESCE(TRIM(CONCAT(m.first_name, ' ', COALESCE(m.last_name, ''))), '') LIKE ?
        OR CAST(COALESCE(e.legacy_emp_id, e.legacy_id, '') AS CHAR) LIKE ?
        OR COALESCE(eu.uan, '') LIKE ?
      )`);
      params.push(term, term, term, term, term, term, term, term, term, term, term, term, term, term, term, term, term, term, term);
    }

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
    const fromWithJoins = `
       FROM employees e
       LEFT JOIN department_master  dept  ON dept.id  = e.department_id  AND dept.active_status  = 1
       LEFT JOIN designation_master desig ON desig.id = e.designation_id AND desig.active_status = 1
       LEFT JOIN branch_master      b     ON b.id     = e.branch_id      AND b.active_status     = 1
       LEFT JOIN process_master     p     ON p.id     = e.process_id     AND p.active_status     = 1
       LEFT JOIN cost_centre_master cc    ON cc.id    = e.cost_centre_id
       LEFT JOIN employees          m     ON m.id     = COALESCE(e.reporting_manager_id, e.manager_id)
       LEFT JOIN employee_uan       eu    ON eu.employee_id = e.id AND eu.is_active = 1`;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.*,
         COALESCE(NULLIF(TRIM(e.first_name), ''), NULLIF(TRIM(e.full_name), ''), '') AS first_name,
         COALESCE(e.last_name, '') AS last_name,
         e.id AS employee_id,
         COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS email,
         dept.dept_name         AS department_name,
         desig.designation_name AS designation_name,
         b.branch_name,
         p.process_name,
         cc.cost_centre_name,
         TRIM(CONCAT(m.first_name, ' ', COALESCE(m.last_name, ''))) AS reporting_manager_name,
         eu.uan,
         eu.member_id,
         eu.epf_join_date
       ${fromWithJoins}
       ${where}
       ORDER BY e.employee_code ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total ${fromWithJoins} ${where}`, params
    );
    return { data: rows as Employee[], total: (countRows as any)[0]?.total ?? 0, page, limit };
  },

  async updateEmployee(id: string, input: UpdateEmployeeInput, _userId: string): Promise<Employee> {
    const before = await getEmployeeContext(id);
    if (!before) throw new Error("Employee not found");
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.employeeCode      !== undefined) { sets.push("employee_code = ?");        params.push(input.employeeCode); }
    if (input.firstName         !== undefined) { sets.push("first_name = ?");           params.push(input.firstName); }
    if (input.lastName          !== undefined) { sets.push("last_name = ?");            params.push(input.lastName ?? null); }
    if (input.email             !== undefined) {
      sets.push("email = ?", "official_email = ?");
      params.push(input.email ?? null, input.email ?? null);
    }
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
    if (input.designationName   !== undefined) {
      sets.push("designation_id = (SELECT id FROM designation_master WHERE LOWER(TRIM(designation_name)) = LOWER(TRIM(?)) AND active_status = 1 ORDER BY created_at DESC LIMIT 1)");
      params.push(input.designationName ?? "");
    }
    if (input.reportingManagerId !== undefined) { sets.push("reporting_manager_id = ?"); params.push(input.reportingManagerId ?? null); }
    if (input.address1          !== undefined) { sets.push("address1 = ?");              params.push(input.address1 ?? null); }
    if (input.city              !== undefined) { sets.push("city = ?");                  params.push(input.city ?? null); }
    if (input.country           !== undefined) { sets.push("country = ?");               params.push(input.country ?? null); }
    if (input.workingHoursStart !== undefined) { sets.push("working_hours_start = ?");   params.push(input.workingHoursStart ?? null); }
    if (input.workingHoursEnd   !== undefined) { sets.push("working_hours_end = ?");     params.push(input.workingHoursEnd ?? null); }
    if (input.workingDays       !== undefined) { sets.push("working_days = ?");          params.push(input.workingDays == null ? null : JSON.stringify(input.workingDays)); }
    if (input.photoUrl          !== undefined) { sets.push("photo_url = ?");            params.push(input.photoUrl ?? null); }
    if (input.userId            !== undefined) { sets.push("user_id = ?");              params.push(input.userId ?? null); }
    if ((input as any).ctc      !== undefined) { sets.push("ctc = ?");                 params.push((input as any).ctc ?? null); }

    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`, params);
    }

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
        console.error("[employee.service] designation role auto-assign failed:", err);
      }
    }

    const updated = await this.getEmployee(id);
    const after = await getEmployeeContext(id);

    if (after) {
      const changes = [
        ["designation_id", "designation_change", before.designation_name, after.designation_name],
        ["department_id", "department_change", before.dept_name, after.dept_name],
        ["branch_id", "branch_change", before.branch_name, after.branch_name],
        ["process_id", "process_change", before.process_name, after.process_name],
        ["reporting_manager_id", "reporting_change", before.manager_name, after.manager_name],
        ["employment_status", "status_change", before.employment_status, after.employment_status],
        ["employment_type", "employment_type_change", before.employment_type, after.employment_type],
        ["date_of_exit", "exit_date_change", before.date_of_exit, after.date_of_exit],
      ] as const;

      for (const [field, eventType, oldValue, newValue] of changes) {
        if (String(before[field] ?? "") === String(after[field] ?? "")) continue;
        await appendJourneyEvent({
          employeeId: id,
          eventType,
          eventDate: new Date().toISOString().slice(0, 10),
          description: `${field.replace(/_/g, " ")} updated`,
          oldValue: oldValue == null ? undefined : String(oldValue),
          newValue: newValue == null ? undefined : String(newValue),
          module: "EMPLOYEE",
          triggeredBy: _userId,
          metadata: { field },
        });
      }

      if ((input as any).ctc !== undefined && Number(before.ctc ?? 0) !== Number(after.ctc ?? 0)) {
        await appendJourneyEvent({
          employeeId: id,
          eventType: before.ctc == null ? "salary_setup" : "increment",
          eventDate: new Date().toISOString().slice(0, 10),
          description: before.ctc == null ? "Initial annual CTC assigned" : "Annual compensation revised",
          oldValue: before.ctc == null ? undefined : String(before.ctc),
          newValue: after.ctc == null ? undefined : String(after.ctc),
          module: "PAYROLL",
          triggeredBy: _userId,
          metadata: { field: "ctc" },
        });
      }
    }

    return updated;
  },

  async deactivateEmployee(id: string, _userId: string): Promise<void> {
    await this.getEmployee(id);
    await db.execute(
      "UPDATE employees SET active_status = 0, employment_status = 'Inactive' WHERE id = ?",
      [id]
    );
    await appendJourneyEvent({
      employeeId: id,
      eventType: "status_change",
      eventDate: new Date().toISOString().slice(0, 10),
      description: "Employee profile deactivated",
      oldValue: "Active",
      newValue: "Inactive",
      module: "EMPLOYEE",
      triggeredBy: _userId,
    });
  },
};