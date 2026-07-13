import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEffectiveConfig } from "../customization/customization-engine.js";
import { assertSalaryAssignmentAllowed } from "./salary-governance.guard.js";
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

  async updateStructure(id: string, input: Partial<CreateStructureInput>, _userId: string): Promise<SalaryStructure> {
    const fields: string[] = [];
    const params: any[] = [];
    if (input.structureName !== undefined) { fields.push("structure_name = ?"); params.push(input.structureName); }
    if (input.description   !== undefined) { fields.push("description = ?");    params.push(input.description ?? null); }
    if (input.basicPct      !== undefined) { fields.push("basic_pct = ?");      params.push(input.basicPct); }
    if (input.hraPct        !== undefined) { fields.push("hra_pct = ?");        params.push(input.hraPct); }
    if (!fields.length) throw Object.assign(new Error("No fields to update"), { statusCode: 400 });
    fields.push("updated_at = NOW()");
    params.push(id);
    await db.execute(`UPDATE salary_structure_master SET ${fields.join(", ")} WHERE id = ?`, params);
    return this.getStructure(id);
  },

  async deleteStructure(id: string): Promise<void> {
    const [inUse] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM employee_salary_assignment WHERE structure_id = ? AND active_status = 1 LIMIT 1",
      [id]
    );
    if ((inUse as RowDataPacket[]).length > 0) {
      throw Object.assign(new Error("Structure is in use by active salary assignments"), { statusCode: 409 });
    }
    await db.execute("UPDATE salary_structure_master SET active_status = 0 WHERE id = ?", [id]);
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

  async bulkAssignSalary(
    input: BulkAssignInput,
    userId: string,
    actorRoles: string[] = []
  ): Promise<BulkAssignResult> {
    await this.getStructure(input.structureId);

    // ── Salary governance gate ────────────────────────────────────────────────
    const govInput = input as any;
    const govResult = await assertSalaryAssignmentAllowed({
      salarySlabId: govInput.salarySlabId ?? null,
      salaryProposalId: govInput.salaryProposalId ?? null,
      approvalReferenceId: govInput.approvalReferenceId ?? null,
      ctcAnnual: input.ctcAnnual,
      actorUserId: userId,
      actorRoles,
      migrationMode: govInput.migrationMode,
      reason: govInput.reason ?? null,
    });
    if (!govResult.allowed) {
      throw Object.assign(new Error(govResult.message ?? "Salary assignment blocked"), {
        statusCode: 400,
        code: govResult.blockCode,
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const conds = ["e.active_status = 1", "LOWER(e.employment_status) = 'active'"];
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
        `INSERT INTO employee_salary_assignment
           (id, employee_id, structure_id, ctc_annual, effective_from,
            salary_slab_id, salary_proposal_id, governance_mode, assigned_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          asgId, emp.id, input.structureId, input.ctcAnnual, input.effectiveFrom,
          govResult.salarySlabId ?? null,
          govResult.salaryProposalId ?? null,
          govResult.mode,
          userId,
        ]
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
        if (Array.isArray(result.config.additional_components)) {
          components = [...components, ...result.config.additional_components];
        } else if (Array.isArray(result.config.components)) {
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

  async assignSalary(
    input: AssignSalaryInput,
    userId: string,
    actorRoles: string[] = []
  ): Promise<EmployeeSalaryAssignment> {
    // ── Salary governance gate ────────────────────────────────────────────────
    const govInput = input as any;
    const govResult = await assertSalaryAssignmentAllowed({
      employeeId: input.employeeId,
      salarySlabId: govInput.salarySlabId ?? null,
      salaryProposalId: govInput.salaryProposalId ?? null,
      approvalReferenceId: govInput.approvalReferenceId ?? null,
      ctcAnnual: input.ctcAnnual,
      actorUserId: userId,
      actorRoles,
      migrationMode: govInput.migrationMode,
      reason: govInput.reason ?? null,
    });
    if (!govResult.allowed) {
      throw Object.assign(new Error(govResult.message ?? "Salary assignment blocked"), {
        statusCode: 400,
        code: govResult.blockCode,
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const id = randomUUID();
    const conn = await (db as any).getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "UPDATE employee_salary_assignment SET active_status = 0 WHERE employee_id = ? AND active_status = 1",
        [input.employeeId]
      );
      await conn.execute(
        `INSERT INTO employee_salary_assignment
           (id, employee_id, structure_id, ctc_annual, effective_from, effective_to,
            salary_slab_id, salary_proposal_id, governance_mode, assigned_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, input.employeeId, input.structureId, input.ctcAnnual,
          input.effectiveFrom, input.effectiveTo ?? null,
          govResult.salarySlabId ?? null,
          govResult.salaryProposalId ?? null,
          govResult.mode,
          userId,
        ]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
    // M1 Branch Readiness Gate: validate that all branches are ready
    try {
      const { payrollBranchReadinessService } = await import("./payroll-branch-readiness.service.js");
      const validation = await payrollBranchReadinessService.validatePayrollRunCreation(input.runMonth);
      if (validation.blocked.length > 0) {
        throw new Error(
          `Cannot create payroll run. The following branches are not ready: ${validation.blocked.join(", ")}. ` +
          `Ensure attendance is frozen and readiness score ≥ 80 for all branches, or apply HO override.`
        );
      }
    } catch (err: unknown) {
      // If error is the validation message, throw it; otherwise log and allow creation (table may not exist yet)
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not ready")) throw err;
      console.warn("[createRun] Branch readiness check skipped:", msg);
    }

    const [dup] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_prep_run
        WHERE run_month = ?
          AND (branch_filter <=> ?)
          AND (process_filter <=> ?)
        LIMIT 1`,
      [input.runMonth, input.branchFilter ?? null, input.processFilter ?? null]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("Payroll run already exists for this month");

    // Compute payroll window close date: last day of run_month + 30 calendar days
    const [runYear, runMo] = input.runMonth.split('-').map(Number);
    const lastDayOfRunMonth = new Date(runYear, runMo, 0); // day=0 of next month = last day of this month
    lastDayOfRunMonth.setDate(lastDayOfRunMonth.getDate() + 30);
    const windowCloseDate = lastDayOfRunMonth.toISOString().slice(0, 10);

    const id = randomUUID();
    await db.execute(
      `INSERT INTO salary_prep_run (id, run_month, branch_filter, process_filter, window_close_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.runMonth, input.branchFilter ?? null, input.processFilter ?? null, windowCloseDate, userId]
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

  async listRuns(filters: RunFilters): Promise<PaginatedResult<SalaryPrepRun>> {
    const { page, limit, runMonth, status } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (runMonth) { conds.push("run_month = ?"); params.push(runMonth); }
    if (status)   { conds.push("status = ?");    params.push(status); }

    // Apply scope filter from middleware
    if ((filters as any).scopeFilter) {
      const scopeFilter = (filters as any).scopeFilter;
      // scopeFilter is {sql: string, params: unknown[]} from buildScopeWhereClause
      if (typeof scopeFilter === 'object' && scopeFilter.sql) {
        const { sql, params: scopeParams } = scopeFilter;
        if (sql === "1=0") {
          // User has no access - return empty result immediately
          return { data: [], total: 0, page, limit };
        }
        if (sql && sql !== "1=1") {
          // Add scope filter SQL (already without WHERE prefix)
          conds.push(`(${sql})`);
          // Merge scope params into main params array
          params.push(...(scopeParams || []));
        }
        // If sql === "1=1", user has full access - no additional filter needed
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
    // Skipped entirely when employee has an approved PF opt-out (voluntary declaration).
    const pfBase = Math.min(basic, p.pfWageLimit);
    const pfEmp = p.pfOptOut ? 0 : r2(pfBase * (p.pfEmployeePct / 100));

    // Employer PF: EPF 3.67% + EPS 8.33% of min(Basic, ₹15,000 EPS ceiling)
    const epsCeiling = 15000;
    const epsBase = Math.min(basic, epsCeiling);
    const pfEmrEpf = p.pfOptOut ? 0 : r2(pfBase * 0.0367);
    const pfEmrEps = p.pfOptOut ? 0 : r2(epsBase * 0.0833);
    const pfEmr = r2(pfEmrEpf + pfEmrEps);

    // ESIC: on full gross (including allowances), skip when gross > esicWageLimit
    // Also skipped when employee has an approved ESI opt-out (voluntary declaration).
    const esicApplicable = !p.esicOptOut && gross <= p.esicWageLimit;
    const esicEmp = esicApplicable ? r2(gross * (p.esicEmployeePct / 100)) : 0;
    const esicEmr = esicApplicable ? r2(gross * 0.0325) : 0;

    // Gratuity: configurable % of Basic — employer cost, not employee deduction
    // Always require configuration; no hardcoded 4.81% fallback (B5 fix: load from statutory_config)
    const gratuityPct = (p.gratuityPct ?? 0) / 100;
    const gratuity = r2(basic * gratuityPct);

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

  async getEmployeeSalaryHistory(employeeId: string): Promise<any[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT spr.run_month,
              spl.gross_salary AS gross_pay, spl.net_salary AS net_pay,
              spl.basic AS basic_pay, spl.hra, spl.special_allowance AS conveyance,
              spl.pf_employee, spl.esic_employee AS esi_employee,
              spl.professional_tax, spl.tds AS tds_deducted,
              spl.total_deductions, spl.paid_working_days AS days_payable,
              spl.lwp_days AS lop_days, spl.status
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
       WHERE spl.employee_id = ?
       ORDER BY spr.run_month DESC LIMIT 24`,
      [employeeId]
    );
    return Array.isArray(rows) ? rows : [];
  },

  async listPayrollRecords(filters: {
    page?: number; limit?: number; runMonth?: string; search?: string;
    status?: string; branchId?: string; processId?: string; departmentId?: string;
    scopeFilter?: { sql: string; params: unknown[] };
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(1000, filters.limit ?? 50);
    const offset = (page - 1) * limit;
    const innerParams: any[] = [];
    const innerConds: string[] = [];

    if (filters.runMonth) { innerConds.push("spr.run_month = ?"); innerParams.push(filters.runMonth); }
    if (filters.status) {
      const normalizedStatus = String(filters.status).trim().toLowerCase();
      if (normalizedStatus === "paid") {
        innerConds.push("LOWER(COALESCE(spr.status, '')) IN ('disbursed', 'finalized', 'finalised', 'paid')");
      } else if (normalizedStatus === "processing") {
        innerConds.push("(LOWER(COALESCE(spr.status, '')) IN ('processing', 'reviewed', 'approved', 'locked') OR LOWER(COALESCE(spl.status, '')) = 'calculated')");
      } else if (normalizedStatus === "pending") {
        innerConds.push("(LOWER(COALESCE(spr.status, '')) NOT IN ('disbursed', 'finalized', 'finalised', 'paid', 'processing', 'reviewed', 'approved', 'locked') AND LOWER(COALESCE(spl.status, '')) <> 'calculated')");
      } else {
        innerConds.push("(LOWER(COALESCE(spr.status, '')) = ? OR LOWER(COALESCE(spl.status, '')) = ?)");
        innerParams.push(normalizedStatus, normalizedStatus);
      }
    }
    if (filters.branchId) { innerConds.push("e.branch_id = ?");   innerParams.push(filters.branchId); }
    if (filters.processId){ innerConds.push("e.process_id = ?");  innerParams.push(filters.processId); }
    if (filters.departmentId) { innerConds.push("e.department_id = ?"); innerParams.push(filters.departmentId); }
    if (filters.search) {
      innerConds.push(
        "(e.employee_code LIKE ? OR e.full_name LIKE ? OR e.email LIKE ?" +
        " OR CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')) LIKE ?)"
      );
      const s = `%${filters.search}%`;
      innerParams.push(s, s, s, s);
    }

    // scope enforcement — use 1=0 deny-all when no scope provided rather than fallback to open
    const scopeSql = filters.scopeFilter?.sql ?? "1=0";
    const scopeParams = filters.scopeFilter?.params ?? [];
    innerConds.push(`(${scopeSql})`);

    const whereClause = innerConds.length ? innerConds.join(" AND ") : "1=1";
    const allParams = [...innerParams, ...scopeParams];

    const baseSql = `
      FROM salary_prep_line spl
      JOIN salary_prep_run spr ON spr.id = spl.run_id
      LEFT JOIN employees e    ON e.id = spl.employee_id
      LEFT JOIN branch_master bm   ON bm.id = e.branch_id
      LEFT JOIN process_master pm  ON pm.id = e.process_id
      LEFT JOIN department_master dm ON dm.id = e.department_id
      LEFT JOIN designation_master dsg ON dsg.id = e.designation_id
      WHERE ${whereClause}`;

    const selectSql = `
      SELECT
        spl.id,
        spl.run_id,
        spl.employee_id,
        COALESCE(spl.employee_code, e.employee_code) AS employee_code,
        COALESCE(NULLIF(TRIM(e.full_name),''),
                 TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))),
                 spl.employee_code) AS employee_name,
        e.email AS employee_email,
        e.avatar_url AS employee_avatar,
        spr.run_month,
        spr.status AS run_status,
        spr.disbursed_at,
        spl.status AS line_status,
        COALESCE(spl.basic, 0)             AS basic,
        COALESCE(spl.hra, 0)               AS hra,
        COALESCE(spl.special_allowance, 0) AS special_allowance,
        COALESCE(spl.gross_salary, 0)      AS gross_salary,
        COALESCE(spl.incentive_total, 0)   AS incentive_total,
        COALESCE(spl.total_deductions, 0)  AS total_deductions,
        COALESCE(spl.net_salary, 0)        AS net_salary,
        COALESCE(spl.working_days, 0)      AS working_days,
        COALESCE(spl.present_days, 0)      AS present_days,
        COALESCE(spl.lwp_days, 0)          AS lwp_days,
        bm.branch_name,
        pm.process_name,
        dm.dept_name AS department_name,
        dsg.designation_name AS designation`;

    const [rows] = await db.execute<RowDataPacket[]>(
      `${selectSql} ${baseSql} ORDER BY spr.run_month DESC, employee_name ASC LIMIT ? OFFSET ?`,
      [...allParams, limit, offset]
    );
    const [countRow] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total ${baseSql}`,
      allParams
    );
    return {
      data: Array.isArray(rows) ? rows : [],
      total: (countRow as any[])[0]?.total ?? 0,
      page,
      limit,
    };
  },

  async getPayrollOverview(runMonth: string): Promise<any> {
    const [runRow] = await db.execute<RowDataPacket[]>(
      "SELECT id, run_month, status, total_employees, total_gross, total_net FROM salary_prep_run WHERE run_month = ? LIMIT 1",
      [runMonth]
    );
    let run = Array.isArray(runRow) && runRow.length ? runRow[0] : null;
    let isFallback = false;
    let effectiveRunMonth = runMonth;

    // If no run exists for requested month, fall back to the most recent completed run
    if (!run) {
      const [fallbackRow] = await db.execute<RowDataPacket[]>(
        `SELECT id, run_month, status, total_employees, total_gross, total_net
           FROM salary_prep_run
          WHERE status IN ('disbursed','finalized','finalised','calculated','reviewed','approved','locked')
          ORDER BY run_month DESC
          LIMIT 1`
      );
      if (Array.isArray(fallbackRow) && fallbackRow.length) {
        run = fallbackRow[0];
        effectiveRunMonth = String(run.run_month);
        isFallback = true;
      }
    }

    const [stats] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT spl.employee_id) AS employee_count,
              SUM(spl.basic)             AS total_basic,
              SUM(spl.gross_salary)      AS total_gross,
              SUM(spl.net_salary)        AS total_net,
              SUM(spl.total_deductions)  AS total_deductions,
              SUM(spl.pf_employee)       AS total_pf,
              SUM(spl.esic_employee)     AS total_esi,
              SUM(spl.tds)               AS total_tds,
              CASE WHEN COUNT(DISTINCT spl.employee_id) > 0
                   THEN ROUND(SUM(spl.net_salary) / COUNT(DISTINCT spl.employee_id), 2)
                   ELSE 0 END            AS avg_net
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
       WHERE spr.run_month = ?`,
      [effectiveRunMonth]
    );
    return {
      run,
      stats: Array.isArray(stats) && stats.length ? stats[0] : null,
      runMonth: effectiveRunMonth,
      isFallback,
    };
  },

  async updateOvertime(
    lineId: string,
    data: { overtimeHours?: number; overtimeAmount?: number },
    _updatedBy: string
  ): Promise<any> {
    const fields: string[] = [];
    const params: any[] = [];
    if (data.overtimeHours  !== undefined) { fields.push("overtime_hours = ?");  params.push(data.overtimeHours); }
    if (data.overtimeAmount !== undefined) { fields.push("overtime_amount = ?"); params.push(data.overtimeAmount); }
    if (!fields.length) throw Object.assign(new Error("No overtime fields to update"), { statusCode: 400 });

    // Enforce overtime eligibility: check if this employee's process allows OT
    const [lineEmp] = await db.execute<RowDataPacket[]>(
      `SELECT e.process_id FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       WHERE spl.id = ? LIMIT 1`,
      [lineId]
    );
    const processId = (lineEmp as any[])?.[0]?.process_id;
    if (processId) {
      const [cfgRows] = await db.execute<RowDataPacket[]>(
        `SELECT config_value FROM payroll_config_flags
         WHERE process_id = ? AND config_key = 'overtime_allowed' LIMIT 1`,
        [processId]
      );
      const allowed = (cfgRows as any[])?.[0]?.config_value;
      if (allowed !== 'true') {
        throw Object.assign(
          new Error("Overtime is not allowed for this employee's process. Enable it in Overtime Configuration first."),
          { statusCode: 403 }
        );
      }
      // Enforce monthly cap if configured
      if (data.overtimeHours !== undefined && data.overtimeHours > 0) {
        const [capRows] = await db.execute<RowDataPacket[]>(
          `SELECT config_value FROM payroll_config_flags
           WHERE process_id = ? AND config_key = 'overtime_monthly_cap_hours' LIMIT 1`,
          [processId]
        );
        const capHours = parseFloat((capRows as any[])?.[0]?.config_value || '0');
        if (capHours > 0 && data.overtimeHours > capHours) {
          throw Object.assign(
            new Error(`Overtime hours (${data.overtimeHours}) exceed monthly cap of ${capHours}h for this process.`),
            { statusCode: 400 }
          );
        }
      }
      // Apply rounding rules: minimum threshold + floor to rounding unit
      if (data.overtimeHours !== undefined && data.overtimeHours > 0) {
        const [roundCfg] = await db.execute<RowDataPacket[]>(
          `SELECT config_key, config_value FROM payroll_config_flags
           WHERE process_id = ? AND config_key IN ('overtime_minimum_hours', 'overtime_rounding_unit')`,
          [processId]
        );
        const cfgMap: Record<string, string> = {};
        for (const row of roundCfg as any[]) cfgMap[row.config_key] = row.config_value;
        // Fall back to global defaults if process-level not set
        if (!cfgMap['overtime_minimum_hours'] || !cfgMap['overtime_rounding_unit']) {
          const [globalRound] = await db.execute<RowDataPacket[]>(
            `SELECT config_key, config_value FROM payroll_config_flags
             WHERE process_id IS NULL AND branch_id IS NULL
             AND config_key IN ('overtime_minimum_hours', 'overtime_rounding_unit')`
          );
          for (const row of globalRound as any[]) {
            if (!cfgMap[row.config_key]) cfgMap[row.config_key] = row.config_value;
          }
        }
        const minHours = parseFloat(cfgMap['overtime_minimum_hours'] || '0');
        const roundUnit = parseFloat(cfgMap['overtime_rounding_unit'] || '0');
        if (minHours > 0 && data.overtimeHours < minHours) {
          data.overtimeHours = 0;
          data.overtimeAmount = 0;
        } else if (roundUnit > 0) {
          data.overtimeHours = Math.floor(data.overtimeHours / roundUnit) * roundUnit;
        }
        if (data.overtimeHours === 0) {
          data.overtimeAmount = 0;
        }
        // Rebuild fields/params with rounded values
        fields.length = 0;
        params.length = 0;
        fields.push("overtime_hours = ?");  params.push(data.overtimeHours);
        fields.push("overtime_amount = ?"); params.push(data.overtimeAmount ?? 0);
      }
    } else {
      // No process assigned — check global default
      const [globalRows] = await db.execute<RowDataPacket[]>(
        `SELECT config_value FROM payroll_config_flags
         WHERE process_id IS NULL AND branch_id IS NULL AND config_key = 'overtime_allowed' LIMIT 1`
      );
      const globalAllowed = (globalRows as any[])?.[0]?.config_value;
      if (globalAllowed !== 'true') {
        throw Object.assign(
          new Error("Overtime is not allowed globally. Enable it for the relevant process in Overtime Configuration."),
          { statusCode: 403 }
        );
      }
    }

    fields.push("updated_at = NOW()");
    params.push(lineId);
    await db.execute(`UPDATE salary_prep_line SET ${fields.join(", ")} WHERE id = ?`, params);
    const [updated] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM salary_prep_line WHERE id = ? LIMIT 1",
      [lineId]
    );
    return Array.isArray(updated) && updated.length ? updated[0] : null;
  },
};

export function breakSpecialAllowance(
  specialAmount: number,
  convDefault?: number,
  maDefault?: number,
): { conv: number; ma: number; pa: number } {
  // B5 fix: Load from statutory_config, no hardcoded defaults
  // If config values are missing, return zero breakup to force configuration
  const CONV_DEFAULT = convDefault ?? 0;
  const MA_DEFAULT = maDefault ?? 0;
  const totalDefault = CONV_DEFAULT + MA_DEFAULT;

  if (specialAmount <= 0 || totalDefault <= 0) return { conv: 0, ma: 0, pa: specialAmount > 0 ? specialAmount : 0 };

  if (specialAmount >= totalDefault) {
    return {
      conv: CONV_DEFAULT,
      ma: MA_DEFAULT,
      pa: Math.round((specialAmount - totalDefault) * 100) / 100,
    };
  }

  const conv = Math.round((specialAmount * CONV_DEFAULT / totalDefault) * 100) / 100;
  const ma = Math.round((specialAmount * MA_DEFAULT / totalDefault) * 100) / 100;
  const pa = Math.round((specialAmount - conv - ma) * 100) / 100;
  return { conv, ma, pa };
};

// ── Finance Approval ──────────────────────────────────────────────────────────
export async function approveRunForDisbursement(
  runId: string,
  approverUserId: string
): Promise<{ success: boolean; run_id: string; status: string }> {
  // Verify run exists and is in 'locked' status
  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM salary_prep_run WHERE id = ? LIMIT 1`,
    [runId]
  );
  const run = (runRows as any[])[0];
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }
  if (run.status !== "locked") {
    throw new Error(`Run must be in 'locked' status to approve for disbursement (current: ${run.status})`);
  }

  // Update run status to 'disbursed' + record approver
  await db.execute(
    `UPDATE salary_prep_run
        SET status = 'disbursed',
            finance_approved_by = ?,
            finance_approved_at = NOW()
      WHERE id = ?`,
    [approverUserId, runId]
  );

  // Log audit
  const { logSensitiveAction } = await import("../../shared/auditLog.js");
  await logSensitiveAction({
    actor_user_id: approverUserId,
    action_type: "FINANCE_APPROVAL",
    module_key: "payroll",
    entity_type: "salary_prep_run",
    entity_id: runId,
    change_summary: { run_id: runId, new_status: "disbursed" },
  });

  return { success: true, run_id: runId, status: "disbursed" };
}
