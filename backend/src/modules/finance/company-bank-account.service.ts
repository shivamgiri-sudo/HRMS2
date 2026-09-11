import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { encryptField } from "../../shared/fieldEncryption.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Company Bank Account master — the organisation's OWN paying/receiving accounts.
 *
 * Nothing like this existed anywhere in HRMS2 before this phase: bank_master is a generic
 * bank-name directory (no account number, not tied to any specific account), and
 * vendor-bank.service.ts's own header confirms our paying account's coordinates have only
 * ever lived in Tally. This is the base the Payment Voucher chain and the Bank Account
 * Ledger are built on (migration 1701).
 *
 * The full account number is never returned by any method here — only last-4 + IFSC, the
 * same masking convention vendor-bank.service.ts already uses for payee accounts. This is
 * master-data setup, not the money-movement control point (that is payment-voucher.service.ts),
 * so writes are single-approval (finance_head/accounts_head/super_admin) rather than
 * maker-checker.
 */

export class CompanyBankAccountError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;

export interface CompanyBankAccountInput {
  bankId: string;
  accountName: string;
  accountNumber?: string | null; // omit on update to leave the stored number unchanged
  ifscCode: string;
  branchId: string;
  tallyLedgerName: string;
  openingBalance?: number;
  openingBalanceAsOf?: string | null;
}

