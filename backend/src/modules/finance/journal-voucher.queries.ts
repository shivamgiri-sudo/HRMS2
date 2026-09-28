import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { listFinanceApprovalEvents } from "../../shared/financeApprovalEvent.js";
import { refuse } from "../process-pnl/finance-error.js";
import { computeJvPermissions, holdsAnyRole, type JvActor } from "./journal-voucher.roles.js";
import {
  JV_BLOCKED_PAYABLE_ACCOUNT_NAMES,
  JV_STATUSES,
  JV_TYPES,
  type JvAccountType,
  type JvStatus,
  type JvType,
} from "./journal-voucher.validation.js";

export type JvListFilters = {
  status?: JvStatus;
  jvType?: JvType;
  branchId?: string;
  costCentreId?: string;
  processId?: string;
  from?: string;
  to?: string;
  q?: string;
  /** "<account_type>:<account_id>" — vouchers that have a line on this account. */
  accountKey?: string;
  createdBy?: string;
  minAmount?: number;
  maxAmount?: number;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

const SORT_COLUMNS: Record<string, string> = {
  voucherDate: "jv.voucher_date",
  voucherNumber: "jv.voucher_number",
  amount: "jv.total_amount",
  status: "jv.status",
  createdAt: "jv.created_at",
  submittedAt: "jv.submitted_at",
};

export const JV_DEFAULT_PAGE_SIZE = 25;
export const JV_MAX_PAGE_SIZE = 100;
const CSV_ROW_LIMIT = 5000;

const money = (v: unknown) => Math.round((Number(v ?? 0) + Number.EPSILON) * 100) / 100;
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function resolveActorNames(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT au.id, COALESCE(NULLIF(TRIM(e.full_name), ''), au.email) AS name, e.employee_code
       FROM auth_user au
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
      WHERE au.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  for (const r of rows as RowDataPacket[]) {
    names.set(String(r.id), r.employee_code ? `${r.name} (${r.employee_code})` : String(r.name));
  }
  return names;
}

async function resolveDimensionNames(rows: { branch_id?: unknown; cost_centre_id?: unknown; process_id?: unknown }[]) {
  const fetchNames = async (table: string, nameColumn: string, ids: string[]) => {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const [found] = await db.execute<RowDataPacket[]>(
      `SELECT id, ${nameColumn} AS name FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    for (const r of found as RowDataPacket[]) out.set(String(r.id), String(r.name));
    return out;
  };
  const uniq = (pick: (r: (typeof rows)[number]) => unknown) => [...new Set(rows.map(pick).filter(Boolean).map(String))];
  const [branches, costCentres, processes] = await Promise.all([
    fetchNames("branch_master", "branch_name", uniq((r) => r.branch_id)),
    fetchNames("cost_centre_master", "cost_centre_name", uniq((r) => r.cost_centre_id)),
    fetchNames("process_master", "process_name", uniq((r) => r.process_id)),
  ]);
  return { branches, costCentres, processes };
}

export type JvAccountRef = { accountType: JvAccountType | string; accountId: string };

export async function resolveJvAccountNames(refs: JvAccountRef[]): Promise<Map<string, { label: string; hint: string }>> {
  const names = new Map<string, { label: string; hint: string }>();
  const idsOf = (type: string) => [...new Set(refs.filter((r) => r.accountType === type).map((r) => String(r.accountId)))];

  const subHeadIds = idsOf("expense_sub_head");
  if (subHeadIds.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sh.id, h.head_name, sh.sub_head_name
         FROM finance_expense_sub_head_master sh
         JOIN finance_expense_head_master h ON h.id = sh.head_id
        WHERE sh.id IN (${subHeadIds.map(() => "?").join(",")})`,
      subHeadIds,
    );
    for (const r of rows as RowDataPacket[]) {
      names.set(`expense_sub_head:${r.id}`, { label: `${r.head_name} / ${r.sub_head_name}`, hint: "Expense head" });
    }
  }

  const payableIds = idsOf("payable_account");
  if (payableIds.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, account_name, account_type FROM payable_account_master WHERE id IN (${payableIds.map(() => "?").join(",")})`,
      payableIds,
    );
    for (const r of rows as RowDataPacket[]) {
      names.set(`payable_account:${r.id}`, { label: String(r.account_name), hint: `Ledger head · ${r.account_type}` });
    }
  }
  return names;
}

function buildWhere(filters: JvListFilters, actor: JvActor, options: { ignoreStatus?: boolean } = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // A draft is its author's working copy; supervisors (super_admin) can still see it.
  if (holdsAnyRole(actor.roles, ["super_admin"])) {
    conditions.push("1=1");
  } else {
    conditions.push("(jv.status <> 'draft' OR jv.created_by = ?)");
    params.push(actor.id);
  }

  if (filters.status && !options.ignoreStatus) { conditions.push("jv.status = ?"); params.push(filters.status); }
  if (filters.jvType) { conditions.push("jv.jv_type = ?"); params.push(filters.jvType); }
  if (filters.branchId) { conditions.push("jv.branch_id = ?"); params.push(filters.branchId); }
  if (filters.costCentreId) { conditions.push("jv.cost_centre_id = ?"); params.push(filters.costCentreId); }
  if (filters.processId) { conditions.push("jv.process_id = ?"); params.push(filters.processId); }
  if (filters.from) { conditions.push("jv.voucher_date >= ?"); params.push(filters.from); }
  if (filters.to) { conditions.push("jv.voucher_date <= ?"); params.push(filters.to); }
  if (filters.createdBy) { conditions.push("jv.created_by = ?"); params.push(filters.createdBy); }
  if (filters.minAmount !== undefined) { conditions.push("jv.total_amount >= ?"); params.push(filters.minAmount); }
  if (filters.maxAmount !== undefined) { conditions.push("jv.total_amount <= ?"); params.push(filters.maxAmount); }
  if (filters.q) {
    const like = `%${escapeLike(filters.q.trim())}%`;
    conditions.push("(jv.voucher_number LIKE ? OR jv.narration LIKE ? OR jv.reference_no LIKE ?)");
    params.push(like, like, like);
  }
  if (filters.accountKey) {
    const [accountType, accountId] = filters.accountKey.split(":");
    conditions.push(
      `EXISTS (SELECT 1 FROM journal_voucher_line jvl WHERE jvl.journal_voucher_id = jv.id AND jvl.account_type = ? AND jvl.account_id = ?)`,
    );
    params.push(accountType, accountId);
  }
  return { where: conditions.join(" AND "), params };
}

const LIST_COLUMNS = `jv.id, jv.voucher_number, DATE_FORMAT(jv.voucher_date, '%Y-%m-%d') AS voucher_date, jv.jv_type,
  jv.narration, jv.reference_no, jv.branch_id, jv.cost_centre_id, jv.process_id, jv.total_amount, jv.line_count,
  jv.status, jv.created_by, jv.created_at, jv.submitted_at, jv.approved_by, jv.approved_at, jv.journal_entry_id,
  CASE WHEN jv.status = 'pending_approval' THEN TIMESTAMPDIFF(HOUR, jv.submitted_at, NOW()) END AS pending_hours`;

async function decorate(rows: RowDataPacket[], actor: JvActor) {
  const [dimensions, actors] = await Promise.all([
    resolveDimensionNames(rows as any),
    resolveActorNames(rows.flatMap((r) => [r.created_by, r.approved_by])),
  ]);
  return rows.map((r) => ({
    id: String(r.id),
    voucherNumber: r.voucher_number ?? null,
    voucherDate: r.voucher_date as string,
    jvType: r.jv_type as JvType,
    narration: r.narration as string,
    referenceNo: r.reference_no ?? null,
    branchId: r.branch_id ?? null,
    branchName: r.branch_id ? dimensions.branches.get(String(r.branch_id)) ?? null : null,
    costCentreId: r.cost_centre_id ?? null,
    costCentreName: r.cost_centre_id ? dimensions.costCentres.get(String(r.cost_centre_id)) ?? null : null,
    processId: r.process_id ?? null,
    processName: r.process_id ? dimensions.processes.get(String(r.process_id)) ?? null : null,
    totalAmount: money(r.total_amount),
    lineCount: Number(r.line_count),
    status: r.status as JvStatus,
    createdBy: String(r.created_by),
    createdByName: actors.get(String(r.created_by)) ?? null,
    createdAt: r.created_at ?? null,
    submittedAt: r.submitted_at ?? null,
    approvedBy: r.approved_by ?? null,
    approvedByName: r.approved_by ? actors.get(String(r.approved_by)) ?? null : null,
    approvedAt: r.approved_at ?? null,
    pendingHours: r.pending_hours === null || r.pending_hours === undefined ? null : Number(r.pending_hours),
    journalEntryId: r.journal_entry_id ?? null,
    permissions: computeJvPermissions({ status: r.status, created_by: String(r.created_by) }, actor),
  }));
}

export async function listJournalVouchers(filters: JvListFilters, actor: JvActor) {
  const { where, params } = buildWhere(filters, actor);
  const pageSize = Math.min(JV_MAX_PAGE_SIZE, Math.max(1, Math.floor(filters.pageSize ?? JV_DEFAULT_PAGE_SIZE)));
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const orderColumn = SORT_COLUMNS[filters.sort ?? ""] ?? SORT_COLUMNS.voucherDate;
  const direction = filters.dir === "asc" ? "ASC" : "DESC";

  const [[countRow]] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM journal_voucher jv WHERE ${where}`, params);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${LIST_COLUMNS} FROM journal_voucher jv WHERE ${where}
      ORDER BY ${orderColumn} ${direction}, jv.created_at DESC, jv.id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  return { rows: await decorate(rows as RowDataPacket[], actor), total: Number((countRow as any).n), page, pageSize };
}

export async function journalVoucherSummary(filters: JvListFilters, actor: JvActor) {
  const { where, params } = buildWhere(filters, actor, { ignoreStatus: true });

  const [statusRows] = await db.execute<RowDataPacket[]>(
    `SELECT jv.status, COUNT(*) AS n, COALESCE(SUM(jv.total_amount), 0) AS amount FROM journal_voucher jv WHERE ${where} GROUP BY jv.status`,
    params,
  );
  const byStatus = Object.fromEntries(JV_STATUSES.map((s) => [s, { count: 0, amount: 0 }])) as Record<JvStatus, { count: number; amount: number }>;
  for (const r of statusRows as RowDataPacket[]) byStatus[r.status as JvStatus] = { count: Number(r.n), amount: money(r.amount) };

  const [typeRows] = await db.execute<RowDataPacket[]>(
    `SELECT jv.jv_type, COUNT(*) AS n, COALESCE(SUM(CASE WHEN jv.status = 'posted' THEN jv.total_amount ELSE 0 END), 0) AS posted_amount
       FROM journal_voucher jv WHERE ${where} AND jv.status <> 'draft' GROUP BY jv.jv_type ORDER BY posted_amount DESC`,
    params,
  );
  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT jv.branch_id, COUNT(*) AS n, COALESCE(SUM(CASE WHEN jv.status = 'posted' THEN jv.total_amount ELSE 0 END), 0) AS posted_amount
       FROM journal_voucher jv WHERE ${where} AND jv.status <> 'draft' GROUP BY jv.branch_id ORDER BY posted_amount DESC LIMIT 12`,
    params,
  );
  const [monthRows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(jv.voucher_date, '%Y-%m') AS month, COUNT(*) AS n, COALESCE(SUM(jv.total_amount), 0) AS amount
       FROM journal_voucher jv WHERE ${where} AND jv.status = 'posted'
      GROUP BY month ORDER BY month DESC LIMIT 12`,
    params,
  );
  const [[flow]] = await db.execute<RowDataPacket[]>(
    `SELECT AVG(CASE WHEN jv.approved_at IS NOT NULL AND jv.submitted_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, jv.submitted_at, jv.approved_at) END) AS avg_minutes,
            TIMESTAMPDIFF(HOUR, MIN(CASE WHEN jv.status = 'pending_approval' THEN jv.submitted_at END), NOW()) AS oldest_pending_hours
       FROM journal_voucher jv WHERE ${where}`,
    params,
  );

  const branchNames = await resolveDimensionNames((branchRows as RowDataPacket[]).map((r) => ({ branch_id: r.branch_id })));
  const decided = byStatus.posted.count + byStatus.reversed.count + byStatus.rejected.count;

  return {
    byStatus,
    postedAmount: byStatus.posted.amount,
    pendingAmount: byStatus.pending_approval.amount,
    avgApprovalHours: (flow as any)?.avg_minutes === null || (flow as any)?.avg_minutes === undefined ? null : Math.round((Number((flow as any).avg_minutes) / 60) * 10) / 10,
    oldestPendingHours: (flow as any)?.oldest_pending_hours === null || (flow as any)?.oldest_pending_hours === undefined ? null : Math.max(0, Number((flow as any).oldest_pending_hours)),
    rejectionRatePct: decided > 0 ? Math.round((byStatus.rejected.count / decided) * 1000) / 10 : null,
    byType: (typeRows as RowDataPacket[]).map((r) => ({ jvType: r.jv_type as JvType, count: Number(r.n), postedAmount: money(r.posted_amount) })),
    byBranch: (branchRows as RowDataPacket[]).map((r) => ({
      branchId: r.branch_id ?? null,
      branchName: r.branch_id ? branchNames.branches.get(String(r.branch_id)) ?? "Unknown branch" : "Company-wide",
      count: Number(r.n),
      postedAmount: money(r.posted_amount),
    })),
    byMonth: (monthRows as RowDataPacket[]).map((r) => ({ month: String(r.month), count: Number(r.n), amount: money(r.amount) })).reverse(),
  };
}

