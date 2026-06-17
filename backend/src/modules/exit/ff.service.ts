import { randomUUID } from "crypto";
import type { Request } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { calculateGratuity } from "../payroll/payrollCalculate.service.js";

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
}

export interface GratuityCalculation {
  amount: number;
  status: "draft" | "not_eligible" | "pending_configuration";
  note: string;
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
    return rec;
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

  async calculateGratuityFromEmployee(employeeId: string): Promise<GratuityCalculation> {
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
    const result = await calculateGratuity(employeeId, lastBasicMonthly);

    if (!result.eligible) {
      return {
        amount: 0,
        status: "not_eligible",
        note: `Minimum service period not completed (${result.years} complete years).`,
      };
    }

    return {
      amount: result.amount,
      status: "draft",
      note: `Draft calculation: (${lastBasicMonthly.toFixed(2)} / 26) × 15 × ${result.years} years. Requires verification before F&F approval.`,
    };
  },
};