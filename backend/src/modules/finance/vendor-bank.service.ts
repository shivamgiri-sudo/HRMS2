/**
 * Vendor payee bank details — maker-checker maintenance.
 *
 * WHY THIS EXISTS, AND WHY IT LOOKS PARANOID
 *
 *   Verified live 2026-08-26: vendor payee bank details existed in NEITHER database.
 *   mas_hrms.vendor_master (1,821 rows), db_bill.tbl_vendormaster (2,059) and
 *   db_bill.vendor_master (526) all carry zero bank columns. db_bill's
 *   bill_pay_particulars.deposit_bank is our OWN paying account, not the payee. The
 *   coordinates live in Tally only.
 *
 *   So this module does not surface data that was already here — it introduces it, and
 *   with it the payment-redirection fraud vector the audit control matrix flags. Every
 *   control below exists because of that, not as ceremony:
 *
 *     - No one changes a payee account alone. A Finance Head or Accounts Head RAISES a
 *       change; a DIFFERENT user holding either role APPROVES it. Only approval writes
 *       vendor_bank_detail.
 *     - The account number is never stored, returned, or logged in plaintext. Callers
 *       get last-4 + IFSC. Full numbers exist only as AES-256-GCM ciphertext.
 *     - Attempts are logged, not just successes. A rejected or cancelled request is
 *       written to vendor_bank_detail_log too, because "who TRIED to redirect this
 *       vendor's payments" is the question an investigation actually asks.
 *     - Superseding never updates a row in place, so the log can point at a real row on
 *       both sides of every change.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { encryptField, blindIndex } from "../../shared/fieldEncryption.js";

/** Roles permitted to raise or approve a vendor bank change. */
export const VENDOR_BANK_ROLES = ["finance_head", "accounts_head"] as const;

export class VendorBankError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    // A bare `throw new Error()` has its message REPLACED in production by the error
    // handler, so anything a caller needs to read must carry a statusCode.
    super(message);
    this.statusCode = statusCode;
  }
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** 9-18 digits. Indian bank accounts are numeric; letters here mean a typo or a paste. */
const ACCOUNT_RE = /^\d{9,18}$/;

export interface BankInput {
  accountNumber: string;
  ifsc: string;
  accountHolderName?: string | null;
  bankName?: string | null;
  branchName?: string | null;
  reason?: string | null;
}

export interface ActorContext {
  userId: string;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

function normalise(input: BankInput) {
  const accountNumber = String(input.accountNumber ?? "").replace(/[\s-]/g, "");
  const ifsc = String(input.ifsc ?? "").trim().toUpperCase();

  if (!ACCOUNT_RE.test(accountNumber)) {
    throw new VendorBankError(
      "Account number must be 9 to 18 digits. Spaces and hyphens are removed automatically; letters are not accepted.",
    );
  }
  if (!IFSC_RE.test(ifsc)) {
    throw new VendorBankError(
      "IFSC must be 11 characters: 4 letters, then 0, then 6 letters or digits (e.g. HDFC0001234).",
    );
  }
  return {
    accountNumber,
    ifsc,
    last4: accountNumber.slice(-4),
    accountHolderName: input.accountHolderName?.trim() || null,
    bankName: input.bankName?.trim() || null,
    branchName: input.branchName?.trim() || null,
  };
}

async function writeLog(entry: {
  vendorId: string;
  changeRequestId?: string | null;
  bankDetailId?: string | null;
  action: "requested" | "approved" | "rejected" | "cancelled" | "viewed";
  oldLast4?: string | null;
  oldIfsc?: string | null;
  newLast4?: string | null;
  newIfsc?: string | null;
  actor: ActorContext;
  reason?: string | null;
}): Promise<void> {
  await db.execute(
    `INSERT INTO vendor_bank_detail_log
       (vendor_id, change_request_id, bank_detail_id, action,
        old_account_last4, old_ifsc, new_account_last4, new_ifsc,
        actor_user_id, actor_role, reason, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.vendorId,
      entry.changeRequestId ?? null,
      entry.bankDetailId ?? null,
      entry.action,
      entry.oldLast4 ?? null,
      entry.oldIfsc ?? null,
      entry.newLast4 ?? null,
      entry.newIfsc ?? null,
      entry.actor.userId,
      entry.actor.role ?? null,
      entry.reason ?? null,
      entry.actor.ip ?? null,
      entry.actor.userAgent?.slice(0, 512) ?? null,
    ],
  );
}

/** The active account for a vendor, masked. Never returns the full number. */
export async function getActiveBankDetail(vendorId: string): Promise<{
  id: string;
  accountHolderName: string | null;
  accountNumberMasked: string;
  ifsc: string;
  bankName: string | null;
  branchName: string | null;
  effectiveFrom: string;
} | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, account_holder_name, account_number_last4, ifsc, bank_name, branch_name,
            effective_from
       FROM vendor_bank_detail
      WHERE vendor_id = ? AND status = 'active'
      ORDER BY effective_from DESC
      LIMIT 1`,
    [vendorId],
  );
  const r = (rows as any[])[0];
  if (!r) return null;
  return {
    id: String(r.id),
    accountHolderName: r.account_holder_name ?? null,
    accountNumberMasked: `XXXXXX${r.account_number_last4}`,
    ifsc: r.ifsc,
    bankName: r.bank_name ?? null,
    branchName: r.branch_name ?? null,
    effectiveFrom: r.effective_from,
  };
}

/**
 * Raise a change. This NEVER writes vendor_bank_detail — it only records an intent that
 * someone else has to agree with.
 */
export async function requestBankChange(
  vendorId: string,
  input: BankInput,
  actor: ActorContext,
): Promise<{ requestId: string; action: "create" | "update" }> {
  const [[vendor]] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM vendor_master WHERE id = ? LIMIT 1`,
    [vendorId],
  );
  if (!vendor) throw new VendorBankError("Vendor not found", 404);

  const v = normalise(input);

  // One open request at a time. Two pending changes on the same vendor mean whichever is
  // approved second silently wins, and the loser leaves no trace of having been overtaken.
  const [[open]] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM vendor_bank_change_request
      WHERE vendor_id = ? AND status = 'pending' LIMIT 1`,
    [vendorId],
  );
  if (open) {
    throw new VendorBankError(
      "This vendor already has a pending bank change awaiting approval. Approve, reject or cancel it first.",
      409,
    );
  }

