import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { recordFinanceApprovalEvent } from "../../shared/financeApprovalEvent.js";
import { financeBranchFilter, type FinanceBranchScope } from "./finance-access-scope.js";
import { imprestLedgerService } from "./imprest-ledger.service.js";

/**
 * Imprest Manager master (Requirement 8) and Imprest Allocation (Requirement 6).
 *
 * Three concepts stay separate, as the brief insists: the manager who holds the float, the
 * allocation that funds it, and the voucher that spends it. The voucher is the existing
 * grn_type='imprest' GRN, not a fourth entity here.
 */

const ALLOCATION_STATUSES = ["draft", "submitted", "branch_head_approved", "disbursed", "rejected"] as const;
export type ImprestAllocationStatus = (typeof ALLOCATION_STATUSES)[number];

function assertPeriod(periodCode: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodCode)) {
    throw new Error(`Allocation period must be YYYY-MM, received "${periodCode}"`);
  }
}

/**
 * IMP/MM/YY/0001, allocated per month.
 *
 * The locking sequence is the same one finance_grn_monthly_sequence uses and must stay that
 * way: INSERT ... ON DUPLICATE KEY UPDATE (so the row exists), SELECT ... FOR UPDATE (so it is
 * locked), UPDATE +1 (so it is claimed). Never MAX(serial)+1 — that has no lock and duplicates
 * under concurrency, and an allocation number is what Finance reconciles against the bank.
 *
 * Takes the caller's connection so a failed allocation insert does not burn a number.
 */
