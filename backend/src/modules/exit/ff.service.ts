import { randomUUID } from "crypto";
import type { Request } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordMoneyEventAudit } from "../../shared/moneyEventAudit.js";
import { calculateGratuity } from "../payroll/payrollCalculate.service.js";
import { notifyFullFinalReady } from "./exit.notifications.js";
// Type-only import — does not create a runtime circular dependency with
// ff-compute.service.ts, which imports ffService from this file.
import type { ComputedStatus } from "./ff-compute.service.js";

/**
 * Every refusal in this file is a governance decision the operator needs to read: the
 * settlement is not approved, the payment reference is missing, you approved this one so
 * you may not also pay it. All of them were bare `new Error(...)`, and the production error
 * handler replaces the message of any throw that carries no statusCode — so in production
 * the maker-checker refusal reached Finance as a generic 500 with no reason attached, which
 * reads as a broken screen rather than a control doing its job.
 */
function ffError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

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
  /**
   * Required when any of noticeRecovery / earnedLeaveEncashment / gratuityAmount /
   * advancesRecovery differs from what ff-compute.service.ts's computeFfPreview()
   * derived, by more than FF_NET_TOLERANCE. Same mandatory-reason shape as
   * setProvisionalFalse's reason — a deviation from the computed figure must be
   * explained, not silently overtyped. Not required when nothing deviates.
   */
  overrideReason?: string;
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

/**
 * Records how a gratuity figure was arrived at, into gratuity_calculation_audit.
 *
 * The table was declared by migration 246 and never created until 1119 - 246 stopped on it,
 * because it declares foreign keys to employees(id) and exit_request(id) without a COLLATE and the
 * server default disagrees with those tables. So nothing has ever written to it.
 *
 * Two rules govern what goes in, and they matter more than the feature:
 *
 * It records established facts, never reconstructed ones. basic_monthly comes from the same active
 * salary assignment the calculation itself reads, and years_of_service from date_of_joining to the
 * confirmed last working day. If either is unavailable the audit is skipped entirely rather than
 * written with a zero. This table exists to be read back in a dispute, possibly years later; a row
 * saying somebody served 0.00 years on a basic of 0.00 is worse than no row, because it looks like
 * evidence.
 *
 * It never affects the settlement. The insert is fire-and-forget inside its own try/catch: a
 * failure to record the workings must not fail, roll back or delay an F&F that is otherwise valid.
 *
 * gross and net are both the F&F's own gratuity_amount and tax_deducted is left at its default of
 * 0, because no gratuity tax is computed anywhere in this path. Deriving one here would be
 * inventing a number, which is the thing this function is meant to prevent.
 */