async function loadLedgerEntry(journalEntryId: string, kind: "posting" | "reversal") {
  const [[entry]] = await db.execute<RowDataPacket[]>(
    `SELECT id, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, posted_at, posted_by, narration FROM journal_entry WHERE id = ?`,
    [journalEntryId],
  );
  if (!entry) return null;
  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT account_type, account_id, debit_amount, credit_amount, narration
       FROM journal_entry_line WHERE journal_entry_id = ? ORDER BY line_order ASC`,
    [journalEntryId],
  );
  const names = await resolveJvAccountNames((lines as RowDataPacket[]).map((l) => ({ accountType: l.account_type, accountId: l.account_id })));
  const actors = await resolveActorNames([(entry as any).posted_by]);
  return {
    kind,
    journalEntryId,
    entryDate: (entry as any).entry_date as string,
    postedAt: (entry as any).posted_at ?? null,
    postedByName: actors.get(String((entry as any).posted_by)) ?? null,
    narration: (entry as any).narration as string,
    lines: (lines as RowDataPacket[]).map((l) => ({
      accountLabel: names.get(`${l.account_type}:${l.account_id}`)?.label ?? `(unresolved ${l.account_type})`,
      debitAmount: money(l.debit_amount),
      creditAmount: money(l.credit_amount),
    })),
  };
}

export async function getJournalVoucher(id: string, actor: JvActor) {
  const [[row]] = await db.execute<RowDataPacket[]>(
    `SELECT jv.*, DATE_FORMAT(jv.voucher_date, '%Y-%m-%d') AS voucher_date_str FROM journal_voucher jv WHERE jv.id = ?`,
    [id],
  );
  const v = row as any;
  if (!v) throw refuse(404, "JV_NOT_FOUND", "Journal voucher not found.");
  if (v.status === "draft" && String(v.created_by) !== String(actor.id) && !holdsAnyRole(actor.roles, ["super_admin"])) {
    throw refuse(404, "JV_NOT_FOUND", "Journal voucher not found.");
  }

  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, line_order, account_type, account_id, debit_amount, credit_amount, narration
       FROM journal_voucher_line WHERE journal_voucher_id = ? ORDER BY line_order ASC`,
    [id],
  );
  const accountNames = await resolveJvAccountNames((lineRows as RowDataPacket[]).map((l) => ({ accountType: l.account_type, accountId: l.account_id })));
  const events = (await listFinanceApprovalEvents("journal_voucher", id)) as any[];
  const [auditRows] = await db.execute<RowDataPacket[]>(
    `SELECT action_type, actor_user_id, actor_role, change_summary, created_at
       FROM finance_action_audit_log WHERE entity_type = 'JOURNAL_VOUCHER' AND entity_id = ? ORDER BY created_at DESC LIMIT 20`,
    [id],
  );
  const actors = await resolveActorNames([
    v.created_by, v.submitted_by, v.approved_by, v.rejected_by, v.withdrawn_by, v.reversed_by,
    ...events.map((e) => e.actor_user_id),
    ...(auditRows as RowDataPacket[]).map((a) => a.actor_user_id),
  ]);
  const nameOf = (userId: unknown) => (userId ? actors.get(String(userId)) ?? null : null);
  const dimensions = await resolveDimensionNames([v]);

  const [posting, reversal] = await Promise.all([
    v.journal_entry_id ? loadLedgerEntry(String(v.journal_entry_id), "posting") : null,
    v.reversal_entry_id ? loadLedgerEntry(String(v.reversal_entry_id), "reversal") : null,
  ]);

  return {
    id: String(v.id),
    voucherNumber: v.voucher_number ?? null,
    voucherDate: v.voucher_date_str as string,
    jvType: v.jv_type as JvType,
    narration: v.narration as string,
    referenceNo: v.reference_no ?? null,
    branchId: v.branch_id ?? null,
    branchName: v.branch_id ? dimensions.branches.get(String(v.branch_id)) ?? null : null,
    costCentreId: v.cost_centre_id ?? null,
    costCentreName: v.cost_centre_id ? dimensions.costCentres.get(String(v.cost_centre_id)) ?? null : null,
    processId: v.process_id ?? null,
    processName: v.process_id ? dimensions.processes.get(String(v.process_id)) ?? null : null,
    totalAmount: money(v.total_amount),
    lineCount: Number(v.line_count),
    status: v.status as JvStatus,
    createdBy: String(v.created_by),
    createdByName: nameOf(v.created_by),
    createdAt: v.created_at ?? null,
    submittedByName: nameOf(v.submitted_by),
    submittedAt: v.submitted_at ?? null,
    approvedByName: nameOf(v.approved_by),
    approvedAt: v.approved_at ?? null,
    approvalNote: v.approval_note ?? null,
    rejectedByName: nameOf(v.rejected_by),
    rejectedAt: v.rejected_at ?? null,
    rejectionReason: v.rejection_reason ?? null,
    withdrawnByName: nameOf(v.withdrawn_by),
    withdrawnAt: v.withdrawn_at ?? null,
    withdrawalReason: v.withdrawal_reason ?? null,
    reversedByName: nameOf(v.reversed_by),
    reversedAt: v.reversed_at ?? null,
    reversalReason: v.reversal_reason ?? null,
    journalEntryId: v.journal_entry_id ?? null,
    reversalEntryId: v.reversal_entry_id ?? null,
    lines: (lineRows as RowDataPacket[]).map((l) => ({
      id: String(l.id),
      lineOrder: Number(l.line_order),
      accountType: l.account_type as JvAccountType,
      accountId: String(l.account_id),
      accountLabel: accountNames.get(`${l.account_type}:${l.account_id}`)?.label ?? `(unresolved ${l.account_type})`,
      accountHint: accountNames.get(`${l.account_type}:${l.account_id}`)?.hint ?? "",
      debitAmount: money(l.debit_amount),
      creditAmount: money(l.credit_amount),
      narration: l.narration ?? null,
    })),
    ledgerEntries: [posting, reversal].filter(Boolean),
    timeline: events.map((e) => ({
      id: String(e.id),
      action: String(e.action),
      fromStatus: e.from_status ?? null,
      toStatus: String(e.to_status),
      actorName: nameOf(e.actor_user_id),
      actorRole: String(e.actor_role),
      remarks: e.remarks ?? null,
      at: e.created_at,
    })),
    audit: (auditRows as RowDataPacket[]).map((a) => ({
      action: String(a.action_type),
      actorName: nameOf(a.actor_user_id),
      actorRole: a.actor_role ?? null,
      at: a.created_at,
    })),
    permissions: computeJvPermissions({ status: v.status, created_by: String(v.created_by) }, actor),
  };
}

