import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordFinanceApprovalEvent } from "../../shared/financeApprovalEvent.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
import { getIstDateString } from "../../utils/dateUtils.js";
import { inboxService } from "../inbox/inbox.service.js";
import { refuse } from "../process-pnl/finance-error.js";
import { journalService } from "./journal.service.js";
import { getJournalVoucher } from "./journal-voucher.queries.js";
import { computeJvPermissions, holdsAnyRole, type JvActor } from "./journal-voucher.roles.js";
import {
  JV_BLOCKED_PAYABLE_ACCOUNT_NAMES,
  JV_MIN_NARRATION_LENGTH,
  assertSubmittable,
  normalizeJournalVoucherInput,
  totalsOf,
  type JvInput,
  type JvStatus,
} from "./journal-voucher.validation.js";

const ENTITY_TYPE = "journal_voucher";
const AUDIT_ENTITY_TYPE = "JOURNAL_VOUCHER";
const VOUCHER_NUMBER_RETRIES = 3;
const PRIMARY_ROLE = (actor: JvActor) => actor.roles[0] ?? "unknown";

type Connection = PoolConnection;

async function audit(connection: Connection, action: string, voucherId: string, actor: JvActor, summary: Record<string, unknown>) {
  await connection.execute(
    `INSERT INTO finance_action_audit_log (id, action_type, entity_type, entity_id, actor_user_id, actor_role, change_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), action, AUDIT_ENTITY_TYPE, voucherId, actor.id, PRIMARY_ROLE(actor), JSON.stringify(summary)],
  );
}

async function recordEvent(
  connection: Connection,
  voucherId: string,
  actor: JvActor,
  event: { action: string; fromStatus: JvStatus | null; toStatus: JvStatus; decision?: string; remarks?: string | null },
) {
  await recordFinanceApprovalEvent(
    {
      entityType: ENTITY_TYPE,
      entityId: voucherId,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      decision: event.decision ?? null,
      actorUserId: actor.id,
      actorRole: PRIMARY_ROLE(actor),
      remarks: event.remarks ?? null,
    },
    connection,
  );
}

async function withTransaction<T>(work: (connection: Connection) => Promise<T>): Promise<T> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Live-master checks that pure validation cannot do: every account exists, is active and is not
 *  a control account owned by another sub-ledger; dimensions exist and agree with each other. */
async function assertMastersValid(connection: Connection, input: JvInput) {
  const subHeadIds = [...new Set(input.lines.filter((l) => l.accountType === "expense_sub_head").map((l) => l.accountId))];
  if (subHeadIds.length) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT sh.id FROM finance_expense_sub_head_master sh
         JOIN finance_expense_head_master h ON h.id = sh.head_id
        WHERE sh.active_status = 1 AND h.active_status = 1 AND sh.id IN (${subHeadIds.map(() => "?").join(",")})`,
      subHeadIds,
    );
    if ((rows as RowDataPacket[]).length !== subHeadIds.length) {
      throw refuse(422, "JV_ACCOUNT_INACTIVE", "One of the expense heads is missing or inactive — pick an active expense head.");
    }
  }

  const payableIds = [...new Set(input.lines.filter((l) => l.accountType === "payable_account").map((l) => l.accountId))];
  if (payableIds.length) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, account_name FROM payable_account_master WHERE active_status = 1 AND id IN (${payableIds.map(() => "?").join(",")})`,
      payableIds,
    );
    if ((rows as RowDataPacket[]).length !== payableIds.length) {
      throw refuse(422, "JV_ACCOUNT_INACTIVE", "One of the ledger heads is missing or inactive — pick an active ledger head.");
    }
    const blocked = (rows as RowDataPacket[]).find((r) => (JV_BLOCKED_PAYABLE_ACCOUNT_NAMES as readonly string[]).includes(String(r.account_name)));
    if (blocked) {
      throw refuse(422, "JV_CONTROL_ACCOUNT", `"${blocked.account_name}" is a control account moved only by its own vouchers — it cannot be used in a journal voucher.`);
    }
  }

  if (input.branchId) {
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id FROM branch_master WHERE id = ? AND active_status = 1`, [input.branchId]);
    if (!(rows as RowDataPacket[]).length) throw refuse(422, "JV_BRANCH_INVALID", "The selected branch is missing or inactive.");
  }
  if (input.costCentreId) {
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id, branch_id FROM cost_centre_master WHERE id = ? AND active_status = 1`, [input.costCentreId]);
    const cc = (rows as RowDataPacket[])[0];
    if (!cc) throw refuse(422, "JV_COST_CENTRE_INVALID", "The selected cost centre is missing or inactive.");
    if (input.branchId && cc.branch_id && String(cc.branch_id) !== input.branchId) {
      throw refuse(422, "JV_COST_CENTRE_BRANCH_MISMATCH", "The selected cost centre does not belong to the selected branch.");
    }
  }
  if (input.processId) {
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE id = ? AND active_status = 1`, [input.processId]);
    if (!(rows as RowDataPacket[]).length) throw refuse(422, "JV_PROCESS_INVALID", "The selected process is missing or inactive.");
  }
}

