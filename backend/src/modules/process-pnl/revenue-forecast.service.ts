import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { getCurrentDateIST } from "../../shared/istDate.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
import { inboxService } from "../inbox/inbox.service.js";
import { refuse } from "./finance-error.js";
import { OWN_COMPANY_SQL } from "./pnl-actuals.service.js";

/**
 * Monthly revenue forecast per cost centre (owner requirement 2026-10-06, migration 2118).
 *
 *   draft / rejected --submit--> submitted --Finance Head + Payroll Head approve--> approved (OPEN)
 *                                          \--either rejects--> rejected (Branch Head edits, resubmits)
 *   approved --Branch Head closes with actuals--> closed --Finance Head reopens--> approved
 *
 * The P&L counts an OPEN forecast's amount as the cost centre's revenue, and a CLOSED one's closed
 * amount (getForecastRevenueByCostCentre below). Due by the 26th of the month before the period.
 */

export const LINE_TYPES = ["seat", "metric", "fixed", "reward", "penalty"] as const;
export type ForecastLineType = (typeof LINE_TYPES)[number];
export type ForecastStatus = "draft" | "submitted" | "approved" | "rejected" | "closed";
export type ApprovalStage = "finance_head" | "payroll_head";

export interface ForecastLineInput {
  lineType: ForecastLineType;
  description: string;
  metricKey?: string | null;
  quantity?: number | null;
  rate?: number | null;
  amount?: number | null;
}

export interface ForecastActualInput {
  lineId: string;
  actualQuantity?: number | null;
  actualRate?: number | null;
  actualAmount?: number | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

/**
 * A line's signed rupee amount. Seat and metric lines are quantity x rate. Fixed and reward lines
 * take the entered amount (or quantity x rate when both are given). A penalty always reduces
 * revenue, whatever sign was typed.
 */
export function lineAmount(input: { lineType: ForecastLineType; quantity?: number | null; rate?: number | null; amount?: number | null }): number {
  const q = num(input.quantity);
  const r = num(input.rate);
  const typed = num(input.amount);
  let value: number;
  if (input.lineType === "seat" || input.lineType === "metric") {
    if (q === null || r === null) throw refuse(400, "FORECAST_LINE_QTY_RATE", "Seat and metric lines need a quantity and a rate");
    if (q < 0 || r < 0) throw refuse(400, "FORECAST_LINE_NEGATIVE", "Quantity and rate cannot be negative");
    value = q * r;
  } else if (q !== null && r !== null) {
    value = Math.abs(q * r);
  } else {
    if (typed === null) throw refuse(400, "FORECAST_LINE_AMOUNT", "Enter an amount, or a quantity and a rate");
    value = Math.abs(typed);
  }
  return round2(input.lineType === "penalty" ? -value : value);
}

/** Forecast for period YYYY-MM is due on the 26th of the month before. */
export function forecastDueDate(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 26));
  return prev.toISOString().slice(0, 10);
}

function assertPeriod(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw refuse(400, "FORECAST_PERIOD_INVALID", "period must be YYYY-MM");
}

function validateLines(lines: ForecastLineInput[]) {
  if (!Array.isArray(lines) || lines.length === 0) throw refuse(400, "FORECAST_NO_LINES", "Add at least one revenue line");
  if (lines.length > 100) throw refuse(400, "FORECAST_TOO_MANY_LINES", "A forecast can carry at most 100 lines");
  return lines.map((line, i) => {
    if (!LINE_TYPES.includes(line.lineType)) throw refuse(400, "FORECAST_LINE_TYPE", `Line ${i + 1}: unknown line type`);
    const description = String(line.description ?? "").trim().slice(0, 255);
    if (!description) throw refuse(400, "FORECAST_LINE_DESCRIPTION", `Line ${i + 1}: describe the line`);
    return {
      lineType: line.lineType,
      description,
      metricKey: line.lineType === "metric" ? String(line.metricKey ?? "").trim().slice(0, 40) || "other" : null,
      quantity: num(line.quantity),
      rate: num(line.rate),
      amount: lineAmount(line),
    };
  });
}

async function loadForecast(id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT f.*, ccm.cost_centre_code, ccm.cost_centre_name, bm.branch_name
       FROM revenue_forecast f
       LEFT JOIN cost_centre_master ccm ON ccm.id = f.cost_centre_id
       LEFT JOIN branch_master bm ON bm.id = f.branch_id
      WHERE f.id = ? LIMIT 1`,
    [id],
  );
  const forecast = rows[0];
  if (!forecast) throw refuse(404, "FORECAST_NOT_FOUND", "Revenue forecast not found");
  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM revenue_forecast_line WHERE forecast_id = ? ORDER BY line_no`,
    [id],
  );
  return { ...forecast, lines } as RowDataPacket & { lines: RowDataPacket[] };
}

