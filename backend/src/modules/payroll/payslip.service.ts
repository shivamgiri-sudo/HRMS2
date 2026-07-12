import { randomUUID } from "crypto";
import type { Request } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { queueAutoAwards } from "../engagement/badge.service.js";

export interface PayslipData {
  id: string;
  run_id: string;
  employee_id: string;
  prep_line_id?: string;
  payslip_ref: string;
  generated_at: string;
  generated_by: string | null;
  file_url: string | null;
  acknowledged_at: string | null;
  cheque_no?: string | null;
  payment_mode?: string | null;
  payment_date?: string | null;
  // From salary_prep_line + employees join
  employee_code?: string;
  employee_name?: string;
  designation?: string;
  department?: string;
  epf_number?: string;
  esi_number?: string;
  branch_name?: string;
  location_name?: string;
  run_month?: string;
  gross_salary?: number;
  gross_pay?: number;
  total_deductions?: number;
  net_salary?: number;
  net_pay?: number;
  pf_employee?: number;
  esic_employee?: number;
  professional_tax?: number;
  pt_amount?: number;
  tds?: number;
  tds_amount?: number;
  basic?: number;
  hra?: number;
  other_allowances?: number;
  lwp_deduction?: number;
  advance_recovery?: number;
  working_days?: number;
  present_days?: number;
  lwp_days?: number;
  ctc?: number;
  ctc_annual?: number;
  earnings?: Array<{
    component_code: string;
    component_name: string;
    component_type: string;
    amount: number;
    taxable: number;
  }>;
  deductions?: Array<{
    component_code: string;
    component_name: string;
    component_type: string;
    amount: number;
    taxable: number;
  }>;
}

