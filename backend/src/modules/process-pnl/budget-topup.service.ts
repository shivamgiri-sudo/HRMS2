import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import {
  auditInTransaction,
  calculateBudgetLine,
  type BudgetGstType,
  type BudgetTaxTreatment,
} from "./branch-budget.service.js";
import { financeBranchFilter, type FinanceBranchScope } from "../finance/finance-access-scope.js";
import { resolvePendingWith } from "../finance/finance-workflow-role.js";
import { lockActiveBudgetLine } from "./budget-consumption.service.js";
import { isPeriodLocked } from "./finance-period-lock.js";
import { refuse } from "./finance-error.js";
import { recordFinanceApprovalEvent } from "../../shared/financeApprovalEvent.js";

export type BudgetTopupStatus =
  | "submitted"
  | "branch_head_approved"
  | "finance_head_approved"
  | "rejected"
  | "applied";

/**
 * Every refusal in this file is a decision the reviewer needs to read, not an internal fault.
 *
 * errorHandler.ts only forwards `error.message` when the error carries a `statusCode`. A bare
 * `throw new Error(...)` is treated as an unexpected 500 and, in production, has its message
 * REPLACED with "An unexpected server error occurred. Please quote reference <hex> if you contact
 * HR." So the maker-checker refusal, the wrong-stage refusal and "a reason is required to reject"
 * all reached the reviewer as the same anonymous reference id — a self-inflicted dead end that
 * needed a server log to decode. Observed in production 2026-08-17 (reference 538f315d) when the
 * raiser of a NOIDA-2 top-up pressed Reject on their own request.
 *
 * Every throw below therefore carries a status and a stable code:
 *   400 — the caller sent something invalid and can correct it
 *   403 — the caller holds no role valid for this stage
 *   404 — the row does not exist
 *   409 — the row exists but its current state forbids this action (stage, status, lock, maker)
 */
function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * Applies an approved top-up to its budget line, and to the header totals that summarise it.
 *
 * The line is RECOMPUTED from its new quantity through calculateBudgetLine — the same function
 * that produced every amount on it in the first place — rather than having a figure added to one
 * column. Two reasons:
 *
 *  1. `requested_amount` is a QUOTED amount. BudgetTopupPanel derives requestedQuantity as
 *     amount / unit_rate, and calculateBudgetLine's quotedAmount is quantity * unit_rate. Under
 *     exclusive GST the gross rises by quoted * (1 + rate/100), so the previous
 *     `gross_amount = gross_amount + requested_amount` under-stated the gross by the tax on the
 *     increase, and left quantity, base, tax and gross disagreeing with each other.
 *  2. It only ever touched gross_amount and quantity. base_amount, tax_amount,
 *     recoverable_tax_amount, the CGST/SGST/IGST split and — most importantly —
 *     pnl_cost_amount were left at their pre-top-up values. pnl_cost_amount is what every P&L
 *     read uses (bpo-pnl.service.ts, branch-budget.service.ts), so a formally approved increase
 *     raised the GRN ceiling while the branch went on being reported overspent against the old
 *     budget. The header's gross_budget_amount / pnl_budget_amount were not updated either.
 *
 * Recomputing is safe because lines are internally consistent by construction: verified against
 * production, all 94 existing lines satisfy quantity * unit_rate = the quoted base.
 */
/** A top-up's split of one increase across cost centres. Amount is deliberately NOT part of
 *  this shape here — it is always re-derived from quantity * unitRate using the SAME unit rate
 *  the line/new-line recompute already uses, so there is exactly one place amount and quantity
 *  can disagree (the caller's own validateCostCentreSplits check), not two. */
type TopupSplit = { costCentreId: string; quantity: number };

/**
 * Re-sums finance_budget_header's gross/pnl totals from every line beneath it. Extracted out of
 * applyTopupToLine (Group D) so applyTopupAsNewLine can call the exact same re-sum after adding a
 * brand-new line, rather than a second copy of this SQL drifting from the first.
 *
 * Header totals are re-summed from the lines rather than incremented, so they cannot drift from
 * the rows beneath them however many top-ups a budget takes. Production confirms the two are
 * currently exact to the rupee, which is the invariant worth preserving.
 */
async function resummarizeHeaderTotals(connection: PoolConnection, budgetId: string) {
  await connection.execute(
    `UPDATE finance_budget_header h
        SET h.gross_budget_amount = (
              SELECT COALESCE(SUM(l.gross_amount), 0) FROM finance_budget_line l WHERE l.budget_id = h.id),
            h.pnl_budget_amount = (
              SELECT COALESCE(SUM(l.pnl_cost_amount), 0) FROM finance_budget_line l WHERE l.budget_id = h.id)
      WHERE h.id = ?`,
    [budgetId]
  );
}

/**
 * Forces allocation_percentage across every finance_budget_line_allocation row for one budget
 * line to sum to exactly 100.000000 after decimal rounding — same defensive correction
 * grn-smart.service.ts's saveAllocations()/saveComponentAllocations() already apply to
 * grn_cost_allocation: round each row's own share to 6dp, then push whatever residual is left
 * onto the last row rather than letting the set silently sum to 99.999998 or 100.000002.
 *
 * Re-reads ALL rows for the line (not just ones a caller just touched) because a top-up changes
 * the line's total gross_amount, which every existing row's percentage is a share of — an
 * untouched row's percentage is just as stale as a touched one's after the total moves.
 */