async function notifyRoles(roles: ApprovalStage[], title: string, description: string, forecastId: string) {
  for (const role of roles) {
    const userIds = await resolveRoleHolderUserIds(role, null).catch(() => [] as string[]);
    for (const userId of userIds) {
      // A bell item is a courtesy: a failure to create one must never undo the submission.
      try {
        await inboxService.createItem({
          user_id: userId, type: "revenue_forecast_review", title, description,
          entity_type: "revenue_forecast", entity_id: forecastId,
          action_url: `/finance/revenue-forecast?review=${forecastId}`, priority: "high",
        });
      } catch { /* ignored */ }
    }
  }
}

async function notifyUser(userId: string | null, title: string, description: string, forecastId: string) {
  if (!userId) return;
  try {
    await inboxService.createItem({
      user_id: userId, type: "revenue_forecast_update", title, description,
      entity_type: "revenue_forecast", entity_id: forecastId,
      action_url: `/finance/revenue-forecast?open=${forecastId}`, priority: "medium",
    });
  } catch { /* ignored */ }
}

export const revenueForecastService = {
  /**
   * Every active MAS cost centre in scope for the period, with its forecast (if any). The list a
   * Branch Head works from and the approvers' overview: one row per cost centre so a missing
   * forecast is visible as missing, not absent.
   */
  async list(period: string, branchIds: string[] | null) {
    assertPeriod(period);
    const branchSql = branchIds ? (branchIds.length ? `AND ccm.branch_id IN (${branchIds.map(() => "?").join(",")})` : "AND 1 = 0") : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ccm.id AS cost_centre_id, ccm.cost_centre_code, ccm.cost_centre_name, ccm.branch_id, bm.branch_name,
              f.id AS forecast_id, f.status, f.forecast_amount, f.closed_amount,
              f.finance_head_status, f.payroll_head_status, f.submitted_at, f.approved_at, f.closed_at,
              (SELECT COUNT(*) FROM revenue_forecast_line l WHERE l.forecast_id = f.id) AS line_count
         FROM cost_centre_master ccm
         LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
         LEFT JOIN revenue_forecast f ON f.cost_centre_id = ccm.id AND f.period_code = ?
        WHERE (ccm.active_status = 1 OR f.id IS NOT NULL) AND ${OWN_COMPANY_SQL} ${branchSql}
        ORDER BY bm.branch_name, ccm.cost_centre_code`,
      [period, ...(branchIds ?? [])],
    );
    const due = forecastDueDate(period);
    const today = getCurrentDateIST();
    return {
      period, dueDate: due,
      rows: rows.map((r) => {
        const forecast = r.forecast_amount === null || r.forecast_amount === undefined ? null : Number(r.forecast_amount);
        const closed = r.closed_amount === null || r.closed_amount === undefined ? null : Number(r.closed_amount);
        const status = (r.status ?? "missing") as ForecastStatus | "missing";
        return {
          costCentreId: String(r.cost_centre_id), costCentreCode: r.cost_centre_code, costCentreName: r.cost_centre_name,
          branchId: r.branch_id, branchName: r.branch_name,
          forecastId: r.forecast_id ?? null, status, forecastAmount: forecast, closedAmount: closed,
          variance: forecast !== null && closed !== null ? round2(closed - forecast) : null,
          financeHeadStatus: r.finance_head_status ?? null, payrollHeadStatus: r.payroll_head_status ?? null,
          lineCount: Number(r.line_count ?? 0),
          overdue: (status === "missing" || status === "draft" || status === "rejected") && today > due,
          pnlBasis: status === "closed" ? "CLOSED" : status === "approved" ? "OPEN" : null,
        };
      }),
    };
  },

  get: loadForecast,

  /** Create or replace the draft for (cost centre, period). Only draft or rejected forecasts change. */
  async saveDraft(input: { costCentreId: string; branchId: string; period: string; notes?: string | null; lines: ForecastLineInput[] }, actorId: string) {
    assertPeriod(input.period);
    if (input.period < getCurrentDateIST().slice(0, 7)) throw refuse(409, "FORECAST_PERIOD_PAST", "A forecast can only be raised for the current or a future month");
    const lines = validateLines(input.lines);
    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.execute<RowDataPacket[]>(
        `SELECT id, status FROM revenue_forecast WHERE cost_centre_id = ? AND period_code = ? FOR UPDATE`,
        [input.costCentreId, input.period],
      );
      let id = existing[0]?.id ? String(existing[0].id) : null;
      if (id && !["draft", "rejected"].includes(String(existing[0].status))) {
        throw refuse(409, "FORECAST_LOCKED", `This forecast is ${existing[0].status} and can no longer be edited`);
      }
      if (!id) {
        id = randomUUID();
        await connection.execute(
          `INSERT INTO revenue_forecast (id, branch_id, cost_centre_id, period_code, status, forecast_amount, notes, created_by)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
          [id, input.branchId, input.costCentreId, input.period, total, input.notes ?? null, actorId],
        );
      } else {
        await connection.execute(
          `UPDATE revenue_forecast SET forecast_amount = ?, notes = ? WHERE id = ?`,
          [total, input.notes ?? null, id],
        );
        await connection.execute(`DELETE FROM revenue_forecast_line WHERE forecast_id = ?`, [id]);
      }
      let lineNo = 1;
      for (const line of lines) {
        await connection.execute(
          `INSERT INTO revenue_forecast_line (id, forecast_id, line_no, line_type, description, metric_key, quantity, rate, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), id, lineNo++, line.lineType, line.description, line.metricKey, line.quantity, line.rate, line.amount],
        );
      }
      await connection.commit();
      return loadForecast(id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async submit(id: string, actorId: string) {
    const forecast = await loadForecast(id);
    if (!["draft", "rejected"].includes(String(forecast.status))) throw refuse(409, "FORECAST_WRONG_STAGE", `A ${forecast.status} forecast cannot be submitted`);
    if (!forecast.lines.length) throw refuse(400, "FORECAST_NO_LINES", "Add at least one revenue line before submitting");
    const [result] = await db.execute<any>(
      `UPDATE revenue_forecast
          SET status = 'submitted', submitted_by = ?, submitted_at = NOW(),
              finance_head_status = 'pending', finance_head_by = NULL, finance_head_at = NULL, finance_head_note = NULL,
              payroll_head_status = 'pending', payroll_head_by = NULL, payroll_head_at = NULL, payroll_head_note = NULL
        WHERE id = ? AND status IN ('draft','rejected')`,
      [actorId, id],
    );
    if (result.affectedRows !== 1) throw refuse(409, "FORECAST_CHANGED", "The forecast changed meanwhile; refresh and retry");
    await notifyRoles(["finance_head", "payroll_head"],
      `Revenue forecast to approve: ${forecast.cost_centre_code} ${forecast.period_code}`,
      `Forecast ₹${Number(forecast.forecast_amount).toLocaleString("en-IN")} from ${forecast.branch_name ?? "branch"}`, id);
    return loadForecast(id);
  },

  /** Finance Head and Payroll Head each decide once; both approvals make it OPEN, either rejection sends it back. */
  async review(id: string, stage: ApprovalStage, decision: "approved" | "rejected", note: string | null, actorId: string) {
    if (decision === "rejected" && !String(note ?? "").trim()) throw refuse(400, "FORECAST_REJECT_REASON", "Give a reason for rejecting");
    const forecast = await loadForecast(id);
    if (String(forecast.status) !== "submitted") throw refuse(409, "FORECAST_WRONG_STAGE", `A ${forecast.status} forecast is not awaiting approval`);
    if (String(forecast[`${stage}_status`]) !== "pending") throw refuse(409, "FORECAST_ALREADY_DECIDED", "This approval has already been given");
    if (String(forecast.submitted_by ?? "") === actorId) throw refuse(403, "FORECAST_SELF_APPROVAL", "You cannot approve a forecast you submitted");
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<any>(
        `UPDATE revenue_forecast SET ${stage}_status = ?, ${stage}_by = ?, ${stage}_at = NOW(), ${stage}_note = ?
          WHERE id = ? AND status = 'submitted' AND ${stage}_status = 'pending'`,
        [decision, actorId, note, id],
      );
      if (result.affectedRows !== 1) throw refuse(409, "FORECAST_CHANGED", "The forecast changed meanwhile; refresh and retry");
      if (decision === "rejected") {
        await connection.execute(`UPDATE revenue_forecast SET status = 'rejected' WHERE id = ?`, [id]);
      } else {
        await connection.execute(
          `UPDATE revenue_forecast SET status = 'approved', approved_at = NOW()
            WHERE id = ? AND finance_head_status = 'approved' AND payroll_head_status = 'approved'`,
          [id],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const after = await loadForecast(id);
    const who = stage === "finance_head" ? "Finance Head" : "Payroll Head";
    if (decision === "rejected") {
      await notifyUser(after.submitted_by ? String(after.submitted_by) : null, `Revenue forecast returned: ${after.cost_centre_code} ${after.period_code}`, `${who}: ${note}`, id);
    } else if (String(after.status) === "approved") {
      await notifyUser(after.submitted_by ? String(after.submitted_by) : null, `Revenue forecast approved: ${after.cost_centre_code} ${after.period_code}`, "Open in the P&L until you close it with actuals", id);
    }
    return after;
  },

  /** Close an OPEN forecast with the actual per line. No approval: the P&L switches to the closed amount. */
  async close(id: string, actuals: ForecastActualInput[], note: string | null, actorId: string) {
    const forecast = await loadForecast(id);
    if (String(forecast.status) !== "approved") throw refuse(409, "FORECAST_WRONG_STAGE", "Only an approved (open) forecast can be closed");
    const byId = new Map((actuals ?? []).map((a) => [String(a.lineId), a]));
    const resolved = forecast.lines.map((line) => {
      const a = byId.get(String(line.id));
      if (!a) throw refuse(400, "FORECAST_ACTUAL_MISSING", `Enter the actual for line ${line.line_no} (${line.description})`);
      const actualAmount = lineAmount({ lineType: line.line_type, quantity: a.actualQuantity, rate: a.actualRate, amount: a.actualAmount });
      return { id: String(line.id), q: num(a.actualQuantity), r: num(a.actualRate), amount: actualAmount };
    });
    const closedTotal = round2(resolved.reduce((s, l) => s + l.amount, 0));
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      for (const l of resolved) {
        await connection.execute(
          `UPDATE revenue_forecast_line SET actual_quantity = ?, actual_rate = ?, actual_amount = ? WHERE id = ? AND forecast_id = ?`,
          [l.q, l.r, l.amount, l.id, id],
        );
      }
      const [result] = await connection.execute<any>(
        `UPDATE revenue_forecast SET status = 'closed', closed_amount = ?, closed_by = ?, closed_at = NOW(), close_note = ?
          WHERE id = ? AND status = 'approved'`,
        [closedTotal, actorId, note, id],
      );
      if (result.affectedRows !== 1) throw refuse(409, "FORECAST_CHANGED", "The forecast changed meanwhile; refresh and retry");
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return loadForecast(id);
  },

  /** Finance Head only: a closed forecast goes back to OPEN (the P&L counts the forecast again). */
  async reopen(id: string, reason: string, actorId: string) {
    if (!String(reason ?? "").trim()) throw refuse(400, "FORECAST_REOPEN_REASON", "Give a reason for reopening");
    const [result] = await db.execute<any>(
      `UPDATE revenue_forecast SET status = 'approved', closed_amount = NULL, reopened_by = ?, reopened_at = NOW(), reopen_reason = ?
        WHERE id = ? AND status = 'closed'`,
      [actorId, reason, id],
    );
    if (result.affectedRows !== 1) throw refuse(409, "FORECAST_WRONG_STAGE", "Only a closed forecast can be reopened");
    return loadForecast(id);
  },

  /** Draft or rejected only — nothing the P&L has counted is ever deleted. */
  async discard(id: string) {
    const [result] = await db.execute<any>(`DELETE FROM revenue_forecast WHERE id = ? AND status IN ('draft','rejected')`, [id]);
    if (result.affectedRows !== 1) throw refuse(409, "FORECAST_WRONG_STAGE", "Only a draft or rejected forecast can be discarded");
    await db.execute(`DELETE FROM revenue_forecast_line WHERE forecast_id = ?`, [id]);
    return { id, discarded: true };
  },
};

export interface ForecastRevenue {
  amount: number;
  forecastAmount: number;
  state: "OPEN" | "CLOSED";
}

/**
 * The revenue the P&L counts per cost centre from forecasts: the closed amount once closed, the
 * forecast amount while open (approved). Drafts, submitted and rejected forecasts count nothing.
 */
export async function getForecastRevenueByCostCentre(period: string): Promise<Map<string, ForecastRevenue>> {
  const out = new Map<string, ForecastRevenue>();
  if (!/^\d{4}-\d{2}$/.test(period) || !(await tableExists("revenue_forecast"))) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cost_centre_id, status, forecast_amount, closed_amount
       FROM revenue_forecast
      WHERE period_code = ? AND status IN ('approved','closed')`,
    [period],
  );
  for (const r of rows) {
    const closed = String(r.status) === "closed";
    out.set(String(r.cost_centre_id), {
      amount: Number(closed ? r.closed_amount : r.forecast_amount) || 0,
      forecastAmount: Number(r.forecast_amount) || 0,
      state: closed ? "CLOSED" : "OPEN",
    });
  }
  return out;
}