async function recordGratuityAudit(
  exitRequestId: string,
  employeeId: string,
  gratuityAmount: number
): Promise<void> {
  try {
    if (!(gratuityAmount > 0)) return; // nothing was granted; nothing to explain

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         esa.ctc_annual,
         ss.basic_pct,
         e.date_of_joining,
         COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed) AS last_working_day
       FROM employees e
       JOIN exit_request x ON x.id = ?
       LEFT JOIN employee_salary_assignment esa
              ON esa.employee_id = e.id AND esa.active_status = 1
       LEFT JOIN salary_structure_master ss ON ss.id = esa.structure_id
       WHERE e.id = ?
       ORDER BY esa.effective_from DESC
       LIMIT 1`,
      [exitRequestId, employeeId]
    );
    const row = (rows as any[])[0];
    if (!row?.ctc_annual || !row?.date_of_joining || !row?.last_working_day) return;

    const basicMonthly = (Number(row.ctc_annual) / 12) * (Number(row.basic_pct ?? 40) / 100);
    const years =
      (new Date(row.last_working_day).getTime() - new Date(row.date_of_joining).getTime()) /
      (365.25 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(basicMonthly) || !Number.isFinite(years) || years <= 0) return;

    await db.execute(
      `INSERT INTO gratuity_calculation_audit
         (id, exit_request_id, employee_id, years_of_service, basic_monthly,
          gratuity_formula, gross_gratuity, net_gratuity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         years_of_service = VALUES(years_of_service),
         basic_monthly    = VALUES(basic_monthly),
         gross_gratuity   = VALUES(gross_gratuity),
         net_gratuity     = VALUES(net_gratuity),
         calculation_date = NOW()`,
      [
        randomUUID(),
        exitRequestId,
        employeeId,
        Number(years.toFixed(2)),
        Number(basicMonthly.toFixed(2)),
        "(basic/daysInMonth)*daysPerYear*years, per statutory_config",
        gratuityAmount,
        gratuityAmount,
      ]
    );
  } catch (error) {
    // Never let recording the workings break the settlement itself.
    console.error("[ff] gratuity audit not recorded", error);
  }
}

/**
 * The settlement's own arithmetic: what is paid out, less what is recovered.
 *
 * This is not a statutory or company formula — it is nothing more than the sum of the fields
 * the settlement already stores, and it deliberately invents no component that is not there.
 */
export function ffComponentSum(data: {
  earnedLeaveEncashment?: number;
  gratuityAmount?: number;
  salaryHold?: number;
  noticeRecovery?: number;
  advancesRecovery?: number;
}): number {
  const n = (v: unknown) => Number(v ?? 0);
  return (
    n(data.earnedLeaveEncashment) + n(data.gratuityAmount) + n(data.salaryHold)
    - n(data.noticeRecovery) - n(data.advancesRecovery)
  );
}

/** Rupee tolerance. Components are stored to two decimals, so anything above this is a real gap. */
export const FF_NET_TOLERANCE = 0.01;

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

    // net_payable arrives from the caller like every other figure on FfInput — there is no F&F
    // calculation engine deriving it (see the module audit). Nothing checked that it agreed with
    // the components stored alongside it, so a settlement could be written whose headline amount
    // was unrelated to its own workings, and the discrepancy would only ever be found by someone
    // adding the columns up by hand in a dispute.
    //
    // This does not compute the settlement — it cannot, and pretending to would be worse. It
    // only refuses to store a total that contradicts its own parts. If the two disagree the
    // caller must say which is right; silently trusting either is how a wrong number becomes a
    // payment.
    const expectedNet = ffComponentSum(data);
    const suppliedNet = Number(data.netPayable ?? 0);
    if (Math.abs(suppliedNet - expectedNet) > FF_NET_TOLERANCE) {
      throw new Error(
        `F&F net payable (${suppliedNet.toFixed(2)}) does not equal its own components ` +
        `(${expectedNet.toFixed(2)} = leave encashment ${Number(data.earnedLeaveEncashment ?? 0).toFixed(2)} ` +
        `+ gratuity ${Number(data.gratuityAmount ?? 0).toFixed(2)} ` +
        `+ salary hold ${Number(data.salaryHold ?? 0).toFixed(2)} ` +
        `- notice recovery ${Number(data.noticeRecovery ?? 0).toFixed(2)} ` +
        `- advances recovery ${Number(data.advancesRecovery ?? 0).toFixed(2)}). ` +
        `Correct the components or the net before saving — a settlement total that disagrees with its own workings cannot be approved or paid.`
      );
    }

    // Phase 1 compute engine: compare the caller's figures against what
    // ff-compute.service.ts derived from real data, and require overrideReason for
    // any deviation beyond FF_NET_TOLERANCE — mirrors setProvisionalFalse's mandatory
    // reason for its own override. Dynamic import avoids a circular dependency
    // (ff-compute.service.ts imports ffService for calculateGratuityFromEmployee /
    // getPayrollAlreadyPaid). If the preview itself cannot be computed, that must
    // never block settlement creation — it degrades to "no deviation check
    // performed", the same failure posture as recordGratuityAudit below.
    let deviations: Record<string, { supplied: number; computed: number }> | undefined;
    try {
      const { computeFfPreview } = await import("./ff-compute.service.js");
      const preview = await computeFfPreview(exitRequestId);
      const candidates: Array<[string, number | undefined, ComputedStatus, number]> = [
        ["noticeRecovery", data.noticeRecovery, preview.notice.recovery_amount.status, preview.notice.recovery_amount.value],
        ["earnedLeaveEncashment", data.earnedLeaveEncashment, preview.leave_encashment.amount.status, preview.leave_encashment.amount.value],
        ["advancesRecovery", data.advancesRecovery, preview.advances_loans.total_recovery.status, preview.advances_loans.total_recovery.value],
      ];
      if (preview.gratuity.status === "draft") {
        candidates.push(["gratuityAmount", data.gratuityAmount, "computed", preview.gratuity.amount]);
      }
      const found: Record<string, { supplied: number; computed: number }> = {};
      for (const [field, supplied, status, computedValue] of candidates) {
        if (status !== "computed") continue; // no real baseline to compare against
        const suppliedNum = Number(supplied ?? 0);
        if (Math.abs(suppliedNum - computedValue) > FF_NET_TOLERANCE) {
          found[field] = { supplied: suppliedNum, computed: computedValue };
        }
      }
      if (Object.keys(found).length > 0) {
        deviations = found;
        if (!String(data.overrideReason ?? "").trim()) {
          throw ffError(
            422,
            `These figures differ from what the F&F compute engine derived: ${Object.entries(found)
              .map(([f, v]) => `${f} (supplied ${v.supplied.toFixed(2)} vs computed ${v.computed.toFixed(2)})`)
              .join(", ")}. Provide overrideReason to explain the deviation, or use the computed figures.`
          );
        }
      }
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 422) throw err; // real refusal, not a compute failure
      console.error("[ff] compute-preview deviation check failed (non-fatal)", err);
    }

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

    // Records the workings behind the gratuity figure. Cannot fail the settlement - see the
    // function's own try/catch - and skips itself rather than record workings it cannot establish.
    await recordGratuityAudit(exitRequestId, exitReq.employee_id, Number(data.gratuityAmount ?? 0));

    void logSensitiveAction({
      actor_user_id: preparedBy,
      action_type: "FULL_FINAL_CREATED",
      module_key: "exit",
      entity_type: "full_final_calculation",
      entity_id: id,
      change_summary: {
        exit_request_id: exitRequestId,
        employee_id: exitReq.employee_id,
        ...(deviations ? { computed_deviations: deviations, override_reason: data.overrideReason } : {}),
      },
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
    if (!rec) throw ffError(404, "F&F calculation not found");
    if (rec.status === "paid") throw ffError(409, "F&F already paid — cannot re-approve");

    if (Number(rec.is_ff_provisional) === 1) {
      throw ffError(
        409,
        "Cannot approve F&F: calculation contains provisional statutory values. " +
        "Verify and recalculate with approved configuration before approving."
      );
    }

    // WHERE carries the status this decision was made on. It was `WHERE id = ?` alone, with
    // no predicate at all, which made the guard above advisory: between that SELECT and this
    // UPDATE another actor could mark the settlement paid, and this statement would then
    // write it back to 'approved' while ff_paid_by / ff_paid_at / ff_payment_reference stayed
    // populated. A disbursed settlement would be sitting in 'approved', eligible to be paid a
    // second time. The predicate makes that lost update impossible.
    const [approveResult] = await db.execute<ResultSetHeader>(
      `UPDATE full_final_calculation
          SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW()
        WHERE id = ? AND status = ?`,
      [approvedBy, id, rec.status]
    );

    // No FULL_FINAL_APPROVED entry may be written for an approval that did not happen.
    if (approveResult.affectedRows !== 1) {
      throw ffError(409, "F&F changed while this approval was in flight — reload and retry");
    }

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

  /**
   * Record that an approved settlement has actually been disbursed.
   *
   * This transition did not exist. full_final_calculation.status is
   * enum('draft','verified','approved','paid') but nothing ever wrote 'paid', and the table
   * had no columns to record a payment at all — so the state was unreachable AND
   * unrecordable. Migration 1220 adds ff_paid_by / ff_paid_at / ff_payment_reference.
   *
   * Two things depended on 'paid' and were silently inert as a result:
   *   - FF_PAID_BUT_EMPLOYEE_ACTIVE, labelled P0, queries status='paid' and so could never
   *     fail — it reported a clean pass on a control that had never been evaluated.
   *   - The "already paid, cannot re-approve" guards in approveFF above and in
   *     ff-approval-guard.compat.routes.ts were dead branches guarding a state nothing could
   *     produce. They become live the moment this method is used.
   *
   * THREE POLICY CHOICES ARE ENCODED HERE. They follow the nearest established patterns in
   * this codebase rather than being invented, and each is a single line to change if the
   * payroll/finance owner decides otherwise:
   *
   *   1. Only an APPROVED settlement can be paid. Mirrors approveFF's own status gate, and
   *      means a draft or provisional calculation cannot be marked disbursed.
   *   2. A payment reference is REQUIRED. "Paid" without evidence is an assertion, not a
   *      record — and this field is the only thing that later reconciles the settlement
   *      against a bank statement. disbursal.routes.ts already carries bank_ref on the same
   *      reasoning.
   *   3. Maker-checker: the person who APPROVED cannot also mark it paid. Identical guard to
   *      cost-centre-management.service.ts's approveL1/approveL2, for the identical reason —
   *      approval and disbursement are two controls, and one person holding both collapses
   *      them into one. Legacy rows with a NULL approved_by are not blocked, matching how
   *      that guard treats its own legacy rows.
   */
  async markFfPaid(
    id: string,
    paidBy: string,
    paymentReference: string,
    req?: Request
  ): Promise<FullFinalCalculation> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM full_final_calculation WHERE id = ? LIMIT 1",
      [id]
    );
    const rec = (rows as any[])[0];
    if (!rec) throw ffError(404, "F&F calculation not found");

    if (rec.status === "paid") throw ffError(409, "F&F is already marked paid");
    if (rec.status !== "approved") {
      throw ffError(409, `Cannot mark paid: F&F is '${rec.status}', not 'approved'`);
    }

    const reference = String(paymentReference ?? "").trim();
    if (!reference) {
      throw ffError(400, "A payment reference (bank/UTR/cheque) is required to mark an F&F paid");
    }

    if (rec.approved_by && String(rec.approved_by) === String(paidBy)) {
      throw ffError(
        403,
        "Payment must be recorded by someone other than the person who approved this settlement"
      );
    }

    // The state change and its audit row go in ONE transaction. Previously the UPDATE ran on
    // the pool and the audit was `void logSensitiveAction(...)` — not awaited, and internally
    // catching — so a settlement could commit as PAID with no audit row at all while the route
    // still returned success. A disbursement that leaves no record cannot be reconciled against
    // a bank statement or attributed to a payer, and FF_PAID_BUT_EMPLOYEE_ACTIVE reads that
    // same trail. Strict audit is the correct trade here specifically because the alternative
    // failure — payment not recorded — is retryable, and this one is not detectable.
    const conn = await db.getConnection();
    let payResult: ResultSetHeader;
    try {
      await conn.beginTransaction();

      [payResult] = await conn.execute<ResultSetHeader>(
        `UPDATE full_final_calculation
            SET status = 'paid', ff_paid_by = ?, ff_paid_at = NOW(),
                ff_payment_reference = ?, updated_at = NOW()
          WHERE id = ? AND status = 'approved'`,
        [paidBy, reference, id]
      );

    // The expected-state predicate above was already right; its result was never read.
    //
    // Two payers recording the same settlement at once both passed the SELECT-time checks,
    // both issued this UPDATE, and only the first matched a row. The second changed nothing
    // — its payment reference was silently discarded — yet still fell through to write a
    // FULL_FINAL_PAID entry naming itself as payer and carrying its own reference, and
    // returned success. The audit trail would then show a settlement disbursed twice, under
    // two references, one of which was never recorded anywhere. On the one control whose
    // entire purpose is to reconcile a payment against a bank statement.
      if (payResult.affectedRows !== 1) {
        throw ffError(
          409,
          "F&F was already marked paid by someone else — this payment was not recorded"
        );
      }

      // Strict and awaited, on the same connection: if this throws, the payment rolls back
      // rather than committing unrecorded. See shared/moneyEventAudit.ts for why this one
      // call site does not use the non-throwing logSensitiveAction that every other does.
      await recordMoneyEventAudit(conn, {
        actor_user_id: paidBy,
        action_type: "FULL_FINAL_PAID",
        module_key: "exit",
        entity_type: "full_final_calculation",
        entity_id: id,
        change_summary: {
          exit_request_id: rec.exit_request_id,
          net_payable: rec.net_payable,
          payment_reference: reference,
        },
        employee_id: rec.employee_id ?? null,
        req,
      });

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return this.getFF(rec.exit_request_id);
  },

  async setProvisionalFalse(
    id: string,
    verifiedBy: string,
    reason: string,
    req?: Request
  ): Promise<FullFinalCalculation> {
    // CLAUDE.md requires this override to carry "an audit reason" — the role gate
    // and actor/timestamp were already recorded, but no caller ever supplied why the
    // provisional flag was cleared. Reason is now mandatory rather than optional so
    // existing callers can't silently keep omitting it.
    const trimmedReason = String(reason ?? "").trim();
    if (!trimmedReason) {
      throw new Error("A reason is required to clear a provisional F&F calculation");
    }

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
      change_summary: { exit_request_id: rec.exit_request_id, verified_by: verifiedBy, reason: trimmedReason },
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

    let note = `Draft calculation over ${result.years} completed years on a last basic of ${lastBasicMonthly.toFixed(2)}. Requires verification before F&F approval.`;
    if (result.capMissing) {
      note += " No gratuity_statutory_cap configured — this amount is uncapped and must be checked against the Payment of Gratuity Act ceiling before approval.";
    } else if (result.capApplied) {
      note += ` Statutory cap applied: formula produced ${result.uncappedAmount}, capped to ${result.amount}.`;
    }

    return {
      amount: result.amount,
      status: "draft",
      note,
    };
  },
};