async function renormalizeAllocationPercentages(connection: PoolConnection, budgetLineId: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, gross_amount FROM finance_budget_line_allocation WHERE budget_line_id = ?`,
    [budgetLineId]
  );
  if (!rows.length) return;
  const total = rows.reduce((sum, row) => sum + Number(row.gross_amount), 0);
  let runningTotal = 0;
  for (const row of rows) {
    const percentage = total > 0
      ? Math.round((Number(row.gross_amount) / total) * 100 * 1_000_000) / 1_000_000
      : 0;
    runningTotal += percentage;
    await connection.execute(
      `UPDATE finance_budget_line_allocation SET allocation_percentage = ? WHERE id = ?`,
      [percentage, row.id]
    );
  }
  if (total > 0 && Math.abs(runningTotal - 100) > 0.000001) {
    const last = rows[rows.length - 1];
    await connection.execute(
      `UPDATE finance_budget_line_allocation SET allocation_percentage = allocation_percentage + ? WHERE id = ?`,
      [Math.round((100 - runningTotal) * 1_000_000) / 1_000_000, last.id]
    );
  }
}

/**
 * Upserts one finance_budget_line_allocation row per split against an EXISTING line, priced
 * through calculateBudgetLine with that split's own quantity and the line's own unit/rate/tax
 * profile (so a split's amount is always quantity * unitRate, never a second client-supplied
 * figure). entry_source='manual' — a topup-driven split is not the original driver-based
 * planning calculation saveDraft() produces. ON DUPLICATE KEY UPDATE accumulates onto whatever
 * that cost centre already had allocated against this line (a second top-up against a cost
 * centre this line already splits to ADDS to its existing share, it does not replace it).
 */
async function upsertAllocationSplits(
  connection: PoolConnection,
  budgetLineId: string,
  line: {
    head: string;
    itemName: string;
    unit: string;
    unitRate: number;
    taxTreatment: BudgetTaxTreatment;
    gstRate: number;
    gstType?: BudgetGstType;
    recoverableTaxPct?: number;
  },
  splits: TopupSplit[],
  actorId: string
) {
  for (const split of splits) {
    const amounts = calculateBudgetLine({
      head: line.head,
      itemName: line.itemName,
      quantity: split.quantity,
      unit: line.unit,
      unitRate: line.unitRate,
      taxTreatment: line.taxTreatment,
      gstRate: line.gstRate,
      gstType: line.gstType,
      recoverableTaxPct: line.recoverableTaxPct,
      justification: "",
    });
    await connection.execute(
      `INSERT INTO finance_budget_line_allocation
         (id, budget_line_id, cost_centre_id, planned_unit, base_amount, tax_amount,
          gross_amount, pnl_cost_amount, entry_source, is_manual_override, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, ?)
       ON DUPLICATE KEY UPDATE
         planned_unit = planned_unit + VALUES(planned_unit),
         base_amount = base_amount + VALUES(base_amount),
         tax_amount = tax_amount + VALUES(tax_amount),
         gross_amount = gross_amount + VALUES(gross_amount),
         pnl_cost_amount = pnl_cost_amount + VALUES(pnl_cost_amount),
         is_manual_override = 1,
         updated_by = VALUES(created_by),
         updated_at = NOW()`,
      [
        randomUUID(), budgetLineId, split.costCentreId,
        split.quantity, amounts.baseAmount, amounts.taxAmount,
        amounts.grossAmount, amounts.pnlCostAmount, actorId,
      ]
    );
  }
  await renormalizeAllocationPercentages(connection, budgetLineId);
}

/**
 * Applies an approved top-up to its budget line, and to the header totals that summarise it.
 *
 * The line is RECOMPUTED from its new quantity through calculateBudgetLine — the same function
 * that produced every amount on it in the first place — rather than having a figure added to one
 * column. Two reasons:
 *
 *  1. `requested_amount` is a QUOTED amount. BudgetTopupPanel derives requestedQuantity as
 *     amount / unit_rate, and calculateBudgetLine's quotedAmount is quantity * unit_rate. Under
 *     exclusive GST the gross rises by quoted * (1 + rate/100), so the previous
 *     `gross_amount = gross_amount + requested_amount` under-stated the gross by the tax on the
 *     increase, and left quantity, base, tax and gross disagreeing with each other.
 *  2. It only ever touched gross_amount and quantity. base_amount, tax_amount,
 *     recoverable_tax_amount, the CGST/SGST/IGST split and — most importantly —
 *     pnl_cost_amount were left at their pre-top-up values. pnl_cost_amount is what every P&L
 *     read uses (bpo-pnl.service.ts, branch-budget.service.ts), so a formally approved increase
 *     raised the GRN ceiling while the branch went on being reported overspent against the old
 *     budget. The header's gross_budget_amount / pnl_budget_amount were not updated either.
 *
 * Recomputing is safe because lines are internally consistent by construction: verified against
 * production, all 94 existing lines satisfy quantity * unit_rate = the quoted base.
 *
 * Group D: optionally also writes cost-centre allocation splits for this same increase (splits +
 * actorId). When splits is omitted/empty, this is byte-for-byte the pre-Group-D behaviour — no
 * allocation-table write at all — so any other caller of this function is unaffected.
 */
async function applyTopupToLine(
  connection: PoolConnection,
  budgetLineId: string,
  additionalQuantity: number,
  splits: TopupSplit[] | undefined,
  actorId: string
) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, budget_id, head, item_name, quantity, unit, unit_rate,
            tax_treatment, gst_rate, gst_type, recoverable_tax_pct
       FROM finance_budget_line WHERE id = ?`,
    [budgetLineId]
  );
  const line = rows[0];
  if (!line) throw refuse(404, "BUDGET_LINE_NOT_FOUND", "Budget line not found");

  const recomputed = calculateBudgetLine({
    head: String(line.head),
    itemName: String(line.item_name),
    quantity: Number(line.quantity) + additionalQuantity,
    unit: String(line.unit ?? ""),
    unitRate: Number(line.unit_rate),
    taxTreatment: String(line.tax_treatment) as BudgetTaxTreatment,
    gstRate: Number(line.gst_rate ?? 0),
    gstType: (line.gst_type ?? undefined) as BudgetGstType | undefined,
    recoverableTaxPct: line.recoverable_tax_pct == null ? undefined : Number(line.recoverable_tax_pct),
    justification: "",
  });

  await connection.execute(
    `UPDATE finance_budget_line
        SET quantity = ?,
            base_amount = ?,
            tax_amount = ?,
            gross_amount = ?,
            recoverable_tax_amount = ?,
            pnl_cost_amount = ?,
            cgst_amount = ?,
            sgst_amount = ?,
            igst_amount = ?
      WHERE id = ?`,
    [
      Number(line.quantity) + additionalQuantity,
      recomputed.baseAmount,
      recomputed.taxAmount,
      recomputed.grossAmount,
      recomputed.recoverableTaxAmount,
      recomputed.pnlCostAmount,
      recomputed.cgstAmount,
      recomputed.sgstAmount,
      recomputed.igstAmount,
      budgetLineId,
    ]
  );

  if (splits?.length) {
    await upsertAllocationSplits(
      connection,
      budgetLineId,
      {
        head: String(line.head),
        itemName: String(line.item_name),
        unit: String(line.unit ?? ""),
        unitRate: Number(line.unit_rate),
        taxTreatment: String(line.tax_treatment) as BudgetTaxTreatment,
        gstRate: Number(line.gst_rate ?? 0),
        gstType: (line.gst_type ?? undefined) as BudgetGstType | undefined,
        recoverableTaxPct: line.recoverable_tax_pct == null ? undefined : Number(line.recoverable_tax_pct),
      },
      splits,
      actorId
    );
  }

  await resummarizeHeaderTotals(connection, String(line.budget_id));
}