  const current = await getActiveBankDetail(vendorId);
  const [[currentRow]] = await db.execute<RowDataPacket[]>(
    `SELECT id, account_number_last4, ifsc FROM vendor_bank_detail
      WHERE vendor_id = ? AND status = 'active' LIMIT 1`,
    [vendorId],
  );

  const action: "create" | "update" = current ? "update" : "create";
  const requestId = randomUUID();

  await db.execute(
    `INSERT INTO vendor_bank_change_request
       (id, vendor_id, action, previous_detail_id, account_holder_name,
        account_number_encrypted, account_number_last4, account_number_blind_index,
        ifsc, bank_name, branch_name, status, reason, requested_by, requested_by_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      requestId,
      vendorId,
      action,
      (currentRow as any)?.id ?? null,
      v.accountHolderName,
      encryptField(v.accountNumber),
      v.last4,
      blindIndex(v.accountNumber),
      v.ifsc,
      v.bankName,
      v.branchName,
      input.reason?.trim() || null,
      actor.userId,
      actor.role ?? null,
    ],
  );

  await writeLog({
    vendorId,
    changeRequestId: requestId,
    action: "requested",
    oldLast4: (currentRow as any)?.account_number_last4 ?? null,
    oldIfsc: (currentRow as any)?.ifsc ?? null,
    newLast4: v.last4,
    newIfsc: v.ifsc,
    actor,
    reason: input.reason?.trim() || null,
  });

  return { requestId, action };
}

/**
 * Approve a pending change and make it the vendor's account.
 *
 * The approver must not be the requester. That check is here, server-side, and not only
 * in the UI — a route guard proves a role, it cannot prove two different people.
 */
export async function approveBankChange(
  requestId: string,
  actor: ActorContext,
  decisionReason?: string | null,
): Promise<{ bankDetailId: string }> {
  const [[req]] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM vendor_bank_change_request WHERE id = ? LIMIT 1`,
    [requestId],
  );
  if (!req) throw new VendorBankError("Bank change request not found", 404);
  if ((req as any).status !== "pending") {
    throw new VendorBankError(`Request is already ${(req as any).status}`, 409);
  }
  if (String((req as any).requested_by) === String(actor.userId)) {
    throw new VendorBankError(
      "A bank change must be approved by someone other than the person who raised it.",
      403,
    );
  }

  const vendorId = String((req as any).vendor_id);

  const [[currentRow]] = await db.execute<RowDataPacket[]>(
    `SELECT id, account_number_last4, ifsc FROM vendor_bank_detail
      WHERE vendor_id = ? AND status = 'active' LIMIT 1`,
    [vendorId],
  );

  // Claim the request first. If a second approver got here in the same moment, this
  // affects zero rows and we stop before writing a duplicate account.
  const [claim] = await db.execute(
    `UPDATE vendor_bank_change_request
        SET status = 'approved', decided_by = ?, decided_by_role = ?, decided_at = NOW(),
            decision_reason = ?
      WHERE id = ? AND status = 'pending'`,
    [actor.userId, actor.role ?? null, decisionReason?.trim() || null, requestId],
  );
  if (!(claim as unknown as ResultSetHeader).affectedRows) {
    throw new VendorBankError("Request was already decided by someone else", 409);
  }

