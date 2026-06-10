import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEffectiveConfig } from "../customization/customization-engine.js";
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

    const conds = ["e.active_status = 1", "e.employment_status = 'Active'"];
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

    for (const emp of employees) {
      const asgId = randomUUID();
      await db.execute(
        `INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from)
         VALUES (?, ?, ?, ?, ?)`,
        [asgId, emp.id, input.structureId, input.ctcAnnual, input.effectiveFrom]
      );
    }

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

  async assignSalary(input: AssignSalaryInput, _userId: string): Promise<EmployeeSalaryAssignment> {
    await db.execute(
      "UPDATE employee_salary_assignment SET active_status = 0 WHERE employee_id = ? AND active_status = 1",
      [input.employeeId]
    );
    const id = randomUUID();
    await db.execute(
      `INSERT INTO employee_salary_assignment (id, employee_id, structure_id, ctc_annual, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.employeeId, input.structureId, input.ctcAnnual, input.effectiveFrom, input.effectiveTo ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_salary_assignment WHERE id = ? LIMIT 1", [id]
    );
    return (rows as EmployeeSalaryAssignment[])[0];
  },

  async getEmployeeSalary(employeeId: string): Promise<EmployeeSalaryAssignment | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_salary_assignment WHERE employee_id = ? AND active_status = 1 LIMIT 1",
      [employeeId]
    );
    return (rows as EmployeeSalaryAssignment[])[0] ?? null;
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
    const { page, limit, runMonth, status, scopeFilter } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (runMonth) { conds.push("run_month = ?"); params.push(runMonth); }
    if (status)   { conds.push("status = ?");    params.push(status); }

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
      `SELECT * FROM salary_prep_run ${where} ORDER BY run_month DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM salary_prep_run ${where}`, params
    );
    return { data: rows as SalaryPrepRun[], total: (countRows as any)[0]?.total ?? 0, page, limit };
  },

  // ─── Prep Lines ────────────────────────────────────────────────────────────

  async listLines(runId: string): Promise<SalaryPrepLine[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_prep_line WHERE run_id = ? ORDER BY employee_code ASC",
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
