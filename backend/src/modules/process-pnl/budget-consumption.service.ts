import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

import { refuse } from "./finance-error.js";
import { budgetClosureService } from "./budget-closure.service.js";
import { budgetCostRatio } from "./budget-tax-basis.js";

/*
 * QUANTITY IS NOT A SPENDING CONTROL — MONEY IS. (2026-08-27, owner decision)
 *
 * A budget line carries two ledgers: money (gross/reserved/consumed_amount) and quantity
 * (quantity/reserved/consumed_quantity). Only the money one is trustworthy.
 *
 * Lines are planned in whole units — "1 Month @ Rs 1,19,000", "1 Connection @ Rs 1,20,000" — and
 * every GRN books ONE unit against them regardless of its value: 1,506 of the 1,553 allocations
 * on live budgets carry quantity = 1.0000. So the second invoice of the month exhausts a 1-unit
 * line while most of the money is still unspent, and 74% of invoices come in UNDER the approved
 * unit rate, which strands money on the line every time a unit is burned. On top of that the
 * quantity ledger has drifted independently of its own allocations on 362 of 701 active lines
 * (the money ledger: 23), including lines showing consumed_quantity > 0 with no allocation rows
 * at all.
 *
 * Consequence before this change: availableLines() hid any line with no quantity left, so the
 * raiser was told the head/sub-head had no budget and to request a top-up — for money that was
 * approved and sitting there. Rs 8,16,707 across 24 lines and 3 branches was unreachable in
 * 2026-08 alone, a quarter of every line that still had money on it.
 *
 * Quantity is still WRITTEN and still displayed, so the planning figure keeps updating and stays
 * available for reporting. It simply never refuses a GRN any more. The money checks beside each
 * removed quantity check are untouched and remain the hard limit on spend.
 */
function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 10_000) / 10_000;
}

