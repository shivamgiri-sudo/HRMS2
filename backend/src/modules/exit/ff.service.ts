import { randomUUID } from "crypto";
import type { Request } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { calculateGratuity } from "../payroll/payrollCalculate.service.js";
import { notifyFullFinalReady } from "./exit.notifications.js";

export interface FfInput {
  calculationDate: string;
  noticePeriodDays?: number;
  noticeShortfallDays?: number;
  noticeRecovery?: number;
  earnedLeaveEncashment?: number;
  gratuityAmount?: number;
  salaryHold?: number;
  advancesRecovery?: number;
  netPayable?: number;
}

export interface FullFinalCalculation {
  id: string;
  exit_request_id: string;
  employee_id: string;
  calculation_date: string;
  notice_period_days: number;
  notice_shortfall_days: number;
  notice_recovery: number;
  earned_leave_encashment: number;
  gratuity_amount: number;
  salary_hold: number;
  advances_recovery: number;
  net_payable: number;
  status: "draft" | "verified" | "approved" | "paid";
  is_ff_provisional: number;
  prepared_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  employee_name?: string;
  /**
   * Payroll this employee has already been paid around the settlement period.
   *
   * Deliberately informational rather than a blocking check. A mid-month leaver
   * legitimately appears in both: that month's run pays their pro-rated salary to
   * the last working day, and F&F settles the separate final dues. Refusing F&F
   * on overlap would reject the normal case. What it guards against is the real
   * risk — pending salary being keyed into salary_hold by hand when payroll has
   * already paid it — by putting the figures in front of whoever prepares the
   * settlement.
   */
  payroll_already_paid?: PayrollAlreadyPaid[];
}

export interface GratuityCalculation {
  amount: number;
  status: "draft" | "not_eligible" | "pending_configuration";
  note: string;
}

/** A payroll line already raised for this employee around the settlement period. */
export interface PayrollAlreadyPaid {
  run_month: string;
  run_status: string;
  gross_salary: number;
  net_salary: number;
  paid_working_days: number | null;
}