function maskedRow(row: any) {
  return {
    id: String(row.id),
    bank_id: row.bank_id,
    bank_name: row.bank_name ?? null,
    account_name: row.account_name,
    account_number_masked: row.account_number_last4 ? `XXXXXX${row.account_number_last4}` : null,
    ifsc_code: row.ifsc_code,
    branch_id: row.branch_id,
    branch_name: row.branch_name ?? null,
    tally_ledger_name: row.tally_ledger_name,
    opening_balance: Number(row.opening_balance ?? 0),
    opening_balance_as_of: row.opening_balance_as_of ?? null,
    active_status: Number(row.active_status ?? 0) === 1,
    closed_date: row.closed_date ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normaliseInput(input: CompanyBankAccountInput) {
  const ifscCode = String(input.ifscCode ?? "").trim().toUpperCase();
  if (!IFSC_RE.test(ifscCode)) {
    throw new CompanyBankAccountError(
      "IFSC must be 11 characters: 4 letters, then 0, then 6 letters or digits (e.g. HDFC0001234).",
    );
  }
  if (!input.accountName?.trim()) throw new CompanyBankAccountError("Account name is required");
  if (!input.bankId) throw new CompanyBankAccountError("Bank is required");
  if (!input.branchId) throw new CompanyBankAccountError("Branch is required");
  if (!input.tallyLedgerName?.trim()) {
    throw new CompanyBankAccountError("Tally ledger name is required — every export writes this field, never the display name.");
  }
  let accountNumber: string | undefined;
  if (input.accountNumber != null && input.accountNumber !== "") {
    accountNumber = String(input.accountNumber).replace(/[\s-]/g, "");
    if (!ACCOUNT_RE.test(accountNumber)) {
      throw new CompanyBankAccountError("Account number must be 9 to 18 digits.");
    }
  }
  return { ifscCode, accountNumber };
}

export const companyBankAccountService = {
  async list(options: { includeInactive?: boolean } = {}) {
    const where = options.includeInactive ? "" : "WHERE cba.active_status = 1";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cba.*, bm.bank_name, b.branch_name
         FROM company_bank_account cba
         LEFT JOIN bank_master bm ON bm.id = cba.bank_id
         LEFT JOIN branch_master b ON b.id = cba.branch_id
         ${where}
        ORDER BY cba.account_name`,
    );
    return (rows as RowDataPacket[]).map(maskedRow);
  },

  async get(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cba.*, bm.bank_name, b.branch_name
         FROM company_bank_account cba
         LEFT JOIN bank_master bm ON bm.id = cba.bank_id
         LEFT JOIN branch_master b ON b.id = cba.branch_id
        WHERE cba.id = ?
        LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? maskedRow(row) : null;
  },

  /** For internal callers (payment-voucher.service.ts) that need the real balance base and the
   *  bank_id, but still never the account number. */
  async getForVoucher(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, bank_id, account_name, branch_id, tally_ledger_name,
              opening_balance, active_status
         FROM company_bank_account
        WHERE id = ?
        LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async create(input: CompanyBankAccountInput, actorUserId: string) {
    const { ifscCode, accountNumber } = normaliseInput(input);
    if (!accountNumber) {
      throw new CompanyBankAccountError("Account number is required when creating an account");
    }
    const id = randomUUID();
    await db.execute(
      `INSERT INTO company_bank_account
         (id, bank_id, account_name, account_number_enc, account_number_last4,
          account_number_key_version, ifsc_code, branch_id, tally_ledger_name,
          opening_balance, opening_balance_as_of, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.bankId,
        input.accountName.trim(),
        encryptField(accountNumber),
        accountNumber.slice(-4),
        ifscCode,
        input.branchId,
        input.tallyLedgerName.trim(),
        Number(input.openingBalance ?? 0),
        input.openingBalanceAsOf ?? null,
        actorUserId,
        actorUserId,
      ],
    );
    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: "COMPANY_BANK_ACCOUNT_CREATED",
      module_key: "FINANCE",
      entity_type: "company_bank_account",
      entity_id: id,
      change_summary: { account_name: input.accountName, bank_id: input.bankId, branch_id: input.branchId },
    }).catch(() => undefined);
    return this.get(id);
  },

  async update(id: string, input: Partial<CompanyBankAccountInput>, actorUserId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM company_bank_account WHERE id = ? LIMIT 1`,
      [id],
    );
    const existing = rows[0];
    if (!existing) throw new CompanyBankAccountError("Bank account not found", 404);

    // Opening balance is the base the Bank Ledger, the Payment Voucher chain and the Tally
    // export are all built on -- it does NOT go through this single-approval edit path.
    // A change must go through requestOpeningBalanceChange/decideOpeningBalanceChange below,
    // which require a second, different qualifying user to approve it (migration 1753).
    if (
      input.openingBalance !== undefined &&
      Number(input.openingBalance) !== Number(existing.opening_balance ?? 0)
    ) {
      throw new CompanyBankAccountError(
        "Opening balance cannot be edited directly. Use 'Request Balance Change' — it requires a second approver.",
      );
    }

    const merged: CompanyBankAccountInput = {
      bankId: input.bankId ?? existing.bank_id,
      accountName: input.accountName ?? existing.account_name,
      accountNumber: input.accountNumber,
      ifscCode: input.ifscCode ?? existing.ifsc_code,
      branchId: input.branchId ?? existing.branch_id,
      tallyLedgerName: input.tallyLedgerName ?? existing.tally_ledger_name,
      openingBalance: Number(existing.opening_balance ?? 0),
      openingBalanceAsOf: existing.opening_balance_as_of,
    };
    const { ifscCode, accountNumber } = normaliseInput(merged);

    const setAccountNumber = accountNumber !== undefined;
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE company_bank_account
          SET bank_id = ?, account_name = ?, ifsc_code = ?, branch_id = ?,
              tally_ledger_name = ?,
              ${setAccountNumber ? "account_number_enc = ?, account_number_last4 = ?, account_number_key_version = 1," : ""}
              updated_by = ?, updated_at = NOW()
        WHERE id = ?`,
      [
        merged.bankId,
        merged.accountName.trim(),
        ifscCode,
        merged.branchId,
        merged.tallyLedgerName.trim(),
        ...(setAccountNumber ? [encryptField(accountNumber as string), (accountNumber as string).slice(-4)] : []),
        actorUserId,
        id,
      ],
    );
    if (result.affectedRows !== 1) throw new CompanyBankAccountError("Update did not affect a record");

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: "COMPANY_BANK_ACCOUNT_UPDATED",
      module_key: "FINANCE",
      entity_type: "company_bank_account",
      entity_id: id,
      change_summary: { account_name: merged.accountName, account_number_changed: setAccountNumber },
    }).catch(() => undefined);
    return this.get(id);
  },

  /**
   * Opening-balance maker-checker (migration 1753). Raises a pending request; the account's
   * opening_balance does not change until a different qualifying user calls
   * decideOpeningBalanceChange with 'approved'.
   */
  async requestOpeningBalanceChange(
    bankAccountId: string,
    requestedValue: number,
    reason: string,
    actorUserId: string,
  ) {
    if (!reason?.trim()) throw new CompanyBankAccountError("A reason is required to request a balance change");
    const account = await this.get(bankAccountId);
    if (!account) throw new CompanyBankAccountError("Bank account not found", 404);
    if (Number(requestedValue) === Number(account.opening_balance)) {
      throw new CompanyBankAccountError("Requested value is the same as the current opening balance");
    }
    const id = randomUUID();
    await db.execute(
      `INSERT INTO company_bank_account_balance_change_request
         (id, bank_account_id, current_value, requested_value, reason, status, requested_by)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, bankAccountId, account.opening_balance, Number(requestedValue), reason.trim(), actorUserId],
    );
    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: "COMPANY_BANK_ACCOUNT_BALANCE_CHANGE_REQUESTED",
      module_key: "FINANCE",
      entity_type: "company_bank_account",
      entity_id: bankAccountId,
      change_summary: { current_value: account.opening_balance, requested_value: Number(requestedValue), reason: reason.trim() },
    }).catch(() => undefined);
    return this.getBalanceChangeRequest(id);
  },

  async listBalanceChangeRequests(bankAccountId?: string, status?: "pending" | "approved" | "rejected") {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (bankAccountId) {
      conditions.push("r.bank_account_id = ?");
      params.push(bankAccountId);
    }
    if (status) {
      conditions.push("r.status = ?");
      params.push(status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*, cba.account_name
         FROM company_bank_account_balance_change_request r
         JOIN company_bank_account cba ON cba.id = r.bank_account_id
        ${where}
        ORDER BY r.requested_at DESC`,
      params,
    );
    return rows;
  },

  async getBalanceChangeRequest(requestId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM company_bank_account_balance_change_request WHERE id = ? LIMIT 1`,
      [requestId],
    );
    return rows[0] ?? null;
  },

  async decideOpeningBalanceChange(
    requestId: string,
    decision: "approved" | "rejected",
    actorUserId: string,
    remarks: string | undefined,
  ) {
    const request = await this.getBalanceChangeRequest(requestId);
    if (!request) throw new CompanyBankAccountError("Balance change request not found", 404);
    if (request.status !== "pending") {
      throw new CompanyBankAccountError(`This request is already ${request.status}`, 400);
    }
    // Maker-checker: the approver must be someone other than whoever raised the request --
    // same guard cost-centre-management.service.ts's approveL1/approveL2 use.
    if (actorUserId && actorUserId === request.requested_by) {
      throw new CompanyBankAccountError(
        "Opening balance change approval must come from someone other than the person who requested it",
        403,
      );
    }

    await db.execute(
      `UPDATE company_bank_account_balance_change_request
          SET status = ?, decided_by = ?, decided_at = NOW(), decision_remarks = ?, updated_at = NOW()
        WHERE id = ?`,
      [decision, actorUserId, remarks?.trim() || null, requestId],
    );

    if (decision === "approved") {
      const [result] = await db.execute<ResultSetHeader>(
        `UPDATE company_bank_account SET opening_balance = ?, updated_by = ?, updated_at = NOW() WHERE id = ?`,
        [Number(request.requested_value), actorUserId, request.bank_account_id],
      );
      if (result.affectedRows !== 1) throw new CompanyBankAccountError("Bank account not found", 404);
    }

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type:
        decision === "approved"
          ? "COMPANY_BANK_ACCOUNT_BALANCE_CHANGE_APPROVED"
          : "COMPANY_BANK_ACCOUNT_BALANCE_CHANGE_REJECTED",
      module_key: "FINANCE",
      entity_type: "company_bank_account",
      entity_id: request.bank_account_id,
      change_summary: {
        current_value: request.current_value,
        requested_value: request.requested_value,
        requested_by: request.requested_by,
        remarks: remarks?.trim() || null,
      },
    }).catch(() => undefined);

    return this.getBalanceChangeRequest(requestId);
  },

  /** Drill-down mandate's "Audit trail" section — sensitive_action_log is the only audit table
   *  this service writes to (logSensitiveAction), so that is what a reader reads back. */
  async getAuditTrail(id: string, limit = 20) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT action_type, actor_user_id, actor_role, change_summary, reason, acted_at AS created_at
         FROM sensitive_action_log
        WHERE entity_type = 'company_bank_account' AND entity_id = ?
        ORDER BY acted_at DESC
        LIMIT ${Math.min(100, Math.max(1, Number(limit) || 20))}`,
      [id],
    );
    return rows;
  },

  async setActiveStatus(id: string, active: boolean, actorUserId: string, closedDate?: string | null) {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE company_bank_account
          SET active_status = ?, closed_date = ?, updated_by = ?, updated_at = NOW()
        WHERE id = ?`,
      [active ? 1 : 0, active ? null : (closedDate ?? new Date().toISOString().slice(0, 10)), actorUserId, id],
    );
    if (result.affectedRows !== 1) throw new CompanyBankAccountError("Bank account not found", 404);
    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: active ? "COMPANY_BANK_ACCOUNT_REACTIVATED" : "COMPANY_BANK_ACCOUNT_CLOSED",
      module_key: "FINANCE",
      entity_type: "company_bank_account",
      entity_id: id,
    }).catch(() => undefined);
    return this.get(id);
  },
};