export async function lockActiveBudgetLine(connection: PoolConnection, lineId: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT l.*, h.status AS budget_status, h.branch_id, h.period_code
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE l.id = ?
      FOR UPDATE`,
    [lineId]
  );

  const line = rows[0];
  if (!line) throw refuse(404, "BUDGET_LINE_NOT_FOUND", "Approved budget line not found");
  if (String(line.budget_status) !== "active") {
    throw refuse(409, "BUDGET_NOT_ACTIVE", "GRN can only use a fully approved active budget");
  }
  return line;
}

function availability(line: RowDataPacket) {
  return {
    // P&L budget ceiling: pnl_cost_amount = base for ITC lines, gross for non-ITC/imprest.
    // reserved_amount / consumed_amount accumulate the P&L cost (consumptionBasis returns net
    // for ITC invoices). Comparing like-for-like here; gross_amount was a mixed-unit ceiling
    // that silently allowed ~(1/costRatio - 1) over-spend on ITC budget lines.
    amount: roundMoney(
      Number(line.pnl_cost_amount ?? 0)
      - Number(line.reserved_amount ?? 0)
      - Number(line.consumed_amount ?? 0)
    ),
    quantity: roundQuantity(
      Number(line.quantity ?? 0)
      - Number(line.reserved_quantity ?? 0)
      - Number(line.consumed_quantity ?? 0)
    ),
  };
}

/**
 * Which invoice figure to charge against this budget line.
 *
 * For ITC-eligible lines (ratio < 1): charge the invoice's taxable base (netAmount). The budget
 * ceiling is pnl_cost_amount — what Finance approved as P&L spend — and only the base hits P&L.
 * GST is recovered as ITC and never charged to the budget.
 *
 * For non-ITC / exempt / imprest lines (ratio = 1, gross = net): charge the full gross.
 * pnl_cost_amount = gross_amount for these lines, so it makes no difference.
 *
 * Falls back to gross when no net is supplied (conservative: charges the inclusive figure
 * rather than silently consuming zero if the caller did not supply a net).
 */
function consumptionBasis(line: RowDataPacket, grossAmount: number, netAmount?: number): number {
  const ratio = budgetCostRatio(line.tax_treatment, grossAmount, netAmount);
  return ratio >= 1 ? grossAmount : roundMoney(netAmount as number);
}

function validatePositive(amount: number, quantity: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw refuse(400, "GRN_AMOUNT_INVALID", "GRN gross amount must be greater than zero");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw refuse(400, "GRN_QUANTITY_INVALID", "GRN quantity must be greater than zero");
  }
}

export const budgetConsumptionService = {
  async reserve(
    connection: PoolConnection,
    lineId: string,
    amountInput: number,
    quantityInput: number,
    /** The invoice's taxable value. Used instead of amountInput when the budget line is
     *  non-taxable, so like is compared with like. */
    netAmountInput?: number
  ) {
    const quantity = roundQuantity(quantityInput);
    const line = await lockActiveBudgetLine(connection, lineId);
    // A closed head/sub-head refuses NEW spend only — reserve() is the entry point for a fresh
    // GRN. release()/consume()/reverseConsumption() below correct or complete a GRN reserved
    // before closure and must keep working regardless of the head's current closure state.
    await budgetClosureService.assertSubheadOpen(
      connection, String(line.budget_id), String(line.head), line.sub_head ? String(line.sub_head) : null
    );
    const amount = consumptionBasis(line, roundMoney(amountInput), netAmountInput);
    validatePositive(amount, quantity);
    const available = availability(line);
    if (amount > available.amount + 0.01) {
      throw refuse(409, "GRN_EXCEEDS_BUDGET_AMOUNT",
        `GRN exceeds available budget amount by ${(amount - available.amount).toFixed(2)}`
      );
    }
    // Quantity deliberately does not refuse — see the banner at the top of this file.

    await connection.execute(
      `UPDATE finance_budget_line
          SET reserved_amount = reserved_amount + ?,
              reserved_quantity = reserved_quantity + ?
        WHERE id = ?`,
      [amount, quantity, lineId]
    );
  },

  async consume(
    connection: PoolConnection,
    lineId: string,
    amountInput: number,
    quantityInput: number,
    netAmountInput?: number
  ) {
    const quantity = roundQuantity(quantityInput);
    const line = await lockActiveBudgetLine(connection, lineId);
    const amount = consumptionBasis(line, roundMoney(amountInput), netAmountInput);
    validatePositive(amount, quantity);
    const reservedAmount = Number(line.reserved_amount ?? 0);
    if (reservedAmount + 0.01 < amount) {
      throw refuse(409, "RESERVATION_INSUFFICIENT", "Reserved budget amount is lower than the GRN amount");
    }
    // Quantity deliberately does not refuse — see the banner at the top of this file.

    await connection.execute(
      `UPDATE finance_budget_line
          SET reserved_amount = GREATEST(0, reserved_amount - ?),
              reserved_quantity = GREATEST(0, reserved_quantity - ?),
              consumed_amount = consumed_amount + ?,
              consumed_quantity = consumed_quantity + ?
        WHERE id = ?`,
      [amount, quantity, amount, quantity, lineId]
    );
  },

  async release(
    connection: PoolConnection,
    lineId: string,
    amountInput: number,
    quantityInput: number,
    /** MUST be supplied wherever reserve() was given one. release() credits back what reserve()
     *  charged, so if reserve() used the net figure on a non-taxable line and release() used the
     *  gross, the release would exceed the reservation and throw "Cannot release more budget
     *  amount than is reserved" — turning a return or a rejection into a hard failure. */
    netAmountInput?: number
  ) {
    const quantity = roundQuantity(quantityInput);
    const line = await lockActiveBudgetLine(connection, lineId);
    const amount = consumptionBasis(line, roundMoney(amountInput), netAmountInput);
    validatePositive(amount, quantity);
    if (Number(line.reserved_amount ?? 0) + 0.01 < amount) {
      throw refuse(409, "RELEASE_EXCEEDS_RESERVED", "Cannot release more budget amount than is reserved");
    }
    // Quantity deliberately does not refuse — see the banner at the top of this file.

    await connection.execute(
      `UPDATE finance_budget_line
          SET reserved_amount = GREATEST(0, reserved_amount - ?),
              reserved_quantity = GREATEST(0, reserved_quantity - ?)
        WHERE id = ?`,
      [amount, quantity, lineId]
    );
  },

  /** Symmetric to release(), but against consumed_* rather than reserved_* — for correcting
   *  a GRN that already cleared Finance Head approval (and so already moved from reserved
   *  into consumed via consume()). */
  async reverseConsumption(
    connection: PoolConnection,
    lineId: string,
    amountInput: number,
    quantityInput: number,
    /** Symmetric with consume(), for the same reason release() needs one. */
    netAmountInput?: number
  ) {
    const quantity = roundQuantity(quantityInput);
    const line = await lockActiveBudgetLine(connection, lineId);
    const amount = consumptionBasis(line, roundMoney(amountInput), netAmountInput);
    validatePositive(amount, quantity);
    if (Number(line.consumed_amount ?? 0) + 0.01 < amount) {
      throw refuse(409, "REVERSAL_EXCEEDS_CONSUMED", "Cannot reverse more budget amount than is consumed");
    }
    // Quantity deliberately does not refuse — see the banner at the top of this file.

    await connection.execute(
      `UPDATE finance_budget_line
          SET consumed_amount = GREATEST(0, consumed_amount - ?),
              consumed_quantity = GREATEST(0, consumed_quantity - ?)
        WHERE id = ?`,
      [amount, quantity, lineId]
    );
  },
};