export async function journalVoucherOptions() {
  const [subHeads] = await db.execute<RowDataPacket[]>(
    `SELECT sh.id, h.head_name, sh.sub_head_name
       FROM finance_expense_sub_head_master sh
       JOIN finance_expense_head_master h ON h.id = sh.head_id
      WHERE sh.active_status = 1 AND h.active_status = 1
      ORDER BY h.head_name, sh.sub_head_name`,
  );
  const blocked = [...JV_BLOCKED_PAYABLE_ACCOUNT_NAMES];
  const [payables] = await db.execute<RowDataPacket[]>(
    `SELECT id, account_name, account_type FROM payable_account_master
      WHERE active_status = 1 AND account_name NOT IN (${blocked.map(() => "?").join(",")})
      ORDER BY account_name`,
    blocked,
  );
  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name, branch_code FROM branch_master WHERE active_status = 1 ORDER BY branch_name`,
  );
  const [costCentres] = await db.execute<RowDataPacket[]>(
    `SELECT id, cost_centre_name, cost_centre_code, branch_id, process_id FROM cost_centre_master WHERE active_status = 1 ORDER BY cost_centre_name`,
  );
  const [processes] = await db.execute<RowDataPacket[]>(
    `SELECT id, process_name, branch_id FROM process_master WHERE active_status = 1 ORDER BY process_name`,
  );
  return {
    expenseSubHeads: (subHeads as RowDataPacket[]).map((r) => ({
      accountType: "expense_sub_head" as const, id: String(r.id), label: `${r.head_name} / ${r.sub_head_name}`, group: String(r.head_name),
    })),
    payableAccounts: (payables as RowDataPacket[]).map((r) => ({
      accountType: "payable_account" as const, id: String(r.id), label: String(r.account_name), group: `Ledger head · ${r.account_type}`,
    })),
    branches: (branches as RowDataPacket[]).map((r) => ({ id: String(r.id), name: String(r.branch_name), code: r.branch_code ?? null })),
    costCentres: (costCentres as RowDataPacket[]).map((r) => ({
      id: String(r.id), name: String(r.cost_centre_name), code: r.cost_centre_code ?? null,
      branchId: r.branch_id ? String(r.branch_id) : null, processId: r.process_id ? String(r.process_id) : null,
    })),
    processes: (processes as RowDataPacket[]).map((r) => ({ id: String(r.id), name: String(r.process_name), branchId: r.branch_id ? String(r.branch_id) : null })),
    types: JV_TYPES.map((value) => ({ value })),
  };
}

const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};

export async function journalVouchersCsv(filters: JvListFilters, actor: JvActor, detail: "vouchers" | "lines") {
  const { where, params } = buildWhere(filters, actor);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${LIST_COLUMNS} FROM journal_voucher jv WHERE ${where} ORDER BY jv.voucher_date DESC, jv.created_at DESC LIMIT ${CSV_ROW_LIMIT}`,
    params,
  );
  const vouchers = await decorate(rows as RowDataPacket[], actor);

  if (detail === "vouchers") {
    const header = ["Voucher No.", "Date", "Type", "Status", "Branch", "Cost Centre", "Process", "Narration", "Reference", "Total", "Lines", "Maker", "Submitted At", "Approver", "Approved At"];
    const body = vouchers.map((v) => [
      v.voucherNumber ?? "(draft)", v.voucherDate, v.jvType, v.status, v.branchName ?? "", v.costCentreName ?? "", v.processName ?? "",
      v.narration, v.referenceNo ?? "", v.totalAmount.toFixed(2), v.lineCount, v.createdByName ?? "", v.submittedAt ?? "", v.approvedByName ?? "", v.approvedAt ?? "",
    ]);
    return [header, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n");
  }

  const ids = vouchers.map((v) => v.id);
  const lineRows: RowDataPacket[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const [found] = await db.execute<RowDataPacket[]>(
      `SELECT journal_voucher_id, line_order, account_type, account_id, debit_amount, credit_amount, narration
         FROM journal_voucher_line WHERE journal_voucher_id IN (${chunk.map(() => "?").join(",")}) ORDER BY journal_voucher_id, line_order`,
      chunk,
    );
    lineRows.push(...(found as RowDataPacket[]));
  }
  const accountNames = await resolveJvAccountNames(lineRows.map((l) => ({ accountType: l.account_type, accountId: l.account_id })));
  const byId = new Map(vouchers.map((v) => [v.id, v]));
  const header = ["Voucher No.", "Date", "Status", "Branch", "Cost Centre", "Process", "Line", "Account", "Debit", "Credit", "Line Narration", "Voucher Narration"];
  const body = lineRows.map((l) => {
    const v = byId.get(String(l.journal_voucher_id))!;
    return [
      v.voucherNumber ?? "(draft)", v.voucherDate, v.status, v.branchName ?? "", v.costCentreName ?? "", v.processName ?? "",
      Number(l.line_order) + 1, accountNames.get(`${l.account_type}:${l.account_id}`)?.label ?? "",
      Number(l.debit_amount) ? money(l.debit_amount).toFixed(2) : "", Number(l.credit_amount) ? money(l.credit_amount).toFixed(2) : "",
      l.narration ?? "", v.narration,
    ];
  });
  return [header, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