/**
 * Applies an approved is_new_line=1 top-up request by creating the finance_budget_line row it
 * asked for, rather than increasing an existing one — there is nothing to lock or recompute from,
 * so this does NOT go through applyTopupToLine. Called only from review()'s finance_head branch.
 *
 * planning_level='branch', cost_centre_id/process_id NULL: the line itself carries no single
 * attribution, exactly like any other branch-planning-level line — attribution lives entirely in
 * finance_budget_line_allocation, one row per split, same as an existing-line top-up's splits.
 *
 * Tax profile defaults to exclusive/0%/cgst_sgst/100% recoverable — the same conservative
 * defaults grn.service.ts's createUnbudgetedDraft() uses for its own "no invoice yet to derive
 * real GST from" case. item_name reuses head (no separate item-name field on the request, same
 * reasoning createUnbudgetedDraft() applies).
 */
async function applyTopupAsNewLine(
  connection: PoolConnection,
  request: RowDataPacket,
  splits: TopupSplit[],
  actorId: string
) {
  const head = String(request.head);
  const subHead = request.sub_head != null && String(request.sub_head).trim() !== ""
    ? String(request.sub_head)
    : null;
  const unit = String(request.unit);
  const unitRate = Number(request.unit_rate);
  const quantity = Number(request.requested_quantity);
  const reason = String(request.reason || "");

  const amounts = calculateBudgetLine({
    head,
    itemName: head,
    quantity,
    unit,
    unitRate,
    taxTreatment: "exclusive" as BudgetTaxTreatment,
    gstRate: 0,
    gstType: "cgst_sgst" as BudgetGstType,
    recoverableTaxPct: 100,
    justification: reason,
  });

  const lineId = randomUUID();
  await connection.execute(
    `INSERT INTO finance_budget_line
       (id, budget_id, cost_centre_id, planning_level, process_id, head, sub_head,
        item_name, quantity, unit, unit_rate,
        tax_treatment, gst_rate, gst_type, recoverable_tax_pct,
        cgst_amount, sgst_amount, igst_amount, base_amount, tax_amount,
        gross_amount, recoverable_tax_amount, pnl_cost_amount,
        justification, reserved_amount, consumed_amount, reserved_quantity, consumed_quantity)
     VALUES (?, ?, NULL, 'branch', NULL, ?, ?, ?, ?, ?, ?,
             'exclusive', 0, 'cgst_sgst', 100,
             ?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, 0, 0, 0, 0)`,
    [
      lineId, String(request.budget_id), head, subHead, head, quantity, unit, unitRate,
      amounts.cgstAmount, amounts.sgstAmount, amounts.igstAmount, amounts.baseAmount, amounts.taxAmount,
      amounts.grossAmount, amounts.recoverableTaxAmount, amounts.pnlCostAmount,
      reason,
    ]
  );

  for (const split of splits) {
    const splitAmounts = calculateBudgetLine({
      head,
      itemName: head,
      quantity: split.quantity,
      unit,
      unitRate,
      taxTreatment: "exclusive" as BudgetTaxTreatment,
      gstRate: 0,
      gstType: "cgst_sgst" as BudgetGstType,
      recoverableTaxPct: 100,
      justification: "",
    });
    await connection.execute(
      `INSERT INTO finance_budget_line_allocation
         (id, budget_line_id, cost_centre_id, planned_unit, base_amount, tax_amount,
          gross_amount, pnl_cost_amount, entry_source, is_manual_override, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, ?)`,
      [
        randomUUID(), lineId, split.costCentreId, split.quantity,
        splitAmounts.baseAmount, splitAmounts.taxAmount, splitAmounts.grossAmount,
        splitAmounts.pnlCostAmount, actorId,
      ]
    );
  }
  // No pre-existing allocation rows on a brand-new line, so renormalizing against ALL rows for
  // this line id (the same helper applyTopupToLine uses) is equivalent to computing each split's
  // share of the new line's own total directly — reusing it here avoids a second, slightly
  // different percentage routine for what is mathematically the same computation.
  await renormalizeAllocationPercentages(connection, lineId);

  await resummarizeHeaderTotals(connection, String(request.budget_id));

  return lineId;
}

/**
 * Validates a top-up's cost-centre splits against its own aggregate amount/quantity AND, per
 * split, against that split's own internal quantity*unitRate consistency — the same defect class
 * P0P1's amount/quantity cross-check (above) exists to catch, one level down: an aggregate that
 * happens to reconcile can still hide one split whose own amount and quantity disagree.
 */
function validateCostCentreSplits(
  splits: Array<{ costCentreId: string; amount: number; quantity: number }> | undefined,
  requestedAmount: number,
  requestedQuantity: number,
  unitRate: number
): Array<{ costCentreId: string; amount: number; quantity: number }> {
  if (!Array.isArray(splits) || !splits.length) {
    throw refuse(400, "TOPUP_SPLIT_REQUIRED", "At least one cost-centre split is required");
  }
  const tolerance = Math.max(1, unitRate * 0.0001);
  let splitAmountTotal = 0;
  let splitQuantityTotal = 0;
  const normalized: Array<{ costCentreId: string; amount: number; quantity: number }> = [];
  splits.forEach((split, index) => {
    const label = `Cost-centre split ${index + 1}`;
    if (!split?.costCentreId) {
      throw refuse(400, "TOPUP_SPLIT_COST_CENTRE_REQUIRED", `${label}: a cost centre is required`);
    }
    const splitAmount = roundMoney(Number(split.amount));
    const splitQuantity = roundQuantity(Number(split.quantity));
    if (!Number.isFinite(splitAmount) || splitAmount <= 0) {
      throw refuse(400, "TOPUP_SPLIT_AMOUNT_INVALID", `${label}: amount must be greater than zero`);
    }
    if (!Number.isFinite(splitQuantity) || splitQuantity <= 0) {
      throw refuse(400, "TOPUP_SPLIT_QUANTITY_INVALID", `${label}: quantity must be greater than zero`);
    }
    const impliedSplitAmount = roundMoney(splitQuantity * unitRate);
    if (Math.abs(impliedSplitAmount - splitAmount) > tolerance) {
      throw refuse(
        400,
        "TOPUP_SPLIT_AMOUNT_QUANTITY_MISMATCH",
        `${label}: amount and quantity disagree: ${splitQuantity} x ${unitRate} = ${impliedSplitAmount}, `
          + `but ${splitAmount} was requested.`
      );
    }
    splitAmountTotal = roundMoney(splitAmountTotal + splitAmount);
    splitQuantityTotal = roundQuantity(splitQuantityTotal + splitQuantity);
    normalized.push({ costCentreId: String(split.costCentreId), amount: splitAmount, quantity: splitQuantity });
  });
  if (Math.abs(splitAmountTotal - requestedAmount) > tolerance) {
    throw refuse(
      400,
      "TOPUP_SPLIT_TOTAL_AMOUNT_MISMATCH",
      `Cost-centre splits total ${splitAmountTotal} but the requested amount is ${requestedAmount}`
    );
  }
  if (Math.abs(splitQuantityTotal - requestedQuantity) > 0.0005) {
    throw refuse(
      400,
      "TOPUP_SPLIT_TOTAL_QUANTITY_MISMATCH",
      `Cost-centre splits total ${splitQuantityTotal} units but the requested quantity is ${requestedQuantity}`
    );
  }
  return normalized;
}

