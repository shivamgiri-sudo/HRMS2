import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface ComponentLine {
  component_code: string;
  component_name: string;
  component_type: "earning" | "deduction" | "employer_cost";
  amount: number;
  source: "snapshot" | "structure" | "statutory" | "manual" | "system";
  taxable?: boolean;
  pf_applicable?: boolean;
  esic_applicable?: boolean;
}

export const payrollComplianceService = {
  async logAudit(runId: string, employeeId: string | null, eventType: string, detail: unknown, actorUserId?: string | null) {
    await db.execute(
      `INSERT INTO payroll_calculation_audit (id, run_id, employee_id, event_type, event_detail, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), runId, employeeId, eventType, JSON.stringify(detail ?? {}), actorUserId ?? null]
    );
  },

  async logSensitiveAccess(input: {
    actorUserId?: string | null;
    employeeId?: string | null;
    moduleKey: string;
    actionKey: string;
    purpose: string;
    metadata?: unknown;
    req?: any;
  }) {
    await db.execute(
      `INSERT INTO sensitive_data_access_log
        (id, actor_user_id, employee_id, module_key, action_key, legal_basis, purpose, metadata, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.actorUserId ?? null,
        input.employeeId ?? null,
        input.moduleKey,
        input.actionKey,
        "employment_and_legal_obligation",
        input.purpose,
        JSON.stringify(input.metadata ?? {}),
        input.req?.ip ?? null,
        input.req?.headers?.["user-agent"] ?? null,
      ]
    );
  },

  async addIssue(input: {
    runId?: string | null;
    employeeId?: string | null;
    issueCode: string;
    issueTitle: string;
    issueDetail?: string | null;
    severity?: "info" | "warning" | "critical" | "blocking";
    ownerRole?: string | null;
  }) {
    await db.execute(
      `INSERT INTO payroll_compliance_issue
        (id, run_id, employee_id, issue_code, issue_title, issue_detail, severity, owner_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.runId ?? null,
        input.employeeId ?? null,
        input.issueCode,
        input.issueTitle,
        input.issueDetail ?? null,
        input.severity ?? "warning",
        input.ownerRole ?? null,
      ]
    );
  },

  async clearRunIssues(runId: string) {
    await db.execute("DELETE FROM payroll_compliance_issue WHERE run_id = ?", [runId]);
  },

  async getComponentBreakup(employeeId: string, runMonth: string, grossMonthly: number, basicPct = 40, hraPct = 20): Promise<ComponentLine[]> {
    const monthStart = `${runMonth}-01`;
    const [snapRows] = await db.execute<RowDataPacket[]>(
      `SELECT component_code, component_name, component_type, amount_monthly,
              taxable, pf_applicable, esic_applicable
         FROM payroll_employee_component_snapshot
        WHERE employee_id = ?
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
          AND locked_status = 1
        ORDER BY component_type, component_code`,
      [employeeId, monthStart, monthStart]
    );

    if (snapRows.length > 0) {
      return (snapRows as any[]).map((r) => ({
        component_code: r.component_code,
        component_name: r.component_name,
        component_type: r.component_type,
        amount: r2(r.amount_monthly),
        source: "snapshot",
        taxable: !!r.taxable,
        pf_applicable: !!r.pf_applicable,
        esic_applicable: !!r.esic_applicable,
      }));
    }

    const basic = r2(grossMonthly * (basicPct / 100));
    const hra = r2(grossMonthly * (hraPct / 100));
    const special = r2(grossMonthly - basic - hra);

    return [
      { component_code: "BASIC", component_name: "Basic Salary", component_type: "earning", amount: basic, source: "structure", taxable: true, pf_applicable: true, esic_applicable: true },
      { component_code: "HRA", component_name: "House Rent Allowance", component_type: "earning", amount: hra, source: "structure", taxable: true, pf_applicable: false, esic_applicable: true },
      { component_code: "SPECIAL", component_name: "Special Allowance", component_type: "earning", amount: special, source: "structure", taxable: true, pf_applicable: false, esic_applicable: true },
    ];
  },

  applyLwpToEarnings(components: ComponentLine[], workingDays: number, lwpDays: number) {
    const ratio = workingDays > 0 ? Math.max(0, (workingDays - lwpDays) / workingDays) : 1;
    return components.map((c) => {
      if (c.component_type !== "earning") return c;
      return { ...c, amount: r2(c.amount * ratio) };
    });
  },

  async replaceLineComponents(runId: string, lineId: string | null, employeeId: string, components: ComponentLine[]) {
    await db.execute("DELETE FROM salary_prep_line_component WHERE run_id = ? AND employee_id = ?", [runId, employeeId]);

    for (const c of components) {
      await db.execute(
        `INSERT INTO salary_prep_line_component
          (id, run_id, line_id, employee_id, component_code, component_name, component_type, amount, source, taxable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), runId, lineId, employeeId, c.component_code, c.component_name, c.component_type, r2(c.amount), c.source, c.taxable === false ? 0 : 1]
      );
    }
  },

  async validateRun(runId: string) {
    await this.clearRunIssues(runId);

    const [runRows] = await db.execute<RowDataPacket[]>("SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]);
    const run = runRows[0] as any;
    if (!run) throw new Error("Payroll run not found");

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.employment_status, e.branch_id, e.process_id, e.date_of_joining,
              esa.id AS salary_assignment_id,
              ebd.id AS bank_id,
              ebd.verified_status AS bank_verified_status
         FROM employees e
         LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
         LEFT JOIN employee_bank_details ebd ON ebd.employee_id = e.id AND ebd.active_status = 1
        WHERE e.active_status = 1
          AND LOWER(e.employment_status) = 'active'
          AND (e.date_of_joining IS NULL OR e.date_of_joining <= LAST_DAY(CONCAT(?, '-01')))
          AND (e.date_of_exit IS NULL OR e.date_of_exit >= CONCAT(?, '-01'))`,
      [run.run_month, run.run_month]
    );

    let issues = 0;
    for (const emp of empRows as any[]) {
      if (!emp.salary_assignment_id) {
        issues++;
        await this.addIssue({ runId, employeeId: emp.id, issueCode: "MISSING_SALARY_ASSIGNMENT", issueTitle: "Salary structure not assigned", issueDetail: `${emp.employee_code} has no active salary assignment.`, severity: "blocking", ownerRole: "finance" });
      }
      if (!emp.branch_id) {
        issues++;
        await this.addIssue({ runId, employeeId: emp.id, issueCode: "MISSING_BRANCH", issueTitle: "Branch missing", issueDetail: `${emp.employee_code} has no branch mapping.`, severity: "critical", ownerRole: "hr" });
      }
      if (!emp.bank_id) {
        issues++;
        await this.addIssue({ runId, employeeId: emp.id, issueCode: "MISSING_BANK_DETAILS", issueTitle: "Bank details missing", issueDetail: `${emp.employee_code} has no active bank details.`, severity: "blocking", ownerRole: "finance" });
      } else if (String(emp.bank_verified_status ?? "").toLowerCase() !== "verified") {
        issues++;
        await this.addIssue({ runId, employeeId: emp.id, issueCode: "BANK_NOT_VERIFIED", issueTitle: "Bank details not verified", issueDetail: `${emp.employee_code} bank details exist but are not verified.`, severity: "critical", ownerRole: "finance" });
      }
    }

    await db.execute(
      `UPDATE salary_prep_run
          SET compliance_checked = 1,
              compliance_checked_at = NOW(),
              compliance_issues_count = ?
        WHERE id = ?`,
      [issues, runId]
    );

    return { run_id: runId, employees_checked: empRows.length, issues_count: issues, can_calculate: issues === 0 };
  },

  async upsertComponentSnapshot(employeeId: string, effectiveFrom: string, components: ComponentLine[], actorUserId?: string | null) {
    for (const c of components) {
      await db.execute(
        `INSERT INTO payroll_employee_component_snapshot
          (id, employee_id, effective_from, component_code, component_name, component_type,
           amount_monthly, taxable, pf_applicable, esic_applicable, is_existing_breakup, locked_status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
         ON DUPLICATE KEY UPDATE
           component_name = VALUES(component_name),
           component_type = VALUES(component_type),
           amount_monthly = VALUES(amount_monthly),
           taxable = VALUES(taxable),
           pf_applicable = VALUES(pf_applicable),
           esic_applicable = VALUES(esic_applicable),
           locked_status = 1,
           updated_at = NOW()`,
        [
          randomUUID(),
          employeeId,
          effectiveFrom,
          c.component_code,
          c.component_name,
          c.component_type,
          r2(c.amount),
          c.taxable === false ? 0 : 1,
          c.pf_applicable ? 1 : 0,
          c.esic_applicable === false ? 0 : 1,
          actorUserId ?? null,
        ]
      );
    }
    return { employee_id: employeeId, effective_from: effectiveFrom, components_saved: components.length };
  },

  async addManualAdjustment(input: {
    runId: string;
    lineId: string;
    employeeId: string;
    adjustmentType: "earning" | "deduction" | "lwp_override" | "attendance_override" | "statutory_override";
    componentCode: string;
    componentName: string;
    amount: number;
    reason: string;
    actorUserId?: string | null;
  }) {
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT spr.status FROM salary_prep_run spr
        JOIN salary_prep_line spl ON spl.run_id = spr.id
       WHERE spl.id = ? LIMIT 1`,
      [input.lineId]
    );
    const status = String((runRows[0] as any)?.status ?? "");
    if (["locked", "disbursed"].includes(status)) throw new Error(`Cannot edit payroll line because run is ${status}`);

    await db.execute(
      `INSERT INTO salary_prep_line_adjustment
        (id, run_id, line_id, employee_id, adjustment_type, component_code, component_name,
         amount, reason, created_by, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [randomUUID(), input.runId, input.lineId, input.employeeId, input.adjustmentType, input.componentCode, input.componentName, r2(input.amount), input.reason, input.actorUserId ?? null, input.actorUserId ?? null]
    );

    await this.logAudit(input.runId, input.employeeId, "MANUAL_PAYROLL_ADJUSTMENT", input, input.actorUserId);
    return { ok: true };
  },
};
