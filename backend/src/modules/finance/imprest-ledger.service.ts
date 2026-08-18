import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { isPeriodLocked } from "../process-pnl/finance-period-lock.js";
import { financeBranchFilter, type FinanceBranchScope } from "./finance-access-scope.js";

/**
 * The imprest float ledger (Requirement 7).
 *
 *   Opening + Allocations + Positive adjustments
 *          − Approved vouchers − Returns − Negative adjustments  =  Closing
 *
 * Append-only. There is no update path and no delete path in this file, and there must never
 * be one anywhere else either — a wrong entry is corrected with a contra entry, which is both
 * how accounting expects it and the only way the ledger can answer "why is the balance this".
 * A source-scan test asserts the absence, because MySQL TRIGGERs are unavailable here and so
 * the rule cannot be enforced by the database.
 *
 * Every posting takes a connection and is written inside the caller's transaction. A ledger
 * entry that survives a rolled-back approval claims money moved when it did not.
 */

export type ImprestEntryType =
  | "opening"
  | "allocation"
  | "voucher"
  | "return"
  | "adjustment"
  | "closure";

export type ImprestPosting = {
  imprestManagerId: string;
  branchId: string;
  entryType: ImprestEntryType;
  /** credit increases the float, debit reduces it. */
  direction: "credit" | "debit";
  /** Always positive. Direction carries the sign. */
  amount: number;
  transactionDate: string;
  /** When set, use this YYYY-MM for the period-lock check instead of transactionDate.
   *  Allows finance_head to book an allocation to an open period when the payment date
   *  falls in a locked one, mirroring grn_request.accounting_period. */
  overridePeriodCode?: string | null;
  referenceType?: "imprest_allocation" | "grn_request" | "manual" | null;
  referenceId?: string | null;
  narration?: string | null;
  actorUserId: string;
};

/** Money is compared in paise. Two decimal values that print the same must compare equal. */
const toPaise = (value: number) => Math.round(Number(value) * 100);
const fromPaise = (paise: number) => paise / 100;

