import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEffectiveConfig } from "../customization/customization-engine.js";
import { appendJourneyEvent } from "../employees/journeyLog.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type {
  BulkAssignInput,
  BulkAssignResult,
  EmployeeSalaryAssignment,
  NetSalaryParams,
  NetSalaryResult,
  PaginatedResult,
  SalaryAdvance,
  SalaryComponent,
  SalaryPrepLine,
  SalaryPrepRun,
  SalaryStructure,
} from "./payroll.types.js";
import type {
  AdvanceInput,
  AssignSalaryInput,
  CreateComponentInput,
  CreateRunInput,
  CreateStructureInput,
  RunFilters,
  UpdatePrepLineInput,
  UpdateRunStatusInput,
} from "./payroll.validation.js";

const LOCKED_STATUSES = new Set(["locked", "disbursed"]);

export const payrollService = {
  // ─── Structures ────────────────────────────────────────────────────────────

  async listStructures(): Promise<SalaryStructure[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_structure_master ORDER BY structure_name ASC"
    );
    return rows as SalaryStructure[];
  },

  async getStructure(id: string): Promise<SalaryStructure> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_structure_master WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as SalaryStructure[])[0];
    if (!rec) throw new Error("Structure not found");
    return rec;
  },

  async createStructure(input: CreateStructureInput, _userId: string): Promise<SalaryStructure> {
    const [dup] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM salary_structure_master WHERE structure_code = ? LIMIT 1",
      [input.structureCode]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("Structure code already exists");

    const id = randomUUID();
    const basicPct = input.basicPct ?? 40;
    const hraPct = input.hraPct ?? 20;
    await db.execute(
      "INSERT INTO salary_structure_master (id, structure_code, structure_name, description, basic_pct, hra_pct) VALUES (?, ?, ?, ?, ?, ?)",
      [id, input.structureCode, input.structureName, input.description ?? null, basicPct, hraPct]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_structure_master WHERE id = ? LIMIT 1", [id]
    );
    return (rows as SalaryStructure[])[0];
  },

  async bulkAssignSalary(input: BulkAssignInput, _userId: string): Promise<BulkAssignResult> {
    await this.getStructure(input.structureId);

    const conds = ["e.active_status = 1", "e.LOWER(employment_status) = 'active'"];
    const params: unknown[] = [];
    if (input.processId) { conds.push("e.process_id = ?"); params.push(input.processId); }
    if (input.branchId)  { conds.push("e.branch_id = ?");  params.push(input.branchId); }

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id FROM employees e WHERE ${conds.join(" AND ")}`,
      params
    );
    const employees = empRows as { id: string }[];
    if (employees.length === 0) return { assigned: 0, skipped: 0 };

    const ids = employees.map(e => e.id);
    const placeholders = ids.map(() => "?").join(", ");
    await db.execute(
      `UPDATE employee_salary_assignment SET active_status = 0 WHERE employee_id IN (${placeholders}) AND active_status = 1`,
      ids
    );

    // Bulk INSERT — one round-trip regardless of employee count
    const insertRows = employees.map(emp => [randomUUID(), emp.id, input.structureId, input.ctcAnnual, input.effectiveFrom]);
    const insertPh = insertRows.map(() => "(?, ?, ?, ?, ?)").join(", ");
    await db.execute(
      `INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from) VALUES ${insertPh}`,
      insertRows.flat()
    );

    return { assigned: employees.length, skipped: 0 };
  },

  // ─── Components ────────────────────────────────────────────────────────────

  async listComponents(employeeId?: string): Promise<SalaryComponent[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_component_master WHERE active_status = 1 ORDER BY component_name ASC"
    );
    let components = rows as SalaryComponent[];

    // Apply customizations if employeeId provided
    if (employeeId) {
      try {
        const result = await getEffectiveConfig(employeeId, 'salary_component', null, { components });
        if (result.config.additional_components) {
          components = [...components, ...result.config.additional_components];
        } else if (result.config.components) {
          components = result.config.components;
        }
      } catch (err) {
        console.warn('Customization error for salary components:', err);
      }
    }

    return components;
  },

  async createComponent(input: CreateComponentInput, _userId: string): Promise<SalaryComponent> {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO salary_component_master (id, component_code, component_name, component_type, taxable) VALUES (?, ?, ?, ?, ?)",
      [id, input.componentCode, input.componentName, input.componentType, input.taxable ? 1 : 0]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_component_master WHERE id = ? LIMIT 1", [id]
    );
    return (rows as SalaryComponent[])[0];
  },

  // ─── Salary Assignment ─────────────────────────────────────────────────────

  async assignSalary(input: AssignSalaryInput, userId: string): Promise<EmployeeSalaryAssignment> {
    await this.getStructure(input.structureId);
    const [previousRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, ctc_annual
         FROM employee_salary_assignment
        WHERE employee_id = ? AND active_status = 1
        ORDER BY effective_from DESC LIMIT 1`,
      [input.employeeId]
    );
    const previous = previousRows[0] as any;
    const connection = await db.getConnection();
    const id = randomUUID();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE employee_salary_assignment
            SET active_status = 0,
                effective_to = COALESCE(effective_to, DATE_SUB(?, INTERVAL 1 DAY))
          WHERE employee_id = ? AND active_status = 1`,
        [input.effectiveFrom, input.employeeId]
      );
      await connection.execute(
        `INSERT INTO employee_salary_assignment
           (id, employee_id, structure_id, ctc_annual, effective_from, effective_to)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.employeeId, input.structureId, input.ctcAnnual, input.effectiveFrom, input.effectiveTo ?? null]
      );
      await connection.execute(
        "UPDATE employees SET ctc = ?, updated_at = NOW() WHERE id = ?",
        [input.ctcAnnual, input.employeeId]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await appendJourneyEvent({
      employeeId: input.employeeId,
      eventType: previous ? "increment" : "salary_setup",
      eventDate: input.effectiveFrom,
      description: previous ? "Annual compensation revised" : "Initial annual compensation assigned",
      oldValue: previous ? String(previous.ctc_annual) : undefined,
      newValue: String(input.ctcAnnual),
      module: "PAYROLL",
      triggeredBy: userId,
      metadata: { salary_assignment_id: id, structure_id: input.structureId },
    });
    await logSensitiveAction({
      actor_user_id: userId,
      action_type: previous ? "SALARY_REVISED" : "SALARY_ASSIGNED",
      module_key: "PAYROLL",
      entity_type: "employee_salary_assignment",
      entity_id: id,
      change_summary: {
        employee_id: input.employeeId,
        previous_ctc: previous?.ctc_annual ?? null,
        revised_ctc: input.ctcAnnual,
        effective_from: input.effectiveFrom,
      },
    });

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_salary_assignment WHERE id = ? LIMIT 1", [id]
    );
    return (rows as EmployeeSalaryAssignment[])[0];
  },

  async getEmployeeSalary(employeeId: string): Promise<EmployeeSalaryAssignment | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT esa.*, ssm.structure_code, ssm.structure_name, ssm.basic_pct, ssm.hra_pct
         FROM employee_salary_assignment esa
         JOIN salary_structure_master ssm ON ssm.id = esa.structure_id
        WHERE esa.employee_id = ? AND esa.active_status = 1
        ORDER BY esa.effective_from DESC LIMIT 1`,
      [employeeId]
    );
    return (rows as EmployeeSalaryAssignment[])[0] ?? null;
  },

  async getEmployeeSalaryHistory(employeeId: string): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT esa.*, ssm.structure_code, ssm.structure_name,
              ROUND((esa.ctc_annual / 12) * ssm.basic_pct / 100, 2) AS basic_salary,
              ROUND((esa.ctc_annual / 12) * ssm.hra_pct / 100, 2) AS hra,
              0 AS transport_allowance,
              0 AS medical_allowance,
              ROUND(
                (esa.ctc_annual / 12)
                - ((esa.ctc_annual / 12) * ssm.basic_pct / 100)
                - ((esa.ctc_annual / 12) * ssm.hra_pct / 100),
                2
              ) AS other_allowances,
              0 AS tax_deduction,
              0 AS other_deductions
         FROM employee_salary_assignment esa
         JOIN salary_structure_master ssm ON ssm.id = esa.structure_id
        WHERE esa.employee_id = ?
        ORDER BY esa.effective_from DESC, esa.created_at DESC`,
      [employeeId]
    );
    return rows;
  },

  // ─── Prep Runs ─────────────────────────────────────────────────────────────

  async createRun(input: CreateRunInput, userId: string): Promise<SalaryPrepRun> {
    const [dup] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_prep_run
        WHERE run_month = ?
          AND (branch_filter <=> ?)
          AND (process_filter <=> ?)
        LIMIT 1`,
      [input.runMonth, input.branchFilter ?? null, input.processFilter ?? null]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("Payroll run already exists for this month");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO salary_prep_run (id, run_month, branch_filter, process_filter, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [id, input.runMonth, input.branchFilter ?? null, input.processFilter ?? null, userId]
    );
    return this.getRun(id);
  },

  async getRun(id: string): Promise<SalaryPrepRun> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as SalaryPrepRun[])[0];
    if (!rec) throw new Error("Payroll run not found");
    return rec;
  },

  async updateRunStatus(id: string, input: UpdateRunStatusInput, userId: string): Promise<SalaryPrepRun> {
    const run = await this.getRun(id);
    if (run.status === "disbursed") {
      throw new Error("Run is disbursed — cannot change status");
    }
    if (run.status === "locked" && input.status !== "disbursed") {
      throw new Error("locked run can only move to disbursed");
    }

    const sets = ["status = ?"];
    const params: unknown[] = [input.status];
    if (input.status === "approved")  { sets.push("approved_by = ?");  params.push(userId); }
    if (input.status === "disbursed") { sets.push("disbursed_by = ?", "disbursed_at = NOW()"); params.push(userId); }
    params.push(id);
    await db.execute(`UPDATE salary_prep_run SET ${sets.join(", ")} WHERE id = ?`, params);
    return this.getRun(id);
  },

  async listRuns(filters: RunFilters & { scopeFilter?: { sql: string; params: unknown[] } | string }): Promise<PaginatedResult<SalaryPrepRun>> {
    const { page, limit, runMonth, status, branchId, processId, scopeFilter } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (runMonth)   { conds.push("run_month = ?");    params.push(runMonth); }
    if (status)     { conds.push("status = ?");       params.push(status); }
    if (branchId)   { conds.push("branch_id = ?");    params.push(branchId); }
    if (processId)  { conds.push("process_id = ?");   params.push(processId); }

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

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT spr.*,
              COALESCE(line_totals.total_employees, spr.total_employees, 0) AS total_employees,
              COALESCE(line_totals.total_gross, spr.total_gross, 0) AS total_gross,
              COALESCE(line_totals.total_deductions, spr.total_deductions, 0) AS total_deductions,
              COALESCE(line_totals.total_net, spr.total_net, 0) AS total_net
         FROM salary_prep_run spr
         LEFT JOIN (
           SELECT run_id,
                  COUNT(DISTINCT employee_id) AS total_employees,
                  COALESCE(SUM(gross_salary), 0) AS total_gross,
                  COALESCE(SUM(total_deductions), 0) AS total_deductions,
                  COALESCE(SUM(net_salary), 0) AS total_net
             FROM salary_prep_line
            GROUP BY run_id
         ) line_totals ON line_totals.run_id = spr.id
         ${where}
        ORDER BY spr.run_month DESC, spr.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM salary_prep_run spr ${where}`, params
    );
    return { data: rows as SalaryPrepRun[], total: (countRows as any)[0]?.total ?? 0, page, limit };
  },

  async listPayrollRecords(filters: RunFilters & { scopeFilter?: { sql: string; params: unknown[] } | string }): Promise<PaginatedResult<RowDataPacket>> {
    const { page, limit, runMonth, status, search, departmentId, scopeFilter } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];

    if (runMonth) { conds.push("spr.run_month = ?"); params.push(runMonth); }
    if (status)   { conds.push("spr.status = ?");    params.push(status); }
    if (search) {
      const s = `%${search.trim()}%`;
      conds.push("(COALESCE(spl.employee_code, e.employee_code) LIKE ? OR CONCAT_WS(' ', e.first_name, e.last_name) LIKE ?)");
      params.push(s, s);
    }
    if (departmentId) {
      conds.push("e.department_id = ?");
      params.push(departmentId);
    }

    if (scopeFilter) {
      if (typeof scopeFilter === "object" && scopeFilter.sql) {
        const scopeClause = String(scopeFilter.sql).replace(/^WHERE\s+/i, "").trim();
        if (scopeClause) {
          conds.push(`(${scopeClause})`);
          params.push(...(scopeFilter.params || []));
        }
      } else if (typeof scopeFilter === "string") {
        const scopeClause = scopeFilter.replace(/^WHERE\s+/i, "").trim();
        if (scopeClause) conds.push(`(${scopeClause})`);
      }
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const baseQuery = `
      FROM (
        SELECT spl.id,
               spl.run_id,
               spl.employee_id,
               COALESCE(spl.employee_code, e.employee_code) AS employee_code,
               COALESCE(CONCAT(NULLIF(TRIM(e.first_name), ''), ' ', NULLIF(TRIM(COALESCE(e.last_name, '')), '')), spl.employee_code) AS employee_name,
               e.email AS employee_email,
               e.avatar_url AS employee_avatar,
               spr.run_month,
               spr.status AS run_status,
               spr.disbursed_at,
               spl.status AS line_status,
               COALESCE(spl.basic, 0) AS basic,
               COALESCE(spl.hra, 0) AS hra,
               COALESCE(spl.special_allowance, 0) AS special_allowance,
               0 AS incentive_total,
               COALESCE(spl.total_deductions, 0) AS total_deductions,
               COALESCE(spl.net_salary, 0) AS net_salary,
               COALESCE(spl.gross_salary, 0) AS gross_salary,
               COALESCE(spl.working_days, 0) AS working_days,
               COALESCE(spl.present_days, 0) AS present_days,
               COALESCE(spl.lwp_days, 0) AS lwp_days,
               COALESCE(bm.branch_name, '-') AS branch_name,
               COALESCE(pm.process_name, '-') AS process_name,
               COALESCE(dm.dept_name, '-') AS department_name,
               COALESCE(cc.cost_centre_name, '-') AS cost_centre_name,
               ROW_NUMBER() OVER (
                 PARTITION BY spr.run_month, spl.employee_id
                 ORDER BY spr.created_at DESC, spl.id DESC
               ) AS rn
          FROM salary_prep_line spl
          JOIN salary_prep_run spr ON spr.id = spl.run_id
          LEFT JOIN employees e ON e.id = spl.employee_id
          LEFT JOIN branch_master bm ON bm.id = e.branch_id
          LEFT JOIN process_master pm ON pm.id = e.process_id
          LEFT JOIN department_master dm ON dm.id = e.department_id
          LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
          ${where}
      ) ranked
      WHERE ranked.rn = 1`;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * ${baseQuery}
        ORDER BY run_month DESC, employee_code ASC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total ${baseQuery}`,
      params
    );
    return { data: rows, total: Number((countRows as any)[0]?.total ?? 0), page, limit };
  },

  async getPayrollOverview(runMonth: string): Promise<Record<string, number>> {
    const [activeRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS active_employees,
         SUM(CASE WHEN esa.employee_id IS NOT NULL THEN 1 ELSE 0 END) AS salary_assigned_employees
       FROM employees e
       LEFT JOIN (
         SELECT DISTINCT employee_id
           FROM employee_salary_assignment
          WHERE active_status = 1
       ) esa ON esa.employee_id = e.id
       WHERE e.active_status = 1
         AND LOWER(e.employment_status) = 'active'
         AND (e.date_of_exit IS NULL OR e.date_of_exit >= CURDATE())`
    );

    const [payrollRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS payroll_employees,
         COALESCE(SUM(basic), 0) AS total_basic,
         COALESCE(SUM(hra + special_allowance), 0) AS total_allowances,
         COALESCE(SUM(total_deductions), 0) AS total_deductions,
         COALESCE(SUM(net_salary), 0) AS total_net,
         SUM(CASE WHEN normalized_status = 'pending' THEN 1 ELSE 0 END) AS pending_records,
         SUM(CASE WHEN normalized_status = 'processing' THEN 1 ELSE 0 END) AS processing_records,
         SUM(CASE WHEN normalized_status = 'paid' THEN 1 ELSE 0 END) AS paid_records
       FROM (
         SELECT COALESCE(spl.basic, 0) AS basic,
                COALESCE(spl.hra, 0) AS hra,
                COALESCE(spl.special_allowance, 0) AS special_allowance,
                COALESCE(spl.total_deductions, 0) AS total_deductions,
                COALESCE(spl.net_salary, 0) AS net_salary,
                CASE
                  WHEN LOWER(spr.status) IN ('disbursed', 'finalized', 'finalised') THEN 'paid'
                  WHEN LOWER(spr.status) IN ('processing', 'reviewed', 'approved', 'locked') OR LOWER(spl.status) = 'calculated' THEN 'processing'
                  ELSE 'pending'
                END AS normalized_status,
                ROW_NUMBER() OVER (
                  PARTITION BY spr.run_month, spl.employee_id
                  ORDER BY spr.created_at DESC, spl.id DESC
                ) AS rn
           FROM salary_prep_line spl
           JOIN salary_prep_run spr ON spr.id = spl.run_id
          WHERE spr.run_month = ?
       ) latest
       WHERE rn = 1`,
      [runMonth]
    );

    const active = activeRows[0] as any;
    const payroll = payrollRows[0] as any;
    const activeEmployees = Number(active?.active_employees ?? 0);
    const payrollEmployees = Number(payroll?.payroll_employees ?? 0);

    return {
      activeEmployees,
      salaryAssignedEmployees: Number(active?.salary_assigned_employees ?? 0),
      payrollEmployees,
      missingPayrollEmployees: Math.max(0, activeEmployees - payrollEmployees),
      totalBasic: Number(payroll?.total_basic ?? 0),
      totalAllowances: Number(payroll?.total_allowances ?? 0),
      totalDeductions: Number(payroll?.total_deductions ?? 0),
      totalNet: Number(payroll?.total_net ?? 0),
      pendingRecords: Number(payroll?.pending_records ?? 0),
      processingRecords: Number(payroll?.processing_records ?? 0),
      paidRecords: Number(payroll?.paid_records ?? 0),
    };
  },

  // ─── Prep Lines ────────────────────────────────────────────────────────────

  async listLines(runId: string): Promise<SalaryPrepLine[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT spl.*,
         CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
         spl.gross_salary  AS gross_pay,
         spl.net_salary    AS net_pay,
         spl.professional_tax AS pt_amount,
         spl.tds           AS tds_amount,
         sp.id             AS payslip_id,
         sp.acknowledged_at,
         CASE WHEN sp.acknowledged_at IS NOT NULL THEN 'acknowledged'
              WHEN sp.id IS NOT NULL THEN 'generated'
              ELSE NULL END AS payslip_status
       FROM salary_prep_line spl
       LEFT JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN salary_payslip sp
         ON CONVERT(sp.prep_line_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(spl.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       WHERE spl.run_id = ?
       ORDER BY spl.employee_code ASC`,
      [runId]
    );
    return rows as SalaryPrepLine[];
  },

  async getLine(id: string): Promise<SalaryPrepLine> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_prep_line WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as SalaryPrepLine[])[0];
    if (!rec) throw new Error("Prep line not found");
    return rec;
  },

  async updateLine(id: string, input: UpdatePrepLineInput, _userId: string): Promise<SalaryPrepLine> {
    await this.getLine(id);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.presentDays  !== undefined) { sets.push("present_days = ?");  params.push(input.presentDays); }
    if (input.lwpDays      !== undefined) { sets.push("lwp_days = ?");      params.push(input.lwpDays); }
    if (input.lateMark     !== undefined) { sets.push("late_marks = ?");    params.push(input.lateMark); }
    if (input.dialerHours  !== undefined) { sets.push("dialer_hours = ?");  params.push(input.dialerHours); }
    if (input.remarks      !== undefined) { sets.push("remarks = ?");       params.push(input.remarks ?? null); }
    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE salary_prep_line SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    return this.getLine(id);
  },

  // ─── Advances ──────────────────────────────────────────────────────────────

  async createAdvance(input: AdvanceInput, _userId: string): Promise<SalaryAdvance> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO salary_advance_log (id, employee_id, advance_date, amount, recovery_months, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.employeeId, input.advanceDate, input.amount, input.recoveryMonths, input.notes ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_advance_log WHERE id = ? LIMIT 1", [id]
    );
    return (rows as SalaryAdvance[])[0];
  },

  async listAdvances(employeeId: string): Promise<SalaryAdvance[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_advance_log WHERE employee_id = ? ORDER BY advance_date DESC",
      [employeeId]
    );
    return rows as SalaryAdvance[];
  },

  // ─── Overtime Management ───────────────────────────────────────────────────

  async updateOvertime(
    lineId: string,
    input: { overtimeHours: number; overtimeAmount: number },
    userId: string
  ): Promise<SalaryPrepLine> {
    // Get the prep line with run status
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT spl.*, spr.status AS run_status, e.branch_id, e.employee_code
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spl.run_id = spr.id
       JOIN employees e ON spl.employee_id = e.id
       WHERE spl.id = ? LIMIT 1`,
      [lineId]
    );

    const line = rows[0] as any;
    if (!line) throw new Error("Salary prep line not found");

    // Check if run is editable
    if (line.run_status === "locked" || line.run_status === "disbursed") {
      throw new Error(`Cannot update overtime: run is ${line.run_status}`);
    }

    // Update overtime fields
    await db.execute(
      `UPDATE salary_prep_line
       SET overtime_hours = ?,
           overtime_amount = ?,
           net_salary = net_salary - COALESCE(overtime_amount, 0) + ?,
           gross_salary = gross_salary - COALESCE(overtime_amount, 0) + ?
       WHERE id = ?`,
      [input.overtimeHours, input.overtimeAmount, input.overtimeAmount, input.overtimeAmount, lineId]
    );

    // Log the action
    await logSensitiveAction({
      actor_user_id: userId,
      action_type: "payroll.overtime.update",
      module_key: "payroll",
      entity_type: "salary_prep_line",
      entity_id: lineId,
      change_summary: {
        employeeCode: line.employee_code,
        branchId: line.branch_id,
        overtimeHours: input.overtimeHours,
        overtimeAmount: input.overtimeAmount,
      },
    });

    // Append to journey log
    await appendJourneyEvent({
      employeeId: line.employee_id,
      eventType: "overtime_updated",
      eventDate: new Date().toISOString(),
      description: `Overtime updated: ${input.overtimeHours}h = ₹${input.overtimeAmount}`,
      module: "payroll",
      triggeredBy: userId,
      metadata: {
        lineId,
        overtimeHours: input.overtimeHours,
        overtimeAmount: input.overtimeAmount,
      },
    });

    // Return updated line
    const [updated] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_prep_line WHERE id = ? LIMIT 1",
      [lineId]
    );
    return (updated as SalaryPrepLine[])[0];
  },

  // ─── Statutory Config ──────────────────────────────────────────────────────

  async getStatutoryConfig(): Promise<Record<string, number>> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT config_key, config_value FROM statutory_config"
    );
    const map: Record<string, number> = {};
    for (const row of rows as { config_key: string; config_value: number }[]) {
      map[row.config_key] = row.config_value;
    }
    return map;
  },

  // ─── Salary Calculator (pure, no DB) ───────────────────────────────────────

  calculateNetSalary(p: NetSalaryParams): NetSalaryResult {
    const r2 = (n: number) => Math.round(n * 100) / 100;

    // LWP ratio: earn (workingDays - lwpDays) / workingDays of each CTC component
    const attendanceRatio = (p.workingDays - p.lwpDays) / p.workingDays;

    // Fixed CTC components (scaled by attendance)
    const basic = r2(p.grossMonthlyCTC * (p.basicPct / 100) * attendanceRatio);
    const hra = r2(p.grossMonthlyCTC * (p.hraPct / 100) * attendanceRatio);
    const special = r2(p.grossMonthlyCTC * attendanceRatio - basic - hra);

    // Variable allowances (night shift, incentives, etc.) — paid as-is, not scaled by LWP
    const allowances = p.allowances ?? [];
    const allowancesTotal = r2(allowances.reduce((s, a) => s + a.amount, 0));

    const gross = r2(basic + hra + special + allowancesTotal);

    // PF: on Basic only, capped at pfWageLimit (statutory ceiling ₹15,000)
    // Variable allowances intentionally excluded from PF base
    const pfBase = Math.min(basic, p.pfWageLimit);
    const pfEmp = r2(pfBase * (p.pfEmployeePct / 100));

    // Employer PF: EPF 3.67% + EPS 8.33% of min(Basic, ₹15,000 EPS ceiling)
    const epsCeiling = 15000;
    const epsBase = Math.min(basic, epsCeiling);
    const pfEmrEpf = r2(pfBase * 0.0367);
    const pfEmrEps = r2(epsBase * 0.0833);
    const pfEmr = r2(pfEmrEpf + pfEmrEps);

    // ESIC: on full gross (including allowances), skip when gross > esicWageLimit
    const esicEmp = gross <= p.esicWageLimit
      ? r2(gross * (p.esicEmployeePct / 100))
      : 0;
    const esicEmr = gross <= p.esicWageLimit
      ? r2(gross * 0.0325)
      : 0;

    // Gratuity: 4.81% of Basic — employer cost, not employee deduction
    const gratuity = r2(basic * 0.0481);

    const totalDed = r2(pfEmp + esicEmp + p.professionalTax + p.tds);
    const net = r2(gross - totalDed);
    const ctcMonthly = r2(gross + pfEmr + esicEmr + gratuity);

    return {
      basic,
      hra,
      special_allowance: special,
      allowances,
      allowances_total: allowancesTotal,
      gross_salary: gross,
      pf_employee: pfEmp,
      esic_employee: esicEmp,
      professional_tax: p.professionalTax,
      tds: p.tds,
      total_deductions: totalDed,
      net_salary: net,
      pf_employer: pfEmr,
      pf_employer_epf: pfEmrEpf,
      pf_employer_eps: pfEmrEps,
      esic_employer: esicEmr,
      gratuity,
      ctc_monthly: ctcMonthly,
    };
  },
};