  // Supersede rather than update, so the log points at a real row on both sides.
  if (currentRow) {
    await db.execute(
      `UPDATE vendor_bank_detail
          SET status = 'superseded', superseded_at = NOW()
        WHERE id = ? AND status = 'active'`,
      [(currentRow as any).id],
    );
  }

  const detailId = randomUUID();
  await db.execute(
    `INSERT INTO vendor_bank_detail
       (id, vendor_id, account_holder_name, account_number_encrypted,
        account_number_last4, account_number_blind_index, ifsc, bank_name, branch_name,
        status, effective_from, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), ?)`,
    [
      detailId,
      vendorId,
      (req as any).account_holder_name ?? null,
      (req as any).account_number_encrypted,
      (req as any).account_number_last4,
      (req as any).account_number_blind_index ?? null,
      (req as any).ifsc,
      (req as any).bank_name ?? null,
      (req as any).branch_name ?? null,
      actor.userId,
    ],
  );

  await writeLog({
    vendorId,
    changeRequestId: requestId,
    bankDetailId: detailId,
    action: "approved",
    oldLast4: (currentRow as any)?.account_number_last4 ?? null,
    oldIfsc: (currentRow as any)?.ifsc ?? null,
    newLast4: (req as any).account_number_last4,
    newIfsc: (req as any).ifsc,
    actor,
    reason: decisionReason?.trim() || null,
  });

  return { bankDetailId: detailId };
}

/** Reject a pending change. Logged, because a refused redirection attempt is evidence. */
export async function rejectBankChange(
  requestId: string,
  actor: ActorContext,
  decisionReason?: string | null,
): Promise<void> {
  const [[req]] = await db.execute<RowDataPacket[]>(
    `SELECT vendor_id, status, requested_by, account_number_last4, ifsc
       FROM vendor_bank_change_request WHERE id = ? LIMIT 1`,
    [requestId],
  );
  if (!req) throw new VendorBankError("Bank change request not found", 404);
  if ((req as any).status !== "pending") {
    throw new VendorBankError(`Request is already ${(req as any).status}`, 409);
  }

  const isRequester = String((req as any).requested_by) === String(actor.userId);
  const [res] = await db.execute(
    `UPDATE vendor_bank_change_request
        SET status = ?, decided_by = ?, decided_by_role = ?, decided_at = NOW(),
            decision_reason = ?
      WHERE id = ? AND status = 'pending'`,
    [
      // Withdrawing your own request is a cancellation, not a rejection. Recording it as
      // a rejection would put a decision in the log that nobody independent ever made.
      isRequester ? "cancelled" : "rejected",
      actor.userId,
      actor.role ?? null,
      decisionReason?.trim() || null,
      requestId,
    ],
  );
  if (!(res as unknown as ResultSetHeader).affectedRows) {
    throw new VendorBankError("Request was already decided by someone else", 409);
  }

  await writeLog({
    vendorId: String((req as any).vendor_id),
    changeRequestId: requestId,
    action: isRequester ? "cancelled" : "rejected",
    newLast4: (req as any).account_number_last4,
    newIfsc: (req as any).ifsc,
    actor,
    reason: decisionReason?.trim() || null,
  });
}

/** Pending requests, newest first. Masked. */
export async function listPendingRequests(vendorId?: string): Promise<any[]> {
  const params: unknown[] = [];
  let where = `WHERE r.status = 'pending'`;
  if (vendorId) {
    where += ` AND r.vendor_id = ?`;
    params.push(vendorId);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, r.vendor_id, v.vendor_code, v.vendor_name, r.action,
            r.account_holder_name, r.account_number_last4, r.ifsc, r.bank_name,
            r.branch_name, r.reason, r.requested_by, r.requested_by_role, r.requested_at,
            p.account_number_last4 AS previous_last4, p.ifsc AS previous_ifsc
       FROM vendor_bank_change_request r
       JOIN vendor_master v ON v.id = r.vendor_id
       LEFT JOIN vendor_bank_detail p ON p.id = r.previous_detail_id
       ${where}
      ORDER BY r.requested_at ASC`,
    params,
  );
  return (rows as any[]).map((r) => ({
    ...r,
    account_number_masked: `XXXXXX${r.account_number_last4}`,
    previous_account_masked: r.previous_last4 ? `XXXXXX${r.previous_last4}` : null,
  }));
}

/** The change log for one vendor — the drill-down's audit section. */
export async function getBankChangeLog(vendorId: string, limit = 50): Promise<any[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.action, l.old_account_last4, l.old_ifsc, l.new_account_last4,
            l.new_ifsc, l.actor_user_id, l.actor_role, l.reason, l.ip_address,
            l.created_at, u.email AS actor_email
       FROM vendor_bank_detail_log l
       LEFT JOIN auth_user u ON u.id = l.actor_user_id
      WHERE l.vendor_id = ?
      ORDER BY l.created_at DESC
      LIMIT ${Number(limit)}`,
    [vendorId],
  );
  return rows as any[];
}