async function replaceLines(connection: Connection, voucherId: string, input: JvInput) {
  await connection.execute(`DELETE FROM journal_voucher_line WHERE journal_voucher_id = ?`, [voucherId]);
  let order = 0;
  for (const line of input.lines) {
    await connection.execute(
      `INSERT INTO journal_voucher_line (id, journal_voucher_id, line_order, account_type, account_id, debit_amount, credit_amount, narration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), voucherId, order++, line.accountType, line.accountId, line.debitAmount, line.creditAmount, line.narration],
    );
  }
}

async function lockVoucher(connection: Connection, id: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT jv.*, DATE_FORMAT(jv.voucher_date, '%Y-%m-%d') AS voucher_date_str FROM journal_voucher jv WHERE jv.id = ? FOR UPDATE`,
    [id],
  );
  const voucher = (rows as RowDataPacket[])[0] as any;
  if (!voucher) throw refuse(404, "JV_NOT_FOUND", "Journal voucher not found.");
  return voucher;
}

async function loadInputFromDb(connection: Connection, voucher: any): Promise<JvInput> {
  const [lines] = await connection.execute<RowDataPacket[]>(
    `SELECT account_type, account_id, debit_amount, credit_amount, narration
       FROM journal_voucher_line WHERE journal_voucher_id = ? ORDER BY line_order ASC`,
    [voucher.id],
  );
  return {
    voucherDate: voucher.voucher_date_str,
    jvType: voucher.jv_type,
    narration: voucher.narration,
    referenceNo: voucher.reference_no ?? null,
    branchId: voucher.branch_id ?? null,
    costCentreId: voucher.cost_centre_id ?? null,
    processId: voucher.process_id ?? null,
    lines: (lines as RowDataPacket[]).map((l) => ({
      accountType: l.account_type,
      accountId: String(l.account_id),
      debitAmount: Number(l.debit_amount),
      creditAmount: Number(l.credit_amount),
      narration: l.narration ?? null,
    })),
  };
}

function requireStatus(voucher: any, allowed: JvStatus[], verb: string) {
  if (!allowed.includes(voucher.status)) {
    throw refuse(409, "JV_WRONG_STATUS", `A voucher that is "${String(voucher.status).replace("_", " ")}" cannot be ${verb}.`);
  }
}

function requireReason(reason: unknown, what: string): string {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < JV_MIN_NARRATION_LENGTH) throw refuse(400, "JV_REASON_REQUIRED", `A reason is required to ${what}.`);
  return text;
}