export const imprestLedgerService = {
  /**
   * The float balance, derived from the entries rather than read from a column.
   *
   * SUM over direction rather than SUM(amount): a signed column would give the right answer
   * right up until someone stored a negative credit, and then net silently wrong.
   */
  async getBalance(imprestManagerId: string, asOfDate?: string): Promise<number> {
    const params: unknown[] = [imprestManagerId];
    let dateFilter = "";
    if (asOfDate) {
      dateFilter = " AND transaction_date <= ?";
      params.push(asOfDate);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN direction = 'debit'  THEN amount ELSE 0 END), 0) AS debits
       FROM imprest_transaction_ledger
      WHERE imprest_manager_id = ?${dateFilter}`,
      params,
    );
    const credits = toPaise(Number(rows[0]?.credits ?? 0));
    const debits = toPaise(Number(rows[0]?.debits ?? 0));
    return fromPaise(credits - debits);
  },

  /**
   * Appends one entry and returns its id.
   *
   * The balance is read under a row lock on the manager so two concurrent postings cannot both
   * compute balance_after from the same starting figure. Without the lock the stored running
   * balance drifts from the derived one, and the reconciliation check below starts failing for
   * a reason nobody can reproduce.
   */
  async post(entry: ImprestPosting, connection: PoolConnection): Promise<string> {
    if (!connection) {
      throw new Error("An imprest ledger entry must be written inside the caller's transaction");
    }
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("An imprest ledger amount must be a positive number");
    }

    // Every imprest movement — allocation credit, voucher spend, return, adjustment, closure —
    // funnels through this one method, so this is the single chokepoint to stop any of them
    // posting into a month P&L has already locked for close. GRN's own createDraft()/approval
    // path already re-checks isPeriodLocked before a voucher reaches here (grn.service.ts), but
    // imprest.service.ts's allocation create/approve paths had no equivalent check anywhere —
    // checked here, immediately before the mutation and inside the caller's transaction, so a
    // concurrent lock cannot slip through, same as grn.service.ts's own P0-3 re-check.
    const periodCode = (entry.overridePeriodCode?.trim() || entry.transactionDate.slice(0, 7));
    if (await isPeriodLocked(periodCode, connection)) {
      throw new Error(
        `${periodCode} is locked for P&L close. This imprest entry cannot be posted against it.`
      );
    }

    // Locks the manager row, which serialises every posting against that float.
    const [managerRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM imprest_manager WHERE id = ? FOR UPDATE`,
      [entry.imprestManagerId],
    );
    if (!managerRows[0]) throw new Error("Imprest manager not found");

    const [balanceRows] = await connection.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN direction = 'debit'  THEN amount ELSE 0 END), 0) AS debits
       FROM imprest_transaction_ledger
      WHERE imprest_manager_id = ?`,
      [entry.imprestManagerId],
    );
    const current =
      toPaise(Number(balanceRows[0]?.credits ?? 0)) - toPaise(Number(balanceRows[0]?.debits ?? 0));
    const delta = entry.direction === "credit" ? toPaise(amount) : -toPaise(amount);
    const balanceAfter = fromPaise(current + delta);

    const id = randomUUID();
    await connection.execute(
      `INSERT INTO imprest_transaction_ledger
         (id, imprest_manager_id, branch_id, entry_type, direction, amount, balance_after,
          reference_type, reference_id, period_code, transaction_date, narration, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        entry.imprestManagerId,
        entry.branchId,
        entry.entryType,
        entry.direction,
        amount,
        balanceAfter,
        entry.referenceType ?? null,
        entry.referenceId ?? null,
        entry.transactionDate.slice(0, 7),
        entry.transactionDate,
        entry.narration ?? null,
        entry.actorUserId,
      ],
    );
    return id;
  },

  /**
   * Refuses a debit the float cannot cover.
   *
   * Called before posting a voucher. Deliberately a separate check rather than folded into
   * post(): an opening entry or a correction may legitimately take a float negative, and a
   * blanket rule inside post() would block those too.
   */
  async assertSufficientBalance(
    imprestManagerId: string,
    amount: number,
    connection: PoolConnection,
  ): Promise<void> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN direction = 'debit'  THEN amount ELSE 0 END), 0) AS debits
       FROM imprest_transaction_ledger
      WHERE imprest_manager_id = ?`,
      [imprestManagerId],
    );
    const available =
      toPaise(Number(rows[0]?.credits ?? 0)) - toPaise(Number(rows[0]?.debits ?? 0));
    if (toPaise(amount) > available) {
      throw new Error(
        `This voucher is ${fromPaise(toPaise(amount) - available).toFixed(2)} more than the imprest balance of ${fromPaise(available).toFixed(2)}`,
      );
    }
  },

  /** The statement for one float, oldest first — what a manager-level report renders. */
  async listEntries(filters: {
    imprestManagerId?: string;
    /** The caller's branch entitlement. Applied on top of any explicit branchId, never instead
     *  of it — a user who asks for a branch they do not hold must get nothing, not everything. */
    branchScope?: FinanceBranchScope;
    branchId?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchScope) {
      const scope = financeBranchFilter(filters.branchScope, "l.branch_id");
      if (scope.sql !== "1=1") {
        conditions.push(scope.sql);
        params.push(...scope.params);
      }
    }
    if (filters.imprestManagerId) {
      conditions.push("l.imprest_manager_id = ?");
      params.push(filters.imprestManagerId);
    }
    if (filters.branchId) {
      conditions.push("l.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.from) {
      conditions.push("l.transaction_date >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push("l.transaction_date <= ?");
      params.push(filters.to);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(1000, Math.max(1, filters.limit ?? 500));
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT l.*, bm.branch_name
         FROM imprest_transaction_ledger l
         LEFT JOIN branch_master bm ON bm.id = l.branch_id
         ${where}
        ORDER BY l.transaction_date ASC, l.created_at ASC, l.id ASC
        LIMIT ${limit}`,
      params,
    );
    return rows;
  },

  /**
   * Opening, movements and closing for a period — the Imprest Report (Requirement 7).
   *
   * Opening is everything strictly before the window, so consecutive periods chain: one
   * period's closing is the next one's opening, by construction rather than by convention.
   */
  async getPeriodSummary(filters: {
    imprestManagerId?: string;
    branchScope?: FinanceBranchScope;
    branchId?: string;
    from: string;
    to: string;
  }) {
    const scope: string[] = [];
    const scopeParams: unknown[] = [];
    if (filters.branchScope) {
      // Opening, movements and closing are three separate queries over the same window, so the
      // entitlement has to be part of the shared predicate — scoping only the movements would
      // produce a closing balance that does not equal opening plus movements.
      const entitlement = financeBranchFilter(filters.branchScope, "branch_id");
      if (entitlement.sql !== "1=1") {
        scope.push(entitlement.sql);
        scopeParams.push(...entitlement.params);
      }
    }
    if (filters.imprestManagerId) {
      scope.push("imprest_manager_id = ?");
      scopeParams.push(filters.imprestManagerId);
    }
    if (filters.branchId) {
      scope.push("branch_id = ?");
      scopeParams.push(filters.branchId);
    }
    const scopeSql = scope.length ? ` AND ${scope.join(" AND ")}` : "";

    const [openingRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END),0) AS credits,
         COALESCE(SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END),0) AS debits
       FROM imprest_transaction_ledger
      WHERE transaction_date < ?${scopeSql}`,
      [filters.from, ...scopeParams],
    );
    const opening =
      toPaise(Number(openingRows[0]?.credits ?? 0)) - toPaise(Number(openingRows[0]?.debits ?? 0));

    const [movementRows] = await db.execute<RowDataPacket[]>(
      `SELECT entry_type, direction,
              COALESCE(SUM(amount),0) AS total
         FROM imprest_transaction_ledger
        WHERE transaction_date >= ? AND transaction_date <= ?${scopeSql}
        GROUP BY entry_type, direction`,
      [filters.from, filters.to, ...scopeParams],
    );

    const bucket = { allocated: 0, vouchers: 0, returns: 0, adjustments: 0 };
    let movement = 0;
    for (const row of movementRows as RowDataPacket[]) {
      const paise = toPaise(Number(row.total ?? 0));
      movement += row.direction === "credit" ? paise : -paise;
      if (row.entry_type === "allocation") bucket.allocated += paise;
      else if (row.entry_type === "voucher") bucket.vouchers += paise;
      else if (row.entry_type === "return") bucket.returns += paise;
      else if (row.entry_type === "adjustment") {
        bucket.adjustments += row.direction === "credit" ? paise : -paise;
      }
    }

    return {
      opening_balance: fromPaise(opening),
      allocated: fromPaise(bucket.allocated),
      voucher_utilisation: fromPaise(bucket.vouchers),
      returned: fromPaise(bucket.returns),
      adjustments: fromPaise(bucket.adjustments),
      closing_balance: fromPaise(opening + movement),
    };
  },

  /**
   * The Imprest Details report, in the format Finance actually uses.
   *
   *   S.No. | Date | GRN | Exp. Head | Exp. SubHead | INFLOW | OUTFLOW | Balance |
   *   Mode | Chq No | Bank | Remarks
   *
   * Twelve columns, in that order. This is a FORMAT CONTRACT taken from the supplied
   * `Imprest_Details` workbook, not a layout of my choosing — see the contract test.
   *
   * WHAT THE COLUMNS MEAN, verified against the reference file rather than assumed:
   *
   *   INFLOW / OUTFLOW are the credit and debit sides split into two columns, so a row carries
   *   an amount in exactly one of them. The ledger stores one `amount` plus a `direction`; the
   *   split happens here.
   *
   *   Balance is RUNNING and continues from an opening figure that the report never shows as a
   *   row: in the reference, the first row's balance already has its own outflow applied
   *   (19,817.96 opening, first row 40 out, balance 19,777.96). So opening comes from every
   *   entry strictly BEFORE the window, which is also what makes consecutive months chain.
   *
   *   Mode / Chq No / Bank belong to allocations — money coming IN — and are blank on cash
   *   vouchers. All 25 rows of the reference are outflows and all three columns are empty there,
   *   so they are joined from imprest_allocation and left NULL rather than filled with a dash.
   *
   *   Head and Sub-head come from the voucher's GRN, which is also where the GRN number comes
   *   from. A ledger row with no GRN behind it (an allocation, a manual adjustment) has none,
   *   and shows blank.
   *
   * The running balance is computed here rather than read from `balance_after`. That column is
   * the balance at WRITE time across the manager's whole history; this report is windowed and
   * filtered, so its column has to be derived from the rows actually shown or it would not tie
   * to its own opening figure.
   */
  async getDetailsReport(filters: {
    imprestManagerId?: string;
    branchScope?: FinanceBranchScope;
    branchId?: string;
    from: string;
    to: string;
  }) {
    const scope: string[] = [];
    const scopeParams: unknown[] = [];
    if (filters.branchScope) {
      const entitlement = financeBranchFilter(filters.branchScope, "l.branch_id");
      if (entitlement.sql !== "1=1") {
        scope.push(entitlement.sql);
        scopeParams.push(...entitlement.params);
      }
    }
    if (filters.imprestManagerId) {
      scope.push("l.imprest_manager_id = ?");
      scopeParams.push(filters.imprestManagerId);
    }
    if (filters.branchId) {
      scope.push("l.branch_id = ?");
      scopeParams.push(filters.branchId);
    }
    const scopeSql = scope.length ? ` AND ${scope.join(" AND ")}` : "";

    // Opening: everything strictly before the window, under the SAME filters. Scoping the rows
    // but not the opening would produce a balance column that does not tie to its own report.
    const [openingRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(CASE WHEN l.direction='credit' THEN l.amount ELSE 0 END),0) AS credits,
              COALESCE(SUM(CASE WHEN l.direction='debit'  THEN l.amount ELSE 0 END),0) AS debits
         FROM imprest_transaction_ledger l
        WHERE l.transaction_date < ?${scopeSql}`,
      [filters.from, ...scopeParams],
    );
    const opening =
      toPaise(Number(openingRows[0]?.credits ?? 0)) - toPaise(Number(openingRows[0]?.debits ?? 0));

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.id, l.transaction_date, l.direction, l.amount, l.narration, l.entry_type,
              g.grn_number, g.head AS expense_head, g.sub_head AS expense_sub_head,
              a.payment_mode, a.reference_no, a.bank_name
         FROM imprest_transaction_ledger l
         LEFT JOIN grn_request g
                ON l.reference_type = 'grn_request' AND g.id = l.reference_id
         LEFT JOIN imprest_allocation a
                ON l.reference_type = 'imprest_allocation' AND a.id = l.reference_id
        WHERE l.transaction_date >= ? AND l.transaction_date <= ?${scopeSql}
        ORDER BY l.transaction_date ASC, l.created_at ASC, l.id ASC`,
      [filters.from, filters.to, ...scopeParams],
    );

    let running = opening;
    let inflow = 0;
    let outflow = 0;
    const details = (rows as RowDataPacket[]).map((row, index) => {
      const paise = toPaise(Number(row.amount ?? 0));
      const isCredit = String(row.direction) === "credit";
      running += isCredit ? paise : -paise;
      if (isCredit) inflow += paise; else outflow += paise;
      return {
        serial: index + 1,
        transaction_date: String(row.transaction_date ?? "").slice(0, 10),
        grn_number: row.grn_number ?? null,
        expense_head: row.expense_head ?? null,
        expense_sub_head: row.expense_sub_head ?? null,
        inflow: isCredit ? fromPaise(paise) : 0,
        outflow: isCredit ? 0 : fromPaise(paise),
        balance: fromPaise(running),
        payment_mode: row.payment_mode ?? null,
        cheque_no: row.reference_no ?? null,
        bank_name: row.bank_name ?? null,
        remarks: row.narration ?? null,
      };
    });

    return {
      opening_balance: fromPaise(opening),
      rows: details,
      // The reference's total row carries INFLOW and OUTFLOW only; Balance is deliberately
      // blank there, because a total of a running balance is meaningless.
      totals: { inflow: fromPaise(inflow), outflow: fromPaise(outflow) },
      closing_balance: fromPaise(running),
    };
  },
};
