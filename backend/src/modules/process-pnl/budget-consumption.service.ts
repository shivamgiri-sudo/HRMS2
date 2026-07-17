import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 10_000) / 10_000;
}

async function lockActiveBudgetLine(connection: PoolConnection, lineId: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT l.*, h.status AS budget_status, h.branch_id, h.period_code
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE l.id = ?
      FOR UPDATE`,
    [lineId]
  );

  const line = rows[0];
  if (!line) throw new Error("Approved budget line not found");
  if (String(line.budget_status) !== "active") {
    throw new Error("GRN can only use a fully approved active budget");
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

function validatePositive(amount: number, quantity: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("GRN gross amount must be greater than zero");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("GRN quantity must be greater than zero");
  }
}

export const budgetConsumptionService = {
  async reserve(
    connection: PoolConnection,
    lineId: string,
    amountInput: number,
    quantityInput: number
  ) {
    const amount = roundMoney(amountInput);
    const quantity = roundQuantity(quantityInput);
    validatePositive(amount, quantity);

    const line = await lockActiveBudgetLine(connection, lineId);
    const available = availability(line);
    if (amount > available.amount + 0.01) {
      throw new Error(
        `GRN exceeds available budget amount by ${(amount - available.amount).toFixed(2)}`
      );
    }
    if (quantity > available.quantity + 0.0001) {
      throw new Error(
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
    quantityInput: number
  ) {
    const amount = roundMoney(amountInput);
    const quantity = roundQuantity(quantityInput);
    validatePositive(amount, quantity);

    const line = await lockActiveBudgetLine(connection, lineId);
    const reservedAmount = Number(line.reserved_amount ?? 0);
    const reservedQuantity = Number(line.reserved_quantity ?? 0);
    if (reservedAmount + 0.01 < amount) {
      throw new Error("Reserved budget amount is lower than the GRN amount");
    }
    if (reservedQuantity + 0.0001 < quantity) {
      throw new Error("Reserved budget quantity is lower than the GRN quantity");
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
    quantityInput: number
  ) {
    const amount = roundMoney(amountInput);
    const quantity = roundQuantity(quantityInput);
    validatePositive(amount, quantity);

    const line = await lockActiveBudgetLine(connection, lineId);
    if (Number(line.reserved_amount ?? 0) + 0.01 < amount) {
      throw new Error("Cannot release more budget amount than is reserved");
    }
    if (Number(line.reserved_quantity ?? 0) + 0.0001 < quantity) {
      throw new Error("Cannot release more budget quantity than is reserved");
    }

    await connection.execute(
      `UPDATE finance_budget_line
          SET reserved_amount = GREATEST(0, reserved_amount - ?),
              reserved_quantity = GREATEST(0, reserved_quantity - ?)
        WHERE id = ?`,
      [amount, quantity, lineId]
    );
  },
};