export const ffService = {
  async createFF(
    exitRequestId: string,
    data: FfInput,
    preparedBy: string,
    req?: Request
  ): Promise<FullFinalCalculation> {
    const [exitRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, employee_id FROM exit_request WHERE id = ? LIMIT 1",
      [exitRequestId]
    );
    const exitReq = (exitRows as any[])[0];
    if (!exitReq) throw new Error("Exit request not found");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO full_final_calculation
         (id, exit_request_id, employee_id, calculation_date,
          notice_period_days, notice_shortfall_days, notice_recovery,
          earned_leave_encashment, gratuity_amount, salary_hold,
          advances_recovery, net_payable, status, is_ff_provisional, prepared_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?)`,
      [
        id,
        exitRequestId,
        exitReq.employee_id,
        data.calculationDate,
        data.noticePeriodDays    ?? 0,
        data.noticeShortfallDays ?? 0,
        data.noticeRecovery      ?? 0,
        data.earnedLeaveEncashment ?? 0,
        data.gratuityAmount      ?? 0,
        data.salaryHold          ?? 0,
        data.advancesRecovery    ?? 0,
        data.netPayable          ?? 0,
        preparedBy,
      ]
    );

    void logSensitiveAction({
      actor_user_id: preparedBy,
      action_type: "FULL_FINAL_CREATED",
      module_key: "exit",
      entity_type: "full_final_calculation",
      entity_id: id,
      change_summary: { exit_request_id: exitRequestId, employee_id: exitReq.employee_id },
      req,
    });

    return this.getFF(exitRequestId);
  },

  async getFF(exitRequestId: string): Promise<FullFinalCalculation> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ff.*,
              COALESCE(NULLIF(e.full_name, ''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name
         FROM full_final_calculation ff
         LEFT JOIN employees e ON e.id = ff.employee_id
        WHERE ff.exit_request_id = ?
        LIMIT 1`,
      [exitRequestId]
    );
    const rec = (rows as FullFinalCalculation[])[0];
    if (!rec) throw new Error("F&F calculation not found");
    rec.payroll_already_paid = await this.getPayrollAlreadyPaid(
      rec.employee_id,
      String(rec.calculation_date)
    );
    return rec;
  },

  /**
   * Payroll already raised for an employee over the settlement window: the
   * calculation month and the two before it.
   *
   * Draft and cancelled runs are excluded because nothing has been paid from
   * them, as are excluded/blocked lines. Anything left is money the employee has
   * already received, which is what makes double-counting it in F&F a risk.
   */
  async getPayrollAlreadyPaid(
    employeeId: string,
    calculationDate: string
  ): Promise<PayrollAlreadyPaid[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT spr.run_month,
              spr.status            AS run_status,
              spl.gross_salary,
              spl.net_salary,
              spl.paid_working_days
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id
        WHERE spl.employee_id = ?
          AND LOWER(spl.status) NOT IN ('excluded', 'blocked')
          AND LOWER(spr.status) NOT IN ('draft', 'cancelled')
          AND spr.run_month BETWEEN DATE_FORMAT(DATE_SUB(?, INTERVAL 2 MONTH), '%Y-%m')
                                AND DATE_FORMAT(?, '%Y-%m')
        ORDER BY spr.run_month DESC`,
      [employeeId, calculationDate, calculationDate]
    );
    return rows as PayrollAlreadyPaid[];
  },

  async approveFF(
    id: string,
    approvedBy: string,
    req?: Request
  ): Promise<FullFinalCalculation> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM full_final_calculation WHERE id = ? LIMIT 1",
      [id]
    );
    const rec = (rows as any[])[0];
    if (!rec) throw new Error("F&F calculation not found");
    if (rec.status === "paid") throw new Error("F&F already paid — cannot re-approve");

    if (Number(rec.is_ff_provisional) === 1) {
      throw new Error(
        "Cannot approve F&F: calculation contains provisional statutory values. " +
        "Verify and recalculate with approved configuration before approving."
      );
    }

    await db.execute(
      `UPDATE full_final_calculation
          SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [approvedBy, id]
    );

    void logSensitiveAction({
      actor_user_id: approvedBy,
      action_type: "FULL_FINAL_APPROVED",
      module_key: "exit",
      entity_type: "full_final_calculation",
      entity_id: id,
      change_summary: { exit_request_id: rec.exit_request_id },
      req,
    });

    void notifyFullFinalReady(rec.exit_request_id);

    return this.getFF(rec.exit_request_id);
  },

  async setProvisionalFalse(
    id: string,
    verifiedBy: string,
    req?: Request
  ): Promise<FullFinalCalculation> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM full_final_calculation WHERE id = ? LIMIT 1",
      [id]
    );
    const rec = (rows as any[])[0];
    if (!rec) throw new Error("F&F calculation not found");

    await db.execute(
      `UPDATE full_final_calculation
          SET is_ff_provisional = 0, updated_at = NOW()
        WHERE id = ?`,
      [id]
    );

    void logSensitiveAction({
      actor_user_id: verifiedBy,
      action_type: "FF_PROVISIONAL_CLEARED",
      module_key: "exit",
      entity_type: "full_final_calculation",
      entity_id: id,
      change_summary: { exit_request_id: rec.exit_request_id, verified_by: verifiedBy },
      req,
    });

    return this.getFF(rec.exit_request_id);
  },

  calculateGratuity(
    doj: string | Date,
    exitDate: string | Date,
    gratuityWageBase: number | undefined,
    config?: {
      minYears?: number;
      daysInMonth?: number;
      monthsPerYear?: number;
      maxGratuity?: number;
    }
  ): GratuityCalculation {
    if (gratuityWageBase === undefined) {
      return {
        amount: 0,
        status: "pending_configuration",
        note: "Gratuity wage base not configured. Admin must supply approved eligible wage.",
      };
    }

    const joinDate    = new Date(doj);
    const lwd         = new Date(exitDate);
    const diffMs      = lwd.getTime() - joinDate.getTime();
    const tenureYears = diffMs / (365.25 * 24 * 60 * 60 * 1000);
    const completedYears = Math.floor(tenureYears);

    const minYears     = config?.minYears     ?? 5;
    const daysInMonth  = config?.daysInMonth  ?? 26;
    const monthsPer    = config?.monthsPerYear ?? 15;

    if (completedYears < minYears) {
      return {
        amount: 0,
        status: "not_eligible",
        note: "Minimum service period not completed.",
      };
    }

    let amount = (gratuityWageBase / daysInMonth) * monthsPer * completedYears;

    if (config?.maxGratuity !== undefined && amount > config.maxGratuity) {
      amount = config.maxGratuity;
    }

    return {
      amount: Math.round(amount * 100) / 100,
      status: "draft",
      note: "Draft calculation. Requires verification before F&F approval.",
    };
  },

  /**
   * @param lastWorkingDay Settlement date to measure tenure to. Omit only for a live
   *   projection; for an exit, leaving it out credits service the employee did not
   *   work between their last day and whenever the settlement is prepared.
   */
  async calculateGratuityFromEmployee(
    employeeId: string,
    lastWorkingDay?: string | Date
  ): Promise<GratuityCalculation> {
    const [salRows] = await db.execute<RowDataPacket[]>(
      `SELECT esa.ctc_annual, ss.basic_pct
         FROM employee_salary_assignment esa
         JOIN salary_structure_master ss ON ss.id = esa.structure_id
        WHERE esa.employee_id = ? AND esa.active_status = 1
        ORDER BY esa.effective_from DESC
        LIMIT 1`,
      [employeeId]
    );
    const sal = (salRows as Array<{ ctc_annual: number; basic_pct: number }>)[0];
    if (!sal) {
      return {
        amount: 0,
        status: "pending_configuration",
        note: "No active salary assignment found for employee.",
      };
    }

    const lastBasicMonthly = (sal.ctc_annual / 12) * ((sal.basic_pct ?? 40) / 100);
    const result = await calculateGratuity(employeeId, lastBasicMonthly, lastWorkingDay);

    if (!result.eligible) {
      // Reporting a configuration gap as "minimum service not completed" told a
      // twenty-year employee they had served 0 years. Each cause now says what it is.
      if (result.reason === "not_configured") {
        return {
          amount: 0,
          status: "pending_configuration",
          note: "Gratuity is not configured. statutory_config needs the service minimum, day divisor and days-per-year before gratuity can be calculated.",
        };
      }
      if (result.reason === "no_joining_date") {
        return {
          amount: 0,
          status: "pending_configuration",
          note: "Employee has no date of joining recorded, so tenure cannot be established.",
        };
      }
      return {
        amount: 0,
        status: "not_eligible",
        note: `Minimum service period not completed (${result.years} complete years).`,
      };
    }

    return {
      amount: result.amount,
      status: "draft",
      note: `Draft calculation over ${result.years} completed years on a last basic of ${lastBasicMonthly.toFixed(2)}. Requires verification before F&F approval.`,
    };
  },
};