async function nextVoucherNumber(connection: Connection, voucherDate: string, branchId: string | null): Promise<string> {
  let branchCode = "HQ";
  if (branchId) {
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT branch_code FROM branch_master WHERE id = ?`, [branchId]);
    branchCode = String((rows as RowDataPacket[])[0]?.branch_code ?? "HQ").replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "HQ";
  }
  const prefix = `JV/${branchCode}/${voucherDate.slice(0, 7).replace("-", "")}/`;
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(voucher_number, '/', -1) AS UNSIGNED)), 0) AS last_seq
       FROM journal_voucher WHERE voucher_number LIKE ?`,
    [`${prefix.replace(/[\\%_]/g, "\\$&")}%`],
  );
  return `${prefix}${String(Number((rows as RowDataPacket[])[0]?.last_seq ?? 0) + 1).padStart(4, "0")}`;
}

async function notifyApprovers(voucherId: string, voucherNumber: string, totalAmount: number, narration: string, makerId: string) {
  const recipients = new Set<string>();
  for (const role of ["finance_head", "ceo"]) {
    for (const userId of await resolveRoleHolderUserIds(role, null).catch(() => [])) recipients.add(userId);
  }
  recipients.delete(makerId);
  for (const userId of recipients) {
    await inboxService
      .createItem({
        user_id: userId,
        type: "journal_voucher_pending_approval",
        title: `[ACTION REQUIRED] Journal Voucher ${voucherNumber} — ₹${totalAmount.toFixed(2)}`,
        description: narration.slice(0, 200),
        entity_type: ENTITY_TYPE,
        entity_id: voucherId,
        action_url: "/finance/ledger?tab=journal",
        priority: "high",
      })
      .catch(() => undefined);
  }
}

async function notifyMaker(voucher: any, title: string, description: string) {
  await inboxService
    .createItem({
      user_id: voucher.created_by,
      type: "journal_voucher_decision",
      title,
      description: description.slice(0, 200),
      entity_type: ENTITY_TYPE,
      entity_id: voucher.id,
      action_url: "/finance/ledger?tab=journal",
      priority: "normal",
    })
    .catch(() => undefined);
}

async function closeApprovalAlerts(voucherId: string) {
  await inboxService.resolveItems({ entity_type: ENTITY_TYPE, entity_id: voucherId, types: ["journal_voucher_pending_approval"] }).catch(() => 0);
}

async function logAfterCommit(actor: JvActor, action: string, voucherId: string, summary: Record<string, unknown>) {
  await logSensitiveAction({
    actor_user_id: actor.id,
    actor_role: PRIMARY_ROLE(actor),
    action_type: action,
    module_key: "FINANCE",
    entity_type: ENTITY_TYPE,
    entity_id: voucherId,
    change_summary: summary,
  }).catch(() => undefined);
}