export async function allocateImprestNumber(
  periodCode: string,
  connection: PoolConnection,
): Promise<string> {
  assertPeriod(periodCode);
  await connection.execute(
    `INSERT INTO imprest_allocation_sequence (period_code, next_sequence)
     VALUES (?, 1)
     ON DUPLICATE KEY UPDATE next_sequence = next_sequence`,
    [periodCode],
  );
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT next_sequence FROM imprest_allocation_sequence WHERE period_code = ? FOR UPDATE`,
    [periodCode],
  );
  const sequence = Number(rows[0]?.next_sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Imprest allocation sequence is invalid");
  }
  await connection.execute(
    `UPDATE imprest_allocation_sequence SET next_sequence = next_sequence + 1 WHERE period_code = ?`,
    [periodCode],
  );
  const [yyyy, mm] = periodCode.split("-");
  // Padded to four digits but never truncated, so the 10,000th of a month grows rather than wraps.
  return `IMP/${mm}/${yyyy.slice(2, 4)}/${String(sequence).padStart(4, "0")}`;
}

/**
 * The exact members of imprest_allocation.payment_mode's ENUM, verified against the live column.
 * Kept as a named constant so the validation below and the UI's picker have one source to agree
 * with; a value outside this set is rejected with a readable message instead of reaching MySQL.
 */
const ALLOCATION_PAYMENT_MODES = [
  "Cheque", "NEFT", "RTGS", "IMPS", "UPI", "Cash", "Bank Transfer", "Adjustment", "Other",
];

export const imprestService = {
  // ── Manager master ────────────────────────────────────────────────────────

  async listManagers(filters: { branchScope?: FinanceBranchScope; branchId?: string; activeOnly?: boolean }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchScope) {
      const filter = financeBranchFilter(filters.branchScope, "m.branch_id");
      if (filter.sql !== "1=1") {
        conditions.push(filter.sql);
        params.push(...filter.params);
      }
    } else if (filters.branchId) {
      conditions.push("m.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.activeOnly !== false) {
      // Effective dating, not just the flag: "who holds this float today" has to exclude an
      // appointment that has already ended, which an active_status check alone would not.
      conditions.push("m.active_status = 1");
      conditions.push("(m.effective_from IS NULL OR m.effective_from <= CURDATE())");
      conditions.push("(m.effective_to IS NULL OR m.effective_to >= CURDATE())");
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.*, bm.branch_name, e.full_name AS employee_name, e.employee_code
         FROM imprest_manager m
         LEFT JOIN branch_master bm ON bm.id = m.branch_id
         LEFT JOIN employees e ON e.id = m.employee_id
         ${where}
        ORDER BY bm.branch_name, m.effective_from DESC`,
      params,
    );
    return rows;
  },

  async saveManager(
    input: {
      id?: string;
      branchId: string;
      userId: string;
      employeeId?: string | null;
      tallyName?: string | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
      activeStatus?: number;
    },
    actorUserId: string,
  ) {
    if (!input.branchId) throw new Error("Branch is required");
    if (!input.userId) throw new Error("A user is required to hold the float");
    if (!input.effectiveFrom) throw new Error("An effective-from date is required");
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw new Error("Effective-to cannot be before effective-from");
    }

    /*
     * ONE BRANCH, ONE HOLDER AT A TIME.
     *
     * The table's unique key is (user_id, branch_id, effective_from), which only stops the SAME
     * person being appointed to the same branch on the same day. It does nothing to stop two
     * DIFFERENT people holding one branch's float simultaneously, and that is the case that
     * actually breaks:
     *
     *   - the allocation picker offers two holders for one branch's cash;
     *   - the voucher debit resolves `ORDER BY effective_from DESC LIMIT 1` and picks whichever
     *     started later, arbitrarily — so a voucher can debit one float while an allocation
     *     credited the other;
     *   - the balance is per-manager, so one physical cash box splits across two ledgers and
     *     neither reconciles to what is actually in the drawer.
     *
     * Two periods overlap when each starts on or before the other ends, with a NULL end meaning
     * open-ended. Checked under a row lock inside a transaction, because two appointments
     * submitted at once would both pass a bare SELECT and both insert.
     */
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [clashes] = await connection.execute<RowDataPacket[]>(
        `SELECT id, user_id, effective_from, effective_to
           FROM imprest_manager
          WHERE branch_id = ?
            AND active_status = 1
            AND id <> ?
            AND effective_from <= COALESCE(?, '9999-12-31')
            AND ? <= COALESCE(effective_to, '9999-12-31')
          FOR UPDATE`,
        [input.branchId, input.id ?? "", input.effectiveTo ?? null, input.effectiveFrom],
      );
      if (clashes.length && (input.activeStatus ?? 1) === 1) {
        const clash = clashes[0];
        throw new Error(
          `This branch already has an imprest manager for that period `
          + `(${String(clash.effective_from).slice(0, 10)} to `
          + `${clash.effective_to ? String(clash.effective_to).slice(0, 10) : "open-ended"}). `
          + `End that appointment before starting another.`,
        );
      }

      if (input.id) {
        await connection.execute(
          `UPDATE imprest_manager
              SET tally_name = ?, effective_to = ?, active_status = ?, updated_by = ?
            WHERE id = ?`,
          [input.tallyName ?? null, input.effectiveTo ?? null, input.activeStatus ?? 1, actorUserId, input.id],
        );
        await connection.commit();
        return this.getManager(input.id);
      }

      const id = randomUUID();
      await connection.execute(
        `INSERT INTO imprest_manager
           (id, branch_id, user_id, employee_id, tally_name, effective_from, effective_to,
            active_status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          id, input.branchId, input.userId, input.employeeId ?? null, input.tallyName ?? null,
          input.effectiveFrom, input.effectiveTo ?? null, input.activeStatus ?? 1, actorUserId,
        ],
      );
      await connection.commit();
      return this.getManager(id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async getManager(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.*, bm.branch_name FROM imprest_manager m
         LEFT JOIN branch_master bm ON bm.id = m.branch_id
        WHERE m.id = ? LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw new Error("Imprest manager not found");
    return rows[0];
  },

  // ── Allocation ────────────────────────────────────────────────────────────

  async listAllocations(filters: {
    branchScope?: FinanceBranchScope;
    branchId?: string;
    imprestManagerId?: string;
    status?: string;
    from?: string;
    to?: string;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchScope) {
      const filter = financeBranchFilter(filters.branchScope, "a.branch_id");
      if (filter.sql !== "1=1") {
        conditions.push(filter.sql);
        params.push(...filter.params);
      }
    } else if (filters.branchId) {
      conditions.push("a.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.imprestManagerId) {
      conditions.push("a.imprest_manager_id = ?");
      params.push(filters.imprestManagerId);
    }
    if (filters.status) {
      conditions.push("a.status = ?");
      params.push(filters.status);
    }
    if (filters.from) {
      conditions.push("a.allocation_date >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push("a.allocation_date <= ?");
      params.push(filters.to);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT a.*, bm.branch_name, m.tally_name, e.full_name AS manager_name
         FROM imprest_allocation a
         LEFT JOIN branch_master bm ON bm.id = a.branch_id
         LEFT JOIN imprest_manager m ON m.id = a.imprest_manager_id
         LEFT JOIN employees e ON e.id = m.employee_id
         ${where}
        ORDER BY a.allocation_date DESC, a.created_at DESC
        LIMIT 500`,
      params,
    );
    return rows;
  },

  /**
   * Creates an allocation and, when it is disbursed, credits the float.
   *
   * The number, the row and the ledger credit all happen in ONE transaction. Splitting them is
   * how a float ends up credited for an allocation that was never recorded, or numbered for
   * one that failed to insert.
   */
  async createAllocation(
    input: {
      imprestManagerId: string;
      branchId: string;
      allocationDate: string;
      amount: number;
      paymentMode?: string;
      bankId?: string | null;
      bankName?: string | null;
      referenceNo?: string | null;
      transactionDate?: string | null;
      remarks?: string | null;
      /** Skips the approval chain for a directly-disbursed allocation, as legacy behaved. */
      disburseImmediately?: boolean;
    },
    actorUserId: string,
  ) {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Allocation amount must be greater than zero");
    }
    if (!input.allocationDate) throw new Error("Allocation date is required");
    const mode = input.paymentMode ?? "Bank Transfer";
    // Validated here rather than left to the column.
    //
    // payment_mode is an ENUM and this value was passed straight through, so an unrecognised mode
    // reached MySQL and came back as "Data truncated for column 'payment_mode' at row 1" — which
    // names no field the user chose, suggests the value was too long rather than not a member, and
    // under STRICT_TRANS_TABLES fails the whole allocation. The UI was sending bank_transfer /
    // neft / cheque against an ENUM of 'Bank Transfer' / 'NEFT' / 'Cheque', so EVERY allocation
    // failed and no imprest float could ever be funded.
    //
    // The list is the ENUM's exact members. If a mode is added to the column, add it here too —
    // the two are meant to be read side by side.
    if (!ALLOCATION_PAYMENT_MODES.includes(mode)) {
      throw new Error(
        `'${mode}' is not a valid payment mode. Use one of: ${ALLOCATION_PAYMENT_MODES.join(", ")}`,
      );
    }
    // Same rule vendor payments enforce: anything that is not cash leaves a trace, and the
    // trace is the only way a double payment is ever caught.
    if (mode !== "Cash" && !input.referenceNo) {
      throw new Error(`A transaction reference is required for ${mode}`);
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [managerRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, branch_id FROM imprest_manager WHERE id = ? AND active_status = 1 LIMIT 1`,
        [input.imprestManagerId],
      );
      if (!managerRows[0]) throw new Error("Imprest manager not found or inactive");
      if (String(managerRows[0].branch_id) !== String(input.branchId)) {
        throw new Error("This imprest manager does not hold a float for that branch");
      }

      const periodCode = input.allocationDate.slice(0, 7);
      const allocationNo = await allocateImprestNumber(periodCode, connection);
      const id = randomUUID();
      const status: ImprestAllocationStatus = input.disburseImmediately ? "disbursed" : "submitted";

      await connection.execute(
        `INSERT INTO imprest_allocation
           (id, allocation_no, imprest_manager_id, branch_id, allocation_date, amount,
            payment_mode, bank_id, bank_name, reference_no, transaction_date, remarks,
            status, submitted_by, submitted_at, disbursed_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW())`,
        [
          id, allocationNo, input.imprestManagerId, input.branchId, input.allocationDate, amount,
          mode, input.bankId ?? null, input.bankName ?? null, input.referenceNo ?? null,
          input.transactionDate ?? null, input.remarks ?? null,
          status, actorUserId, input.disburseImmediately ? new Date() : null, actorUserId,
        ],
      );

      // The float is credited only once the money has actually gone out. A pending allocation
      // that credited the balance would let a voucher spend money nobody has sent yet.
      if (input.disburseImmediately) {
        await imprestLedgerService.post(
          {
            imprestManagerId: input.imprestManagerId,
            branchId: input.branchId,
            entryType: "allocation",
            direction: "credit",
            amount,
            transactionDate: input.allocationDate,
            referenceType: "imprest_allocation",
            referenceId: id,
            narration: `Allocation ${allocationNo}`,
            actorUserId,
          },
          connection,
        );
      }

      await recordFinanceApprovalEvent(
        {
          entityType: "imprest_allocation",
          entityId: id,
          action: input.disburseImmediately ? "disburse" : "submit",
          fromStatus: null,
          toStatus: status,
          actorUserId,
          actorRole: "finance",
          remarks: input.remarks ?? null,
        },
        connection,
      );

      await connection.commit();
      return { id, allocation_no: allocationNo, status };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /**
   * Approves or rejects an allocation, crediting the float on disbursement.
   *
   * The row is locked for the whole decision so two reviewers cannot both approve it and post
   * two credits — which the ledger's unique source key would then reject, leaving the
   * allocation marked disbursed with no matching entry.
   */
  async reviewAllocation(
    id: string,
    decision: "approve" | "reject",
    actorUserId: string,
    effectiveRole: string,
    remarks?: string,
  ) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM imprest_allocation WHERE id = ? FOR UPDATE`,
        [id],
      );
      const allocation = rows[0];
      if (!allocation) throw new Error("Imprest allocation not found");
      const from = String(allocation.status);
      if (from === "disbursed" || from === "rejected") {
        throw new Error(`This allocation is already ${from}`);
      }
      if (decision === "reject" && !remarks) {
        throw new Error("A reason is required to reject an allocation");
      }

      const to: ImprestAllocationStatus = decision === "reject" ? "rejected" : "disbursed";

      await connection.execute(
        `UPDATE imprest_allocation
            SET status = ?,
                branch_head_reviewed_by = ?, branch_head_reviewed_at = NOW(),
                branch_head_review_note = ?,
                rejection_reason = ?,
                disbursed_at = ?
          WHERE id = ? AND status = ?`,
        [to, actorUserId, remarks ?? null, decision === "reject" ? remarks ?? null : null,
         decision === "approve" ? new Date() : null, id, from],
      );

      if (decision === "approve") {
        await imprestLedgerService.post(
          {
            imprestManagerId: String(allocation.imprest_manager_id),
            branchId: String(allocation.branch_id),
            entryType: "allocation",
            direction: "credit",
            amount: Number(allocation.amount),
            transactionDate: String(allocation.allocation_date).slice(0, 10),
            referenceType: "imprest_allocation",
            referenceId: id,
            narration: `Allocation ${allocation.allocation_no}`,
            actorUserId,
          },
          connection,
        );
      }

      await recordFinanceApprovalEvent(
        {
          entityType: "imprest_allocation",
          entityId: id,
          action: decision,
          fromStatus: from,
          toStatus: to,
          actorUserId,
          actorRole: effectiveRole,
          remarks: remarks ?? null,
        },
        connection,
      );

      await connection.commit();
      return { id, status: to };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
