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

/** Owner ruling (PRD §10, 2026-09-09): flag a manager for replenishment when their float drops
 *  below this percentage of their own sanctioned_float_amount, unless they carry their own
 *  replenishment_floor_pct override. */
const DEFAULT_REPLENISHMENT_FLOOR_PCT = 25;

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

// Mirrors vendor-payment-ledger.service.ts's BANK_MODES — the modes that genuinely move money
// through a specific bank account, as opposed to Cash (no account) or Adjustment/Other (not a
// real bank-rail transfer). Used to require company_bank_account_id only where it applies.
const ALLOCATION_BANK_MODES = new Set(["Cheque", "NEFT", "RTGS", "IMPS", "UPI", "Bank Transfer"]);

function round2(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

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
      branchId?: string;
      userId?: string;
      employeeId?: string | null;
      tallyName?: string | null;
      effectiveFrom?: string;
      effectiveTo?: string | null;
      activeStatus?: number;
      /** Payment Voucher System Phase 2 (1705_imprest_manager_sanctioned_float.sql). The float
       *  ceiling the "% of sanctioned float" replenishment auto-flag computes against — NULL
       *  means no cap is set yet, so that manager gets no auto-flag until Finance sets one. */
      sanctionedFloatAmount?: number | null;
      /** NULL = use the global default (25%). Per-manager override of the flag threshold. */
      replenishmentFloorPct?: number | null;
    },
    actorUserId: string,
  ) {
    // For updates (id present), only validate what's being changed
    // For creates, require the full set
    if (!input.id) {
      if (!input.branchId) throw new Error("Branch is required");
      if (!input.userId) throw new Error("A user is required to hold the float");
      if (!input.effectiveFrom) throw new Error("An effective-from date is required");
    }
    if (input.effectiveTo && input.effectiveFrom && input.effectiveTo < input.effectiveFrom) {
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

      // For updates: lock and re-read the row being edited, so a partial update (e.g. renaming
      // the tally name) only needs to supply the fields actually changing.
      if (input.id) {
        /*
         * REGRESSION FIX, 2026-08-29. Restores a check this branch used to run and stopped
         * running.
         *
         * PR 494b2af2 (8 Aug) closed "two different people can hold one branch's float at once"
         * by checking every save — including an update — for an overlap against other active
         * appointments in the branch, excluding the row itself via `id <> ?`. A later broad
         * commit (0b197520, 24 Aug) restructured this into an early return for any update BEFORE
         * that check runs, so the exact bug the original commit fixed was silently reopened for
         * the update path: extending an ended appointment's effective_to, or reactivating one,
         * can create a real overlap with a manager appointed in the meantime, and nothing catches
         * it. Only DEACTIVATING was ever meant to be exempt — "ending is how you make room for the
         * next holder" — not every update.
         *
         * The same commit introduced a second, adjacent bug: `active_status = ?` was bound to
         * `input.activeStatus ?? 1`, so any update that omitted activeStatus (a plain rename, for
         * instance) silently reactivated a previously-ended appointment regardless of its current
         * value. Fixed by merging into the row's own current value instead of defaulting to 1.
         */
        const [currentRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id, branch_id, effective_from, effective_to, active_status
             FROM imprest_manager
            WHERE id = ?
            FOR UPDATE`,
          [input.id],
        );
        const current = currentRows[0];
        if (!current) throw new Error("Imprest manager appointment not found");

        // Mirrors the UPDATE's own COALESCE(?, effective_to)/`?? current` semantics: an omitted
        // (or explicitly null) field keeps the row's existing value rather than clearing it.
        const nextEffectiveTo = input.effectiveTo ?? current.effective_to;
        const nextActiveStatus = input.activeStatus ?? current.active_status;

        if (Number(nextActiveStatus) === 1) {
          const [clashes] = await connection.execute<RowDataPacket[]>(
            `SELECT id, user_id, effective_from, effective_to
               FROM imprest_manager
              WHERE branch_id = ?
                AND active_status = 1
                AND id <> ?
                AND effective_from <= COALESCE(?, '9999-12-31')
                AND ? <= COALESCE(effective_to, '9999-12-31')
              FOR UPDATE`,
            [current.branch_id, input.id, nextEffectiveTo ?? null, current.effective_from],
          );
          if (clashes.length) {
            const clash = clashes[0];
            throw new Error(
              `This branch already has an imprest manager for that period `
              + `(${String(clash.effective_from).slice(0, 10)} to `
              + `${clash.effective_to ? String(clash.effective_to).slice(0, 10) : "open-ended"}). `
              + `End that appointment before starting another.`,
            );
          }
        }

        await connection.execute(
          `UPDATE imprest_manager
              SET tally_name = COALESCE(?, tally_name),
                  effective_to = COALESCE(?, effective_to),
                  active_status = ?,
                  sanctioned_float_amount = COALESCE(?, sanctioned_float_amount),
                  replenishment_floor_pct = COALESCE(?, replenishment_floor_pct),
                  updated_by = ?
            WHERE id = ?`,
          [
            input.tallyName !== undefined ? input.tallyName : null,
            input.effectiveTo ?? null,
            nextActiveStatus,
            input.sanctionedFloatAmount ?? null,
            input.replenishmentFloorPct ?? null,
            actorUserId,
            input.id,
          ],
        );
        await connection.commit();
        return this.getManager(input.id);
      }

      // For new appointments, check for overlaps
      const [clashes] = await connection.execute<RowDataPacket[]>(
        `SELECT id, user_id, effective_from, effective_to
           FROM imprest_manager
          WHERE branch_id = ?
            AND active_status = 1
            AND effective_from <= COALESCE(?, '9999-12-31')
            AND ? <= COALESCE(effective_to, '9999-12-31')
          FOR UPDATE`,
        [input.branchId, input.effectiveTo ?? null, input.effectiveFrom],
      );
      if (clashes.length) {
        const clash = clashes[0];
        throw new Error(
          `This branch already has an imprest manager for that period `
          + `(${String(clash.effective_from).slice(0, 10)} to `
          + `${clash.effective_to ? String(clash.effective_to).slice(0, 10) : "open-ended"}). `
          + `End that appointment before starting another.`,
        );
      }

      const id = randomUUID();
      await connection.execute(
        `INSERT INTO imprest_manager
           (id, branch_id, user_id, employee_id, tally_name, effective_from, effective_to,
            active_status, sanctioned_float_amount, replenishment_floor_pct, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          id, input.branchId, input.userId, input.employeeId ?? null, input.tallyName ?? null,
          input.effectiveFrom, input.effectiveTo ?? null, input.activeStatus ?? 1,
          input.sanctionedFloatAmount ?? null, input.replenishmentFloorPct ?? null, actorUserId,
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

  // ── Replenishment auto-flag (Payment Voucher System Phase 2) ────────────────
  //
  // Owner ruling (PRD §10): "% of sanctioned float", not a flat rupee floor — a manager with a
  // ₹50,000 float and one with a ₹5,000 float should not be flagged at the same number. Default
  // 25%, overridable per manager via imprest_manager.replenishment_floor_pct (1705).
  //
  // A manager with no sanctioned_float_amount set gets no flag at all — there is nothing to take
  // a percentage OF — which degrades to the equivalent of Option C (no automatic flag) for that
  // manager until Finance sets one, exactly as 1705's migration comment says.

  async getReplenishmentStatus(imprestManagerId: string) {
    const manager = await this.getManager(imprestManagerId);
    const sanctioned = manager.sanctioned_float_amount != null ? Number(manager.sanctioned_float_amount) : null;
    const currentBalance = await imprestLedgerService.getBalance(imprestManagerId);
    if (sanctioned == null || sanctioned <= 0) {
      return {
        imprestManagerId, sanctionedFloatAmount: null, floorPct: null, floorAmount: null,
        currentBalance, needsReplenishment: false,
        reason: "No sanctioned float amount set for this manager — cannot compute a percentage floor.",
      };
    }
    const floorPct = manager.replenishment_floor_pct != null ? Number(manager.replenishment_floor_pct) : DEFAULT_REPLENISHMENT_FLOOR_PCT;
    const floorAmount = Math.round((sanctioned * floorPct / 100 + Number.EPSILON) * 100) / 100;
    return {
      imprestManagerId, sanctionedFloatAmount: sanctioned, floorPct, floorAmount, currentBalance,
      needsReplenishment: currentBalance < floorAmount,
      reason: null,
    };
  },

  /** Every active manager whose float is currently below its own flag line — the list a Finance
   *  Head dashboard/queue reads to know who to raise a Lane B voucher for. */
  async listReplenishmentFlags(filters: { branchScope?: FinanceBranchScope; branchId?: string }) {
    const managers = await this.listManagers({ ...filters, activeOnly: true });
    const flagged: any[] = [];
    for (const m of managers as any[]) {
      const status = await this.getReplenishmentStatus(String(m.id));
      if (status.needsReplenishment) flagged.push({ ...m, ...status });
    }
    return flagged;
  },

  /**
   * The imprest GRNs (voucher debits) posted since this manager's last allocation credit — the
   * "here's what the float was actually spent on" list PRD §6.6 asks the CEO's approval to be
   * backed by, rather than just a number the manager asked for. Not a report of ALL history —
   * only what has happened since the float was last topped up.
   */
  async getConsumptionSinceLastReplenishment(imprestManagerId: string) {
    const [lastAllocRows] = await db.execute<RowDataPacket[]>(
      `SELECT transaction_date FROM imprest_transaction_ledger
        WHERE imprest_manager_id = ? AND entry_type = 'allocation'
        ORDER BY transaction_date DESC, created_at DESC LIMIT 1`,
      [imprestManagerId],
    );
    const since = lastAllocRows[0]?.transaction_date ?? "1900-01-01";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.id, l.transaction_date, l.amount, l.narration,
              g.grn_number, g.head AS expense_head, g.sub_head AS expense_sub_head
         FROM imprest_transaction_ledger l
         LEFT JOIN grn_request g ON l.reference_type = 'grn_request' AND g.id = l.reference_id
        WHERE l.imprest_manager_id = ? AND l.entry_type = 'voucher' AND l.transaction_date > ?
        ORDER BY l.transaction_date ASC`,
      [imprestManagerId, since],
    );
    return { sinceDate: since, rows };
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
      /**
       * Which of the company's own bank accounts (company_bank_account.id) this allocation was
       * actually funded from — distinct from bankId above, which is only bank_master's generic
       * bank-name directory. Required for a real bank-rail mode once the org has at least one
       * account configured; this is what lets a direct allocation write its own
       * bank_account_ledger_entry row, closing the gap where "real bank-funded" top-ups never
       * reached the Bank Ledger / reconciliation.
       */
      companyBankAccountId?: string | null;
      referenceNo?: string | null;
      transactionDate?: string | null;
      remarks?: string | null;
      /** Finance Head override: book this allocation to a different P&L period when allocationDate
       *  falls in a locked month. YYYY-MM format. Also used as the IMP number month. */
      accountingPeriod?: string | null;
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
    const companyBankAccountId = input.companyBankAccountId?.trim() || null;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Required once the org has a bank account configured — same reasoning as the mirror
      // check in vendor-payment-ledger.service.ts's dispatch(): otherwise this is silently
      // skippable and the bank ledger stays incomplete for the exact payments this was meant to
      // close. Only checked for real bank-rail modes; a fresh/test tenant with zero accounts
      // configured is unaffected.
      if (ALLOCATION_BANK_MODES.has(mode) && !companyBankAccountId) {
        const [[anyAccount]] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM company_bank_account WHERE active_status = 1 LIMIT 1`
        );
        if (anyAccount) throw new Error("Bank account is required for this payment mode");
      }

      const [managerRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, branch_id FROM imprest_manager WHERE id = ? AND active_status = 1 LIMIT 1`,
        [input.imprestManagerId],
      );
      if (!managerRows[0]) throw new Error("Imprest manager not found or inactive");
      if (String(managerRows[0].branch_id) !== String(input.branchId)) {
        throw new Error("This imprest manager does not hold a float for that branch");
      }

      // accountingPeriod overrides the IMP number month and the P&L period lock check.
      // Falls back to allocationDate's month when not provided.
      const periodCode = (input.accountingPeriod?.trim() || input.allocationDate.slice(0, 7));
      const allocationNo = await allocateImprestNumber(periodCode, connection);
      const id = randomUUID();
      const status: ImprestAllocationStatus = input.disburseImmediately ? "disbursed" : "submitted";

      await connection.execute(
        `INSERT INTO imprest_allocation
           (id, allocation_no, imprest_manager_id, branch_id, allocation_date, amount,
            payment_mode, bank_id, company_bank_account_id, bank_name, reference_no,
            transaction_date, remarks, accounting_period,
            status, submitted_by, submitted_at, disbursed_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW())`,
        [
          id, allocationNo, input.imprestManagerId, input.branchId, input.allocationDate, amount,
          mode, input.bankId ?? null, companyBankAccountId, input.bankName ?? null,
          input.referenceNo ?? null,
          input.transactionDate ?? null, input.remarks ?? null,
          input.accountingPeriod?.trim() || null,
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
            overridePeriodCode: input.accountingPeriod?.trim() || null,
            referenceType: "imprest_allocation",
            referenceId: id,
            narration: `Allocation ${allocationNo}`,
            actorUserId,
          },
          connection,
        );

        // Bank ledger write — closes the gap this fix targets. No callingVoucherId-style gate
        // needed here: payment-voucher.service.ts's release() funds the "imprest_allocation"
        // voucher lane by calling imprestLedgerService.post() directly, never createAllocation(),
        // so there is no double-write path to guard against, unlike the vendor-dispatch fix.
        if (companyBankAccountId) {
          const [[bankAccount]] = await connection.execute<RowDataPacket[]>(
            `SELECT id, opening_balance, active_status
               FROM company_bank_account WHERE id = ? FOR UPDATE`,
            [companyBankAccountId]
          );
          if (!bankAccount) throw new Error("Bank account not found");
          if (!(bankAccount as any).active_status) throw new Error("This bank account is closed");

          const [[lastEntry]] = await connection.execute<RowDataPacket[]>(
            `SELECT running_balance FROM bank_account_ledger_entry
               WHERE bank_account_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
            [companyBankAccountId]
          );
          const runningBalance = round2(
            (lastEntry ? Number((lastEntry as any).running_balance) : Number((bankAccount as any).opening_balance))
            - amount
          );

          const [[imprestPayableAccount]] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM payable_account_master WHERE account_name = 'Imprest Float' LIMIT 1`
          );
          if (!imprestPayableAccount) throw new Error("Imprest Float ledger account is not configured");

          await connection.execute(
            `INSERT INTO bank_account_ledger_entry
               (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
                payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
             VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, 'direct_imprest_allocation', ?)`,
            [
              randomUUID(),
              companyBankAccountId,
              input.allocationDate,
              amount,
              (imprestPayableAccount as any).id,
              `Imprest allocation ${allocationNo} disbursed to manager ${input.imprestManagerId}`,
              input.referenceNo ?? null,
              runningBalance,
              actorUserId,
            ]
          );
        }
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

        // Bank ledger write, mirroring createAllocation()'s immediate-disbursement block. The
        // bank account was chosen once, when this allocation was raised as "submitted" — read it
        // back off the locked row rather than asking again at approval time; the money-out
        // decision is made once, approval only decides yes/no.
        const companyBankAccountId = allocation.company_bank_account_id
          ? String(allocation.company_bank_account_id)
          : null;
        if (companyBankAccountId) {
          const [[bankAccount]] = await connection.execute<RowDataPacket[]>(
            `SELECT id, opening_balance, active_status
               FROM company_bank_account WHERE id = ? FOR UPDATE`,
            [companyBankAccountId]
          );
          if (!bankAccount) throw new Error("Bank account not found");
          if (!(bankAccount as any).active_status) throw new Error("This bank account is closed");

          const [[lastEntry]] = await connection.execute<RowDataPacket[]>(
            `SELECT running_balance FROM bank_account_ledger_entry
               WHERE bank_account_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
            [companyBankAccountId]
          );
          const runningBalance = round2(
            (lastEntry ? Number((lastEntry as any).running_balance) : Number((bankAccount as any).opening_balance))
            - Number(allocation.amount)
          );

          const [[imprestPayableAccount]] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM payable_account_master WHERE account_name = 'Imprest Float' LIMIT 1`
          );
          if (!imprestPayableAccount) throw new Error("Imprest Float ledger account is not configured");

          await connection.execute(
            `INSERT INTO bank_account_ledger_entry
               (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
                payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
             VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, 'direct_imprest_allocation', ?)`,
            [
              randomUUID(),
              companyBankAccountId,
              String(allocation.allocation_date).slice(0, 10),
              Number(allocation.amount),
              (imprestPayableAccount as any).id,
              `Imprest allocation ${allocation.allocation_no} disbursed to manager ${allocation.imprest_manager_id}`,
              allocation.reference_no ?? null,
              runningBalance,
              actorUserId,
            ]
          );
        }
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

  // ── Adjustment ────────────────────────────────────────────────────────────

  /**
   * A manual correcting entry against a manager's float — the "Imprest Adjustment" screen.
   *
   * Exists for exactly one situation: the float is wrong for a reason with no real transaction
   * behind it, most commonly a historical migration gap (a db_bill top-up payment that was never
   * matched to a manager and silently dropped, while the matching spend WAS migrated and
   * attached to whichever manager holds the branch today). There is no bank transfer, no vendor,
   * no GRN to point at — which is exactly why this cannot go through createAllocation() (a real
   * bank-funded top-up, IMP-numbered) or a GRN voucher (a real, receipted spend).
   *
   * Posts through imprestLedgerService.post() with entryType "adjustment" — the same primitive
   * getPeriodSummary()/getDetailsReport() already reserve their own reporting bucket for, so an
   * adjustment is visibly labelled as one everywhere the float is read, never mistaken for a real
   * allocation or voucher.
   *
   * A reason is mandatory and is the whole audit trail: unlike a GRN or an allocation, there is
   * no invoice or bank reference behind this entry, so "why is this manager's float ₹X different"
   * has to be answerable from the reason alone.
   */
  async postAdjustment(
    input: {
      imprestManagerId: string;
      direction: "credit" | "debit";
      amount: number;
      transactionDate: string;
      reason: string;
    },
    actorUserId: string,
    actorRole: string,
  ) {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Adjustment amount must be greater than zero");
    }
    if (!input.transactionDate) throw new Error("A transaction date is required");
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 10) {
      throw new Error("A reason of at least 10 characters is required to post an adjustment");
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [managerRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, branch_id FROM imprest_manager WHERE id = ? AND active_status = 1 LIMIT 1 FOR UPDATE`,
        [input.imprestManagerId],
      );
      if (!managerRows[0]) throw new Error("Imprest manager not found or inactive");
      const branchId = String(managerRows[0].branch_id);

      // Read on THIS connection, under the manager row lock taken above, so it reflects exactly
      // what post() below will see and write — not a snapshot that a concurrent posting could
      // move between here and there.
      const [beforeRows] = await connection.execute<RowDataPacket[]>(
        `SELECT
           COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN direction = 'debit'  THEN amount ELSE 0 END), 0) AS balance
           FROM imprest_transaction_ledger WHERE imprest_manager_id = ?`,
        [input.imprestManagerId],
      );
      const balanceBefore = Number(beforeRows[0]?.balance ?? 0);

      const ledgerId = await imprestLedgerService.post(
        {
          imprestManagerId: input.imprestManagerId,
          branchId,
          entryType: "adjustment",
          direction: input.direction,
          amount,
          transactionDate: input.transactionDate,
          referenceType: "manual",
          referenceId: null,
          narration: reason,
          actorUserId,
        },
        connection,
      );

      // The exact value post() computed and wrote, not a JS recomputation of it.
      const [afterRows] = await connection.execute<RowDataPacket[]>(
        `SELECT balance_after FROM imprest_transaction_ledger WHERE id = ?`,
        [ledgerId],
      );
      const balanceAfter = Number(afterRows[0]?.balance_after ?? 0);

      await recordFinanceApprovalEvent(
        {
          entityType: "imprest_manager",
          entityId: input.imprestManagerId,
          action: "adjustment",
          fromStatus: null,
          toStatus: "posted",
          actorUserId,
          actorRole,
          remarks: reason,
          details: { direction: input.direction, amount, balanceBefore, balanceAfter, ledgerId },
        },
        connection,
      );

      await connection.commit();
      return { ledgerId, balanceBefore, balanceAfter };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