export const journalVoucherService = {
  async create(rawBody: unknown, actor: JvActor) {
    const input = normalizeJournalVoucherInput(rawBody, getIstDateString());
    const id = randomUUID();
    const { debit } = totalsOf(input.lines);

    await withTransaction(async (connection) => {
      await assertMastersValid(connection, input);
      await connection.execute(
        `INSERT INTO journal_voucher
           (id, voucher_date, jv_type, narration, reference_no, branch_id, cost_centre_id, process_id, total_amount, line_count, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [id, input.voucherDate, input.jvType, input.narration, input.referenceNo, input.branchId, input.costCentreId, input.processId, debit, input.lines.length, actor.id],
      );
      await replaceLines(connection, id, input);
      await recordEvent(connection, id, actor, { action: "create", fromStatus: null, toStatus: "draft" });
      await audit(connection, "JOURNAL_VOUCHER_CREATED", id, actor, { total: debit, lines: input.lines.length, jvType: input.jvType });
    });
    await logAfterCommit(actor, "JOURNAL_VOUCHER_CREATED", id, { total: debit, jvType: input.jvType });
    return getJournalVoucher(id, actor);
  },

  async update(id: string, rawBody: unknown, actor: JvActor) {
    const input = normalizeJournalVoucherInput(rawBody, getIstDateString());
    const { debit } = totalsOf(input.lines);

    await withTransaction(async (connection) => {
      const voucher = await lockVoucher(connection, id);
      if (!computeJvPermissions(voucher, actor).canEdit) {
        throw refuse(403, "JV_EDIT_FORBIDDEN", "Only the maker can edit a draft or rejected voucher, and only while it is not with an approver.");
      }
      await assertMastersValid(connection, input);
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE journal_voucher
            SET voucher_date = ?, jv_type = ?, narration = ?, reference_no = ?, branch_id = ?, cost_centre_id = ?, process_id = ?,
                total_amount = ?, line_count = ?, status = 'draft'
          WHERE id = ? AND status = ?`,
        [input.voucherDate, input.jvType, input.narration, input.referenceNo, input.branchId, input.costCentreId, input.processId, debit, input.lines.length, id, voucher.status],
      );
      if (result.affectedRows !== 1) throw refuse(409, "JV_CHANGED", "The voucher changed while you were editing — reload and try again.");
      await replaceLines(connection, id, input);
      await recordEvent(connection, id, actor, {
        action: voucher.status === "rejected" ? "revise" : "edit",
        fromStatus: voucher.status,
        toStatus: "draft",
      });
      await audit(connection, "JOURNAL_VOUCHER_UPDATED", id, actor, { total: debit, lines: input.lines.length });
    });
    return getJournalVoucher(id, actor);
  },

  async remove(id: string, actor: JvActor) {
    await withTransaction(async (connection) => {
      const voucher = await lockVoucher(connection, id);
      if (!computeJvPermissions(voucher, actor).canDelete) {
        throw refuse(403, "JV_DELETE_FORBIDDEN", "Only the maker can delete their own draft.");
      }
      await connection.execute(`DELETE FROM journal_voucher_line WHERE journal_voucher_id = ?`, [id]);
      await connection.execute(`DELETE FROM journal_voucher WHERE id = ? AND status = 'draft'`, [id]);
      await audit(connection, "JOURNAL_VOUCHER_DELETED", id, actor, { total: Number(voucher.total_amount) });
    });
    await logAfterCommit(actor, "JOURNAL_VOUCHER_DELETED", id, {});
    return { id };
  },

  async submit(id: string, actor: JvActor) {
    const submitted = await withTransaction(async (connection) => {
      const voucher = await lockVoucher(connection, id);
      if (!computeJvPermissions(voucher, actor).canSubmit) {
        throw refuse(403, "JV_SUBMIT_FORBIDDEN", "Only the maker can submit their own draft.");
      }
      const input = await loadInputFromDb(connection, voucher);
      if (input.voucherDate > getIstDateString()) throw refuse(400, "JV_FUTURE_DATE", "Voucher date cannot be in the future.");
      assertSubmittable(input.lines);
      await assertMastersValid(connection, input);

      let voucherNumber: string | null = voucher.voucher_number ?? null;
      for (let attempt = 0; !voucherNumber && attempt < VOUCHER_NUMBER_RETRIES; attempt++) {
        const candidate = await nextVoucherNumber(connection, input.voucherDate, input.branchId);
        try {
          await connection.execute(`UPDATE journal_voucher SET voucher_number = ? WHERE id = ? AND voucher_number IS NULL`, [candidate, id]);
          voucherNumber = candidate;
        } catch (error) {
          if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
        }
      }
      if (!voucherNumber) throw refuse(409, "JV_NUMBER_CONTENTION", "Could not allocate a voucher number — please submit again.");

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE journal_voucher SET status = 'pending_approval', submitted_by = ?, submitted_at = NOW() WHERE id = ? AND status = 'draft'`,
        [actor.id, id],
      );
      if (result.affectedRows !== 1) throw refuse(409, "JV_CHANGED", "The voucher changed — reload and try again.");
      await recordEvent(connection, id, actor, { action: "submit", fromStatus: "draft", toStatus: "pending_approval" });
      await audit(connection, "JOURNAL_VOUCHER_SUBMITTED", id, actor, { voucherNumber, total: Number(voucher.total_amount) });
      return { voucherNumber, total: Number(voucher.total_amount), narration: String(voucher.narration) };
    });

    await notifyApprovers(id, submitted.voucherNumber, submitted.total, submitted.narration, actor.id);
    await logAfterCommit(actor, "JOURNAL_VOUCHER_SUBMITTED", id, { voucherNumber: submitted.voucherNumber, total: submitted.total });
    return getJournalVoucher(id, actor);
  },

  async approve(id: string, note: unknown, actor: JvActor) {
    const approvalNote = typeof note === "string" && note.trim() ? note.trim() : null;
    const posted = await withTransaction(async (connection) => {
      const voucher = await lockVoucher(connection, id);
      requireStatus(voucher, ["pending_approval"], "approved");
      if (!holdsAnyRole(actor.roles, ["finance_head", "ceo", "super_admin"])) {
        throw refuse(403, "JV_APPROVE_FORBIDDEN", "Only Finance Head or CEO can approve a journal voucher.");
      }
      if (String(voucher.created_by) === actor.id) {
        throw refuse(403, "JV_SELF_APPROVAL", "You cannot approve a voucher you made — a different approver must post it.");
      }

      const input = await loadInputFromDb(connection, voucher);
      assertSubmittable(input.lines);
      await assertMastersValid(connection, input);

      const { journalEntryId } = await journalService.post(connection, {
        entryDate: input.voucherDate,
        narration: `${voucher.voucher_number} — ${input.narration}`,
        sourceType: "manual",
        sourceId: id,
        postedBy: actor.id,
        branchId: input.branchId,
        costCentreId: input.costCentreId,
        processId: input.processId,
        lines: input.lines.map((line) => ({
          accountType: line.accountType,
          accountId: line.accountId,
          debitAmount: line.debitAmount || undefined,
          creditAmount: line.creditAmount || undefined,
          narration: line.narration,
        })),
      });

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE journal_voucher SET status = 'posted', approved_by = ?, approved_at = NOW(), approval_note = ?, journal_entry_id = ?
          WHERE id = ? AND status = 'pending_approval'`,
        [actor.id, approvalNote, journalEntryId, id],
      );
      if (result.affectedRows !== 1) throw refuse(409, "JV_CHANGED", "The voucher changed — reload and try again.");
      await recordEvent(connection, id, actor, { action: "approve", fromStatus: "pending_approval", toStatus: "posted", decision: "approve", remarks: approvalNote });
      await audit(connection, "JOURNAL_VOUCHER_POSTED", id, actor, { voucherNumber: voucher.voucher_number, journalEntryId, total: Number(voucher.total_amount) });
      return { voucher, journalEntryId };
    });

    await closeApprovalAlerts(id);
    await notifyMaker(posted.voucher, `Journal Voucher ${posted.voucher.voucher_number} posted`, approvalNote ?? "Approved and posted to the general ledger.");
    await logAfterCommit(actor, "JOURNAL_VOUCHER_POSTED", id, { voucherNumber: posted.voucher.voucher_number, journalEntryId: posted.journalEntryId });
    return getJournalVoucher(id, actor);
  },

  async reject(id: string, reason: unknown, actor: JvActor) {
    const text = requireReason(reason, "reject a voucher");
    const voucherRow = await withTransaction(async (connection) => {
      const voucher = await lockVoucher(connection, id);
      requireStatus(voucher, ["pending_approval"], "rejected");
      if (!holdsAnyRole(actor.roles, ["finance_head", "ceo", "super_admin"])) {
        throw refuse(403, "JV_REJECT_FORBIDDEN", "Only Finance Head or CEO can reject a journal voucher.");
      }
      if (String(voucher.created_by) === actor.id) {
        throw refuse(403, "JV_SELF_APPROVAL", "You cannot decide on a voucher you made — withdraw it instead.");
      }
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE journal_voucher SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ? WHERE id = ? AND status = 'pending_approval'`,
        [actor.id, text, id],
      );
      if (result.affectedRows !== 1) throw refuse(409, "JV_CHANGED", "The voucher changed — reload and try again.");
      await recordEvent(connection, id, actor, { action: "reject", fromStatus: "pending_approval", toStatus: "rejected", decision: "reject", remarks: text });
      await audit(connection, "JOURNAL_VOUCHER_REJECTED", id, actor, { reason: text });
      return voucher;
    });

    await closeApprovalAlerts(id);
    await notifyMaker(voucherRow, `Journal Voucher ${voucherRow.voucher_number} was rejected`, text);
    await logAfterCommit(actor, "JOURNAL_VOUCHER_REJECTED", id, { reason: text });
    return getJournalVoucher(id, actor);
  },

  async withdraw(id: string, reason: unknown, actor: JvActor) {
    const text = requireReason(reason, "withdraw a voucher");
    await withTransaction(async (connection) => {
      const voucher = await lockVoucher(connection, id);
      requireStatus(voucher, ["pending_approval"], "withdrawn");
      if (!computeJvPermissions(voucher, actor).canWithdraw) {
        throw refuse(403, "JV_WITHDRAW_FORBIDDEN", "Only the maker, or Finance Head, can withdraw a submitted voucher.");
      }
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE journal_voucher SET status = 'withdrawn', withdrawn_by = ?, withdrawn_at = NOW(), withdrawal_reason = ? WHERE id = ? AND status = 'pending_approval'`,
        [actor.id, text, id],
      );
      if (result.affectedRows !== 1) throw refuse(409, "JV_CHANGED", "The voucher changed — reload and try again.");
      await recordEvent(connection, id, actor, { action: "withdraw", fromStatus: "pending_approval", toStatus: "withdrawn", decision: "withdraw", remarks: text });
      await audit(connection, "JOURNAL_VOUCHER_WITHDRAWN", id, actor, { reason: text });
    });
    await closeApprovalAlerts(id);
    await logAfterCommit(actor, "JOURNAL_VOUCHER_WITHDRAWN", id, { reason: text });
    return getJournalVoucher(id, actor);
  },

  async reverse(id: string, reason: unknown, actor: JvActor) {
    const text = requireReason(reason, "reverse a posted voucher");
    const reversal = await withTransaction(async (connection) => {
      const voucher = await lockVoucher(connection, id);
      requireStatus(voucher, ["posted"], "reversed");
      if (!computeJvPermissions(voucher, actor).canReverse) {
        throw refuse(403, "JV_REVERSE_FORBIDDEN", "Only Finance Head or CEO can reverse a posted voucher.");
      }
      if (!voucher.journal_entry_id) throw refuse(409, "JV_NOT_POSTED", "This voucher has no ledger entry to reverse.");

      const { reversalEntryId } = await journalService.reverse(connection, String(voucher.journal_entry_id), actor.id, `${voucher.voucher_number}: ${text}`);
      // journalService.reverse() flags only the ORIGINAL as reversed, and every ledger report
      // filters on reversed_by_entry_id IS NULL — so the contra entry stayed counted alone and
      // left the accounts at minus the original. Flagging the contra too makes the pair net to
      // zero in every report.
      await connection.execute(`UPDATE journal_entry SET reversed_by_entry_id = ? WHERE id = ?`, [voucher.journal_entry_id, reversalEntryId]);

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE journal_voucher SET status = 'reversed', reversal_entry_id = ?, reversed_by = ?, reversed_at = NOW(), reversal_reason = ?
          WHERE id = ? AND status = 'posted'`,
        [reversalEntryId, actor.id, text, id],
      );
      if (result.affectedRows !== 1) throw refuse(409, "JV_CHANGED", "The voucher changed — reload and try again.");
      await recordEvent(connection, id, actor, { action: "reverse", fromStatus: "posted", toStatus: "reversed", decision: "reverse", remarks: text });
      await audit(connection, "JOURNAL_VOUCHER_REVERSED", id, actor, { reason: text, reversalEntryId });
      return { voucherNumber: String(voucher.voucher_number), reversalEntryId };
    });

    await logAfterCommit(actor, "JOURNAL_VOUCHER_REVERSED", id, { reason: text, ...reversal });
    return getJournalVoucher(id, actor);
  },
};