export const payslipService = {
  /**
   * Generate a payslip record for a given employee within a run.
   * Fetches salary_prep_line data and inserts into salary_payslip.
   * Logs a sensitive PAYSLIP_GENERATED audit entry.
   */
  async generatePayslip(
    runId: string,
    employeeId: string,
    generatedBy: string,
    req?: Request
  ): Promise<PayslipData> {
    // Fetch the prep line
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT spl.*, spr.run_month
         FROM salary_prep_line spl
         JOIN salary_prep_run  spr ON spr.id = spl.run_id
        WHERE spl.run_id = ? AND spl.employee_id = ?
        LIMIT 1`,
      [runId, employeeId]
    );
    const line = (lineRows as any[])[0];
    if (!line) {
      throw new Error("Prep line not found for this run and employee");
    }

    const payslipRef = `PS-${line.run_month}-${line.employee_code}`;
    const id = randomUUID();

    // Upsert: if payslip already exists for this run+employee, overwrite it
    await db.execute(
      `INSERT INTO salary_payslip
         (id, prep_line_id, employee_id, run_month, payslip_ref, generated_by, acknowledged_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         payslip_ref  = VALUES(payslip_ref),
         run_month    = VALUES(run_month),
         generated_at = CURRENT_TIMESTAMP,
         generated_by = VALUES(generated_by),
         acknowledged_at = NULL`,
      [id, line.id, employeeId, line.run_month, payslipRef, generatedBy]
    );

    void logSensitiveAction({
      actor_user_id: generatedBy,
      action_type: "PAYSLIP_GENERATED",
      module_key: "payroll",
      entity_type: "salary_payslip",
      entity_id: employeeId,
      change_summary: { run_id: runId, run_month: line.run_month },
      req,
    });

    return this.getPayslip(employeeId, runId);
  },

  /**
   * Retrieve a payslip with prep_line data merged in.
   * Returns text/JSON only — no PDF generation.
   */
  async getPayslip(employeeId: string, runId: string): Promise<PayslipData> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sp.*,
              spl.id            AS prep_line_id,
              spl.run_id,
              spl.employee_code,
              spr.run_month,
              spl.gross_salary   AS gross_pay,
              spl.gross_salary,
              spl.total_deductions,
              spl.net_salary     AS net_pay,
              spl.net_salary,
              spl.pf_employee,
              spl.esic_employee,
              spl.professional_tax AS pt_amount,
              spl.professional_tax,
              spl.tds            AS tds_amount,
              spl.tds,
              spl.basic,
              spl.hra,
              spl.special_allowance AS other_allowances,
              spl.lwp_deduction,
              spl.advance_recovery,
              spl.pf_employer,
              spl.esic_employer,
              spl.working_days,
              spl.present_days,
              spl.lwp_days,
              e.first_name, e.last_name,
              e.ctc              AS ctc_annual,
              e.ctc,
              e.pan_number,
              COALESCE(eu.uan, eu.member_id, e.epf_number) AS epf_number,
              eu.uan AS uan_number,
              e.esic_number      AS esi_number,
              CASE WHEN e.bank_account_number IS NOT NULL
                THEN CONCAT('XXXX', RIGHT(e.bank_account_number, 4))
                ELSE NULL END    AS bank_account_masked,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
              d.designation_name  AS designation,
              dept.dept_name      AS department,
              br.branch_name,
              loc.location_name,
              spr.run_month,
              srd.cheque_no,
              srd.payment_mode,
              srd.payment_date
         FROM salary_payslip sp
         JOIN salary_prep_line spl
           ON CONVERT(spl.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(sp.prep_line_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         JOIN salary_prep_run spr
           ON CONVERT(spr.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(spl.run_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         LEFT JOIN employees e
           ON CONVERT(e.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(sp.employee_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         LEFT JOIN employee_uan eu
           ON CONVERT(eu.employee_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(e.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          AND eu.is_active = 1
         LEFT JOIN designation_master d
           ON CONVERT(d.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(e.designation_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         LEFT JOIN department_master dept
           ON CONVERT(dept.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(e.department_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         LEFT JOIN branch_master br
           ON CONVERT(br.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(e.branch_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         LEFT JOIN location_master loc
           ON CONVERT(loc.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(e.location_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
         LEFT JOIN salary_run_disbursal srd
           ON CONVERT(srd.run_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(spl.run_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
          AND CONVERT(srd.employee_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(sp.employee_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        WHERE sp.employee_id = ? AND spl.run_id = ?
        LIMIT 1`,
      [employeeId, runId]
    );
    const rec = (rows as PayslipData[])[0];
    if (!rec) throw new Error("Payslip not found");

    const [components] = await db.execute<RowDataPacket[]>(
      `SELECT component_code, component_name, component_type, amount, taxable
         FROM salary_prep_line_component
        WHERE line_id = ?
        ORDER BY component_type, component_code`,
      [rec.prep_line_id]
    );
    rec.earnings = (components as any[])
      .filter((component) => (component.component_type || "").toLowerCase() === "earning")
      .map((component) => ({ ...component, amount: Number(component.amount ?? 0) }));
    rec.deductions = (components as any[])
      .filter((component) => (component.component_type || "").toLowerCase() === "deduction")
      .map((component) => ({ ...component, amount: Number(component.amount ?? 0) }));
    return rec;
  },

  /**
   * Acknowledge a payslip — only the owning employee may acknowledge.
   * Enforces ownership: returns 403 if employeeId does not match.
   */
  async acknowledgePayslip(
    payslipId: string,
    requestingEmployeeId: string
  ): Promise<PayslipData> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sp.*, spl.run_id
         FROM salary_payslip sp
         JOIN salary_prep_line spl
           ON CONVERT(spl.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(sp.prep_line_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        WHERE sp.id = ?
        LIMIT 1`,
      [payslipId]
    );
    const rec = (rows as any[])[0];
    if (!rec) throw new Error("Payslip not found");

    if (rec.employee_id !== requestingEmployeeId) {
      const err: any = new Error("Forbidden: you may only acknowledge your own payslip");
      err.statusCode = 403;
      throw err;
    }

    await db.execute(
      "UPDATE salary_payslip SET acknowledged_at = NOW() WHERE id = ?",
      [payslipId]
    );

    const payslip = await this.getPayslip(rec.employee_id, rec.run_id);
    queueAutoAwards(rec.employee_id, "payslip_acknowledged");
    return payslip;
  },
};
