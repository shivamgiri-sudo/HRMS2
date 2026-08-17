import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

import { refuse } from "./finance-error.js";
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
    amount: roundMoney(
      Number(line.gross_amount ?? 0)
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

/** Budget lines whose planned amount carries no tax, so tax must not be consumed against them. */
const NON_TAXABLE_TREATMENTS = new Set(["non_gst", "exempt"]);

/**
 * Which invoice figure to charge against this budget line.
 *
 * GRN books the GST-inclusive amount, which is right for a tax-bearing budget line because its
 * gross_amount includes the same tax. A non-taxable line's gross_amount is net of tax, so charging
 * it the inclusive figure compares unlike things: a Rs 1,00,000 purchase carrying Rs 18,000 GST
 * consumed Rs 1,18,000 against a Rs 1,02,000 line and reserve() then REFUSED it — legitimate
 * purchases were hard-blocked at Branch Head approval, not merely shown as overspent.
 *
 * Falls back to the gross figure when no net is supplied, so a caller that has not been updated
 * keeps its previous behaviour rather than silently consuming zero.
 */
function consumptionBasis(line: RowDataPacket, grossAmount: number, netAmount?: number): number {
  if (!NON_TAXABLE_TREATMENTS.has(String(line.tax_treatment ?? ""))) return grossAmount;
  return Number.isFinite(netAmount) && (netAmount as number) > 0 ? roundMoney(netAmount as number) : grossAmount;
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
    const amount = consumptionBasis(line, roundMoney(amountInput), netAmountInput);
    validatePositive(amount, quantity);
    const available = availability(line);
    if (amount > available.amount + 0.01) {
      throw refuse(409, "GRN_EXCEEDS_BUDGET_AMOUNT",
        `GRN exceeds available budget amount by ${(amount - available.amount).toFixed(2)}`
      );
    }
    if (quantity > available.quantity + 0.0001) {
      throw refuse(409, "GRN_EXCEEDS_BUDGET_QUANTITY",
        `GRN exceeds available budget quantity by ${roundQuantity(quantity - available.quantity)}`
      );
    }

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
    const reservedQuantity = Number(line.reserved_quantity ?? 0);
    if (reservedAmount + 0.01 < amount) {
      throw refuse(409, "RESERVATION_INSUFFICIENT", "Reserved budget amount is lower than the GRN amount");
    }
    if (reservedQuantity + 0.0001 < quantity) {
      throw refuse(409, "RESERVATION_INSUFFICIENT", "Reserved budget quantity is lower than the GRN quantity");
    }

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
    if (Number(line.reserved_quantity ?? 0) + 0.0001 < quantity) {
      throw refuse(409, "RELEASE_EXCEEDS_RESERVED", "Cannot release more budget quantity than is reserved");
    }

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
    if (Number(line.consumed_quantity ?? 0) + 0.0001 < quantity) {
      throw refuse(409, "REVERSAL_EXCEEDS_CONSUMED", "Cannot reverse more budget quantity than is consumed");
    }

    await connection.execute(
      `UPDATE finance_budget_line
          SET consumed_amount = GREATEST(0, consumed_amount - ?),
              consumed_quantity = GREATEST(0, consumed_quantity - ?)
        WHERE id = ?`,
      [amount, quantity, lineId]
    );
  },
};