/** Same cost-centre lookup grn.service.ts's createUnbudgetedDraft() and grn-smart.service.ts's
 *  saveAllocations() already apply to an unbudgeted allocation row's cost centre: must exist, be
 *  active, and belong to the branch the request is being raised for. */
async function assertCostCentresBelongToBranch(
  connection: PoolConnection,
  branchId: string,
  costCentreIds: string[]
) {
  for (const costCentreId of costCentreIds) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, branch_id FROM cost_centre_master WHERE id = ? AND active_status = 1 LIMIT 1`,
      [costCentreId]
    );
    const cc = rows[0];
    if (!cc) throw refuse(404, "TOPUP_COST_CENTRE_NOT_FOUND", `Cost centre ${costCentreId} not found or inactive`);
    if (String(cc.branch_id) !== String(branchId)) {
      throw refuse(400, "TOPUP_COST_CENTRE_BRANCH_MISMATCH", `Cost centre ${costCentreId} does not belong to this branch`);
    }
  }
}

export const budgetTopupService = {
  /** For the route-level branch scope check, before create() — same shape as
   *  branchBudgetService.get()'s branch_id, but a topup is targeted by line, not budget. */
  async getLineBranch(budgetLineId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT h.branch_id
         FROM finance_budget_line l
         JOIN finance_budget_header h ON h.id = l.budget_id
        WHERE l.id = ?`,
      [budgetLineId]
    );
    if (!rows[0]) throw refuse(404, "BUDGET_LINE_NOT_FOUND", "Budget line not found");
    return String(rows[0].branch_id);
  },

  /** Group D: same role as getLineBranch(), for a new-line request — there is no existing line
   *  to resolve branch scope through, only the budget itself. */
  async getBudgetBranch(budgetId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id FROM finance_budget_header WHERE id = ?`,
      [budgetId]
    );
    if (!rows[0]) throw refuse(404, "BUDGET_NOT_FOUND", "Budget not found");
    return String(rows[0].branch_id);
  },

  /** Raised by whoever hit "exceeds available budget" on a GRN — the branch_head/branch_admin
   *  raising against a specific budget line (existing-line) or, since Group D, against a budget
   *  with no line at all yet for a given head/sub-head (isNewLine). Never against the budget
   *  header directly for an existing-line request. */
  async create(
    input: {
      isNewLine?: boolean;
      budgetLineId?: string;
      budgetId?: string;
      head?: string;
      subHead?: string;
      unit?: string;
      unitRate?: number;
      requestedAmount: number;
      requestedQuantity: number;
      reason: string;
      costCentreSplits: Array<{ costCentreId: string; amount: number; quantity: number }>;
    },
    actorId: string,
    _actorRole: string
  ) {
    const requestedAmount = roundMoney(input.requestedAmount);
    const requestedQuantity = roundQuantity(input.requestedQuantity);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw refuse(400, "TOPUP_AMOUNT_INVALID", "Requested amount must be greater than zero");
    }
    if (!Number.isFinite(requestedQuantity) || requestedQuantity < 0) {
      throw refuse(400, "TOPUP_QUANTITY_INVALID", "Requested quantity cannot be negative");
    }
    if (!input.reason?.trim()) {
      throw refuse(400, "TOPUP_REASON_REQUIRED", "A reason is required to request a budget increase");
    }

    const isNewLine = Boolean(input.isNewLine);

    // Group D: inserting into both finance_budget_topup_request and
    // finance_budget_topup_request_split now, so this needs an explicit transaction — it used to
    // be a single bare db.execute() with nothing to coordinate.
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      let budgetId: string;
      let branchId: string;
      let periodCode: string;
      let unitRate: number;

      if (isNewLine) {
        if (!input.budgetId) {
          throw refuse(400, "TOPUP_BUDGET_ID_REQUIRED", "A budget is required to raise a new budget-line request");
        }
        if (!input.head?.trim() || !input.subHead?.trim() || !input.unit?.trim() || !(Number(input.unitRate) > 0)) {
          throw refuse(
            400,
            "TOPUP_NEW_LINE_FIELDS_REQUIRED",
            "Head, sub-head, unit and a positive unit rate are required to request a brand-new budget line"
          );
        }
        const [headerRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id, status, branch_id, period_code FROM finance_budget_header WHERE id = ?`,
          [input.budgetId]
        );
        const header = headerRows[0];
        if (!header) throw refuse(404, "BUDGET_NOT_FOUND", "Budget not found");
        if (String(header.status) !== "active") {
          throw refuse(
            409,
            "BUDGET_NOT_ACTIVE",
            `A new-line top-up can only be requested against an active budget (this budget is '${header.status}')`
          );
        }
        budgetId = String(header.id);
        branchId = String(header.branch_id);
        periodCode = String(header.period_code);
        unitRate = Number(input.unitRate);
      } else {
        if (!input.budgetLineId) {
          throw refuse(400, "TOPUP_LINE_ID_REQUIRED", "A budget line is required");
        }
        const [lineRows] = await connection.execute<RowDataPacket[]>(
          `SELECT l.id, l.budget_id, l.unit_rate, h.status AS budget_status, h.branch_id, h.period_code
             FROM finance_budget_line l
             JOIN finance_budget_header h ON h.id = l.budget_id
            WHERE l.id = ?`,
          [input.budgetLineId]
        );
        const line = lineRows[0];
        if (!line) throw refuse(404, "BUDGET_LINE_NOT_FOUND", "Budget line not found");
        if (String(line.budget_status) !== "active") {
          throw refuse(
            409,
            "BUDGET_NOT_ACTIVE",
            `A top-up can only be requested against an active budget line (this budget is '${line.budget_status}')`
          );
        }

        /*
         * The approver reads `requested_amount`; applyTopupToLine applies `requested_quantity`.
         * Nothing tied the two together, and both are client-supplied — BudgetTopupPanel derives
         * quantity as amount / unit_rate, but the API accepted any pair. So a request could be
         * approved for Rs 15,000 and raise the line by something else entirely, with the queue,
         * the approval and the audit trail all showing the number that was NOT applied.
         *
         * requestedQuantity === 0 was the same defect at its limit: it passed validation, reached
         * 'applied', and increased the budget by nothing while reading as a granted increase.
         */
        unitRate = Number(line.unit_rate);
        if (!(unitRate > 0)) {
          throw refuse(
            409,
            "TOPUP_LINE_HAS_NO_UNIT_RATE",
            "This budget line has no unit rate, so an increase cannot be sized in units"
          );
        }
        budgetId = String(line.budget_id);
        branchId = String(line.branch_id);
        periodCode = String(line.period_code);
      }

      if (!(requestedQuantity > 0)) {
        throw refuse(
          400,
          "TOPUP_QUANTITY_INVALID",
          "Requested quantity must be greater than zero — a top-up of zero units raises no headroom"
        );
      }
      // Cross-checked here rather than recomputed from the amount, so a mismatch is refused and
      // visible instead of being silently corrected to a figure the requester never asked for.
      // The tolerance absorbs the client's float division, nothing more — requested_quantity is
      // DECIMAL(18,4) and roundQuantity() matches it, so on a line whose unit_rate is large that
      // last 0.0001 of a unit is worth far more than a rupee.
      const tolerance = Math.max(1, unitRate * 0.0001);
      const impliedAmount = roundMoney(requestedQuantity * unitRate);
      if (Math.abs(impliedAmount - requestedAmount) > tolerance) {
        throw refuse(
          400,
          "TOPUP_AMOUNT_QUANTITY_MISMATCH",
          `Requested amount and quantity disagree: ${requestedQuantity} x ${unitRate} = ${impliedAmount}, `
            + `but ${requestedAmount} was requested. The approved amount must be the amount applied.`
        );
      }

      // Group D: the split is the actual point of this request going forward — every top-up
      // must now name where the money lands, both in aggregate and per split.
      const normalizedSplits = validateCostCentreSplits(input.costCentreSplits, requestedAmount, requestedQuantity, unitRate);
      await assertCostCentresBelongToBranch(connection, branchId, normalizedSplits.map((s) => s.costCentreId));

      // The lock is re-checked inside review()'s transaction before anything is applied, but
      // refusing here too means a closed month is refused by the person who can still do
      // something about it, rather than after a Branch Head has already spent their approval.
      if (await isPeriodLocked(periodCode, connection)) {
        throw refuse(
          409,
          "FINANCE_PERIOD_LOCKED",
          `${periodCode} is locked for P&L close, so its budget cannot be topped up.`
        );
      }

      const id = randomUUID();
      if (isNewLine) {
        await connection.execute(
          `INSERT INTO finance_budget_topup_request
             (id, budget_line_id, budget_id, requested_by, requested_amount, requested_quantity, reason,
              status, is_new_line, head, sub_head, unit, unit_rate)
           VALUES (?, NULL, ?, ?, ?, ?, ?, 'submitted', 1, ?, ?, ?, ?)`,
          [
            id, budgetId, actorId, requestedAmount, requestedQuantity, input.reason.trim(),
            input.head!.trim(), input.subHead!.trim(), input.unit!.trim(), unitRate,
          ]
        );
      } else {
        await connection.execute(
          `INSERT INTO finance_budget_topup_request
             (id, budget_line_id, budget_id, requested_by, requested_amount, requested_quantity, reason, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted')`,
          [id, input.budgetLineId, budgetId, actorId, requestedAmount, requestedQuantity, input.reason.trim()]
        );
      }

      for (const split of normalizedSplits) {
        await connection.execute(
          `INSERT INTO finance_budget_topup_request_split
             (id, topup_request_id, cost_centre_id, amount, quantity)
           VALUES (?, ?, ?, ?, ?)`,
          [randomUUID(), id, split.costCentreId, split.amount, split.quantity]
        );
      }

      // 1089's own comment names budget_topup as an entity_type of finance_approval_event, and
      // nothing had ever written one: every top-up decision in production was unaudited.
      await recordFinanceApprovalEvent(
        {
          entityType: "budget_topup",
          entityId: id,
          action: "submit",
          fromStatus: null,
          toStatus: "submitted",
          actorUserId: actorId,
          actorRole: _actorRole || "unknown",
          remarks: input.reason.trim(),
          details: {
            budgetLineId: isNewLine ? null : input.budgetLineId,
            isNewLine,
            periodCode,
            requestedAmount,
            requestedQuantity,
            unitRate,
            costCentreSplits: normalizedSplits,
          },
        },
        connection
      );

      await connection.commit();
      return this.get(id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async get(id: string) {
    // Group D: LEFT JOIN, not JOIN — an is_new_line=1 request has budget_line_id IS NULL until
    // it is applied (applyTopupAsNewLine creates a SEPARATE line row, it never backfills this
    // request's own budget_line_id), so an INNER join here would make every new-line request
    // invisible to its own creator, including the create() call that just inserted it.
    // COALESCE falls back to the request's own head/sub_head/unit/unit_rate columns (Group D)
    // only for a new-line row where l.* is NULL — an existing-line row's l.* always wins, exactly
    // as before this change.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.*,
              COALESCE(l.head, t.head) AS head,
              COALESCE(l.sub_head, t.sub_head) AS sub_head,
              l.item_name,
              COALESCE(l.unit, t.unit) AS unit,
              COALESCE(l.unit_rate, t.unit_rate) AS unit_rate,
              l.gross_amount AS line_gross_amount, l.quantity AS line_quantity,
              h.budget_number, h.branch_id, h.period_code, bm.branch_name
         FROM finance_budget_topup_request t
         LEFT JOIN finance_budget_line l ON l.id = t.budget_line_id
         JOIN finance_budget_header h ON h.id = t.budget_id
         LEFT JOIN branch_master bm ON bm.id = h.branch_id
        WHERE t.id = ?`,
      [id]
    );
    if (!rows[0]) throw refuse(404, "TOPUP_NOT_FOUND", "Top-up request not found");
    return rows[0];
  },

  async list(filters: {
    branchId?: string;
    /** Multi-branch scope; wins over branchId. Both exist so routers migrate one at a time. */
    branchScope?: FinanceBranchScope;
    status?: string;
    head?: string;
    subHead?: string;
    requestedBy?: string;
    period?: string;
    raisedFrom?: string;
    raisedTo?: string;
    /** Narrow to rows awaiting a given stage. Derived from status, never stored. */
    pendingWithRole?: string;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchScope) {
      const filter = financeBranchFilter(filters.branchScope, "h.branch_id");
      if (filter.sql !== "1=1") {
        conditions.push(filter.sql);
        params.push(...filter.params);
      }
    } else if (filters.branchId) {
      conditions.push("h.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.status) {
      conditions.push("t.status = ?");
      params.push(filters.status);
    }
    if (filters.head) {
      conditions.push("l.head = ?");
      params.push(filters.head);
    }
    if (filters.subHead) {
      conditions.push("l.sub_head = ?");
      params.push(filters.subHead);
    }
    if (filters.requestedBy) {
      conditions.push("t.requested_by = ?");
      params.push(filters.requestedBy);
    }
    if (filters.period) {
      conditions.push("h.period_code = ?");
      params.push(filters.period);
    }
    if (filters.raisedFrom) {
      conditions.push("t.created_at >= ?");
      params.push(`${filters.raisedFrom} 00:00:00`);
    }
    if (filters.raisedTo) {
      conditions.push("t.created_at <= ?");
      params.push(`${filters.raisedTo} 23:59:59`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    // LIMIT/OFFSET are not used here (no pagination yet, matches an already-fixed footgun in
    // grn.service.ts listGrns — mysql2 3.22.3 rejects them as execute() bind params).
    const [rows] = await db.query<RowDataPacket[]>(
      // period_code is selected here for the same reason get() selects it: a top-up is an
      // increase to ONE month's budget, and the request carries no period of its own — it is
      // only ever the parent header's. Without this column the queue could not name the month
      // it was asking a reviewer to approve, and BudgetTopupPanel showed head/amount/reason
      // with no period anywhere on the row.
      // Group D: LEFT JOIN so an is_new_line=1 request (budget_line_id IS NULL) still appears in
      // the queue instead of silently vanishing from list() the way an INNER join would drop it.
      // Filtering by filters.head/filters.subHead below still matches on l.head/l.sub_head only
      // — a known, deliberately unaddressed gap: it will not surface a new-line request by its
      // own t.head/t.sub_head. Flagged in the Group D report; does not affect create()/review().
      `SELECT t.*,
              COALESCE(l.head, t.head) AS head,
              COALESCE(l.sub_head, t.sub_head) AS sub_head,
              l.item_name,
              COALESCE(l.unit_rate, t.unit_rate) AS unit_rate,
              h.budget_number, h.branch_id, h.period_code, bm.branch_name,
              NULLIF(TRIM(CONCAT_WS(' ', rq.first_name, rq.last_name)), '') AS requested_by_name
         FROM finance_budget_topup_request t
         LEFT JOIN finance_budget_line l ON l.id = t.budget_line_id
         JOIN finance_budget_header h ON h.id = t.budget_id
         LEFT JOIN branch_master bm ON bm.id = h.branch_id
         LEFT JOIN employees rq ON rq.user_id = t.requested_by
         ${where}
        ORDER BY t.created_at DESC
        LIMIT 200`,
      params
    );

    const decorated = (rows as RowDataPacket[]).map((row) => decorateTopup(row));
    const visible = filters.pendingWithRole
      ? decorated.filter((r) => r.pending_with_role === filters.pendingWithRole)
      : decorated;

    // Counts come from the same scoped, filtered set the rows do — a tab badge that counted
    // more widely than the list beneath it would advertise other branches' requests.
    const counts = {
      all: decorated.length,
      pending_branch_head: decorated.filter((r) => r.pending_with_role === "branch_head").length,
      pending_finance_head: decorated.filter((r) => r.pending_with_role === "finance_head").length,
      applied: decorated.filter((r) => String(r.status) === "applied").length,
      rejected: decorated.filter((r) => String(r.status) === "rejected").length,
    };

    return { rows: visible, counts };
  },

  /** Two-stage chain, identical shape to GRN review: branch_head at 'submitted',
   *  finance_head at 'branch_head_approved'. Approval at finance_head atomically applies
   *  the increase to the budget line under the same row lock GRN consumption already uses. */
  async review(id: string, decision: "approve" | "reject", actorId: string, effectiveRole: string, remarks?: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      // P0-3: Join the header to get period_code so the lock check runs inside this transaction.
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT t.*, h.period_code
           FROM finance_budget_topup_request t
           JOIN finance_budget_header h ON h.id = t.budget_id
          WHERE t.id = ?
          FOR UPDATE`,
        [id]
      );
      const request = rows[0];
      if (!request) throw refuse(404, "TOPUP_NOT_FOUND", "Top-up request not found");
      const status = String(request.status);

      // P0P1-4: Maker-checker — the approver cannot be the person who raised the request,
      // regardless of role.  Applies to both approve and reject so a requester cannot
      // "reject" their own request to unblock a later re-submission either.
      if (String(request.requested_by) === actorId) {
        throw refuse(
          409,
          "TOPUP_MAKER_CHECKER",
          "You submitted this top-up request, so you cannot review it. A different reviewer must approve or reject it."
        );
      }

      if (decision === "reject") {
        if (!["submitted", "branch_head_approved"].includes(status)) {
          throw refuse(409, "TOPUP_WRONG_STAGE", `Cannot reject a top-up request in status ${status}`);
        }
        if (!remarks?.trim()) {
          throw refuse(400, "TOPUP_REJECT_REASON_REQUIRED", "A reason is required to reject a top-up request");
        }
        const reviewedColumn = effectiveRole === "branch_head" ? "branch_head" : "finance_head";
        await connection.execute(
          `UPDATE finance_budget_topup_request
              SET status = 'rejected', rejection_reason = ?,
                  ${reviewedColumn}_reviewed_by = ?, ${reviewedColumn}_reviewed_at = NOW(),
                  ${reviewedColumn}_review_note = ?
            WHERE id = ?`,
          [remarks.trim(), actorId, remarks.trim(), id]
        );
        // Same connection as the UPDATE, so the event and the transition commit or roll back
        // together — a history row for an approval that rolled back is worse than none.
        await recordFinanceApprovalEvent(
          {
            entityType: "budget_topup",
            entityId: id,
            action: "reject",
            fromStatus: status,
            toStatus: "rejected",
            decision: "reject",
            actorUserId: actorId,
            actorRole: effectiveRole,
            remarks: remarks.trim(),
            details: {
              periodCode: String(request.period_code ?? ""),
              budgetLineId: String(request.budget_line_id),
              requestedAmount: Number(request.requested_amount),
            },
          },
          connection
        );
        await connection.commit();
        return this.get(id);
      }

      if (effectiveRole === "branch_head") {
        if (status !== "submitted") {
          throw refuse(
            409,
            "TOPUP_WRONG_STAGE",
            `Top-up request is not awaiting branch_head review (status: ${status})`
          );
        }
        await connection.execute(
          `UPDATE finance_budget_topup_request
              SET status = 'branch_head_approved',
                  branch_head_reviewed_by = ?, branch_head_reviewed_at = NOW(), branch_head_review_note = ?
            WHERE id = ?`,
          [actorId, remarks?.trim() || null, id]
        );
        await recordFinanceApprovalEvent(
          {
            entityType: "budget_topup",
            entityId: id,
            action: "approve",
            fromStatus: status,
            toStatus: "branch_head_approved",
            decision: "approve",
            actorUserId: actorId,
            actorRole: effectiveRole,
            remarks: remarks?.trim() || null,
            details: {
              periodCode: String(request.period_code ?? ""),
              budgetLineId: String(request.budget_line_id),
              requestedAmount: Number(request.requested_amount),
            },
          },
          connection
        );
        await connection.commit();
        return this.get(id);
      }

      if (effectiveRole === "finance_head") {
        if (status !== "branch_head_approved") {
          throw refuse(
            409,
            "TOPUP_WRONG_STAGE",
            `Top-up request is not awaiting finance_head review (status: ${status})`
          );
        }
        // P0-3: Re-check period lock inside the transaction before mutating the budget line.
        if (await isPeriodLocked(String(request.period_code), connection)) {
          throw refuse(
            409,
            "FINANCE_PERIOD_LOCKED",
            `${request.period_code} is locked for P&L close. This top-up cannot be applied.`
          );
        }

        // Group D: fetched before branching so both paths below (new-line vs existing-line) see
        // the same split set the requester raised.
        const [splitRows] = await connection.execute<RowDataPacket[]>(
          `SELECT cost_centre_id, quantity FROM finance_budget_topup_request_split WHERE topup_request_id = ?`,
          [id]
        );
        const splits: TopupSplit[] = splitRows.map((row) => ({
          costCentreId: String(row.cost_centre_id),
          quantity: Number(row.quantity),
        }));

        if (Number(request.is_new_line) === 1) {
          // No existing line to lock — applyTopupAsNewLine() creates the line fresh instead.
          await applyTopupAsNewLine(connection, request, splits, actorId);
        } else {
          // Same lock GRN reserve()/consume() already use — a top-up and a GRN cannot race
          // against the same line's headroom.
          await lockActiveBudgetLine(connection, String(request.budget_line_id));
          await applyTopupToLine(connection, String(request.budget_line_id), Number(request.requested_quantity), splits, actorId);
        }
        await connection.execute(
          `UPDATE finance_budget_topup_request
              SET status = 'applied', applied_at = NOW(),
                  finance_head_reviewed_by = ?, finance_head_reviewed_at = NOW(), finance_head_review_note = ?
            WHERE id = ?`,
          [actorId, remarks?.trim() || null, id]
        );
        // The one event that records money actually moving: this stage recomputes the budget
        // line and re-sums the header. The quantity is recorded alongside the amount because
        // the quantity is what applyTopupToLine used.
        await recordFinanceApprovalEvent(
          {
            entityType: "budget_topup",
            entityId: id,
            action: "approve",
            fromStatus: status,
            toStatus: "applied",
            decision: "approve",
            actorUserId: actorId,
            actorRole: effectiveRole,
            remarks: remarks?.trim() || null,
            details: {
              periodCode: String(request.period_code ?? ""),
              budgetLineId: String(request.budget_line_id),
              requestedAmount: Number(request.requested_amount),
              appliedQuantity: Number(request.requested_quantity),
            },
          },
          connection
        );
        await connection.commit();
        return this.get(id);
      }

      // Reached when resolveFinanceStageRole returned a role that owns no stage of this
      // workflow — an authorisation outcome, so 403 rather than a 409 state conflict.
      throw refuse(
        403,
        "TOPUP_NO_REVIEW_ROLE",
        `Your role (${effectiveRole || "none"}) cannot review a top-up request in status ${status}`
      );
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /**
   * Finance Head (and Super Admin) may increase an active budget line directly, bypassing the
   * 2-stage branch_head -> finance_head request/review chain above (owner decision, 2026-08-21).
   * Route-level requireRole("finance_head","super_admin") is the actual authority boundary; this
   * function does not re-check the actor's role, only that the line/period are in a state that
   * can legally be increased — same discipline create()/review() already follow.
   *
   * Reuses applyTopupToLine() (the money-math every top-up already goes through) under the same
   * row lock GRN consumption uses, inside one transaction. Rather than a bespoke "direct" code
   * path, this INSERTs a finance_budget_topup_request row that is ALREADY at status='applied'
   * (both review columns pre-filled to the acting Finance Head, is_direct=1) — so a direct
   * increase shows up for free in the existing top-up history/queue UI, list()/get(), and the
   * finance_budget_approval_log / finance_approval_event audit trail, with no new UI needed for
   * history and no risk of a second, disagreeing ledger of "who increased what, when."
   *
   * Group D: accepts costCentreSplits (same shape/validation as create()'s) and threads them
   * through to applyTopupToLine(). Deliberately does NOT accept isNewLine — see the Group D
   * report for the scope reasoning. Any isNewLine flag in the request body is simply not read
   * here (the input type below has no such field), so it is silently ignored rather than
   * explicitly refused; flagged as a deliberate decision, not an oversight.
   */
  async directApply(
    input: {
      budgetLineId: string;
      additionalQuantity: number;
      reason: string;
      costCentreSplits: Array<{ costCentreId: string; amount: number; quantity: number }>;
    },
    actorId: string,
    actorRole: string
  ) {
    const additionalQuantity = roundQuantity(input.additionalQuantity);
    if (!Number.isFinite(additionalQuantity) || additionalQuantity <= 0) {
      throw refuse(400, "TOPUP_QUANTITY_INVALID", "Additional quantity must be greater than zero");
    }
    if (!input.reason?.trim()) {
      throw refuse(400, "TOPUP_REASON_REQUIRED", "A reason is required for a direct budget increase");
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [lineRows] = await connection.execute<RowDataPacket[]>(
        `SELECT l.id, l.budget_id, l.unit_rate, h.status AS budget_status, h.branch_id, h.period_code
           FROM finance_budget_line l
           JOIN finance_budget_header h ON h.id = l.budget_id
          WHERE l.id = ?
          FOR UPDATE`,
        [input.budgetLineId]
      );
      const line = lineRows[0];
      if (!line) throw refuse(404, "BUDGET_LINE_NOT_FOUND", "Budget line not found");
      if (String(line.budget_status) !== "active") {
        throw refuse(
          409,
          "BUDGET_NOT_ACTIVE",
          `A direct increase can only be applied to an active budget line (this budget is '${line.budget_status}')`
        );
      }
      const unitRate = Number(line.unit_rate);
      if (!(unitRate > 0)) {
        throw refuse(
          409,
          "TOPUP_LINE_HAS_NO_UNIT_RATE",
          "This budget line has no unit rate, so an increase cannot be sized in units"
        );
      }

      const requestedAmount = roundMoney(additionalQuantity * unitRate);
      const normalizedSplits = validateCostCentreSplits(input.costCentreSplits, requestedAmount, additionalQuantity, unitRate);
      await assertCostCentresBelongToBranch(connection, String(line.branch_id), normalizedSplits.map((s) => s.costCentreId));

      if (await isPeriodLocked(String(line.period_code), connection)) {
        throw refuse(
          409,
          "FINANCE_PERIOD_LOCKED",
          `${line.period_code} is locked for P&L close, so its budget cannot be increased.`
        );
      }

      // Same row lock GRN reserve()/consume() and the review() finance_head branch above use —
      // a direct increase and a GRN (or another top-up) cannot race against the same line.
      await lockActiveBudgetLine(connection, String(line.id));
      await applyTopupToLine(connection, String(line.id), additionalQuantity, normalizedSplits, actorId);

      const requestId = randomUUID();
      await connection.execute(
        `INSERT INTO finance_budget_topup_request
           (id, budget_line_id, budget_id, requested_by, requested_amount, requested_quantity,
            reason, is_direct, status,
            branch_head_reviewed_by, branch_head_reviewed_at, branch_head_review_note,
            finance_head_reviewed_by, finance_head_reviewed_at, finance_head_review_note,
            applied_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'applied', ?, NOW(), ?, ?, NOW(), ?, NOW())`,
        [
          requestId, line.id, line.budget_id, actorId, requestedAmount, additionalQuantity,
          input.reason.trim(),
          actorId, "Direct increase — Finance Head",
          actorId, "Direct increase — Finance Head",
        ]
      );

      for (const split of normalizedSplits) {
        await connection.execute(
          `INSERT INTO finance_budget_topup_request_split
             (id, topup_request_id, cost_centre_id, amount, quantity)
           VALUES (?, ?, ?, ?, ?)`,
          [randomUUID(), requestId, split.costCentreId, split.amount, split.quantity]
        );
      }

      await auditInTransaction(
        connection,
        String(line.budget_id),
        "DIRECT_TOPUP",
        "active",
        "active",
        actorId,
        actorRole,
        `${input.reason.trim()} — line ${line.id}, +${additionalQuantity} units (+${money2(requestedAmount)})`
      );
      await recordFinanceApprovalEvent(
        {
          entityType: "budget_topup",
          entityId: requestId,
          action: "direct_apply",
          fromStatus: null,
          toStatus: "applied",
          decision: "approve",
          actorUserId: actorId,
          actorRole,
          remarks: input.reason.trim(),
          details: {
            budgetLineId: String(line.id),
            periodCode: String(line.period_code),
            requestedAmount,
            appliedQuantity: additionalQuantity,
            isDirect: true,
            costCentreSplits: normalizedSplits,
          },
        },
        connection
      );

      await connection.commit();
      return this.get(requestId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};

/** Local formatter for the audit-log remark only — this file has no reason to import the
 *  frontend's Intl.NumberFormat currency helper for one log line. */
function money2(value: number) {
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}


/**
 * Adds the derived pendency fields Requirement 1 asks for.
 *
 * All of it is computed, not stored. Pending-with is a pure function of status, and ageing is
 * a function of when the current stage began — a stored copy of either would be a second
 * source of truth free to drift from the status it describes.
 *
 * Ageing counts time in the CURRENT stage, not since the request was raised. Measuring from
 * creation buries a fast Finance turnaround inside a slow Branch Head one, which is the
 * opposite of what a pendency report is for.
 */
type DecoratedTopup = RowDataPacket & {
  pending_with_role: string | null;
  pending_with: string;
  is_pending: boolean;
  ageing_days: number | null;
  age_bucket: string | null;
};

function decorateTopup(row: RowDataPacket): DecoratedTopup {
  const status = String(row.status ?? "");
  const pending = resolvePendingWith(status, "topup");

  const stageStartedAt =
    row.branch_head_reviewed_at ?? row.created_at ?? null;
  const lastActionAt =
    row.applied_at ?? row.finance_head_reviewed_at ?? row.branch_head_reviewed_at ?? null;
  const lastActionBy =
    row.finance_head_reviewed_by ?? row.branch_head_reviewed_by ?? null;

  const ageDays = pending.isPending && stageStartedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(String(stageStartedAt)).getTime()) / 86_400_000))
    : null;

  return {
    ...row,
    pending_with_role: pending.role,
    pending_with: pending.label,
    is_pending: pending.isPending,
    pending_since: pending.isPending ? stageStartedAt : null,
    ageing_days: ageDays,
    age_bucket: ageDays === null ? null : ageDays <= 2 ? "0-2" : ageDays <= 7 ? "3-7" : "7+",
    last_action_by: lastActionBy,
    last_action_at: lastActionAt,
    approval_remarks:
      row.finance_head_review_note ?? row.branch_head_review_note ?? row.rejection_reason ?? null,
  } as DecoratedTopup;
}
