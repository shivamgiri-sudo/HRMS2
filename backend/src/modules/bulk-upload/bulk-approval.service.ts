/**
 * Shared machinery for approval-gated bulk uploads.
 *
 * The existing 15 upload types apply the moment they are imported. These four —
 * attendance regularization, leave, incentive, deduction — must not: they move money
 * and leave balances, so a branch head has to approve them first.
 *
 * The design constraint that shapes everything here: an uploaded row is not a new
 * kind of record. It is the SAME record the single-employee screen creates, in the
 * SAME table, in the SAME pending state — the upload just creates many at once
 * instead of one. Approval then runs the SAME domain engine the manual approver
 * runs. Nothing in this module re-implements a leave-balance deduction or an
 * attendance correction; it only decides which rows to hand to the engine that owns
 * those rules.
 */
import { randomUUID } from "crypto";
import type { Request } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { emailService } from "../communication/email.service.js";

/** Upload types that must not apply until a branch head approves them. */
export const APPROVAL_GATED_TYPES = new Set([
  "ATTENDANCE_REGULARIZATION_BULK",
  "LEAVE_APPLICATION_BULK",
  "INCENTIVE_BULK",
  "DEDUCTION_BULK",
]);

/**
 * Who may upload. Branch WFM and Super Admin, per the approved design.
 * wfm_spoc / wfm_analyst appear in older route guards but hold zero live accounts
 * (user_roles, verified 2026-08-21); they are kept so an existing grant keeps working.
 */
export const UPLOADER_ROLES = ["super_admin", "wfm", "wfm_spoc", "wfm_analyst"];

/**
 * Who may approve. Deliberately NOT the uploader roles — a branch WFM must not be
 * able to approve their own upload, which is the entire point of the gate.
 * admin is excluded for the same reason: several live admin holders also hold wfm
 * (the branch-roles-carry-global-grants finding), so admitting admin here would
 * quietly reopen self-approval.
 */
export const APPROVER_ROLES = ["branch_head"];

export type BulkApprovalStatus =
  | "pending_branch_head"
  | "approved"
  | "rejected"
  | "partially_applied";

export interface StagedRow {
  rowId: string;
  rowNo: number;
  data: Record<string, string>;
}

export interface RowOutcome {
  rowId: string;
  rowNo: number;
  employeeCode: string;
  ok: boolean;
  entityId?: string;
  message?: string;
}

export interface ImportOutcome {
  staged: number;
  failed: number;
  branchId: string | null;
  errors: string[];
}

export interface ApplyOutcome {
  applied: number;
  failed: number;
  errors: string[];
}

export class BulkUploadError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Load the rows a batch staged, normalising the JSON column shape. */
export async function loadStagedRows(batchId: string): Promise<StagedRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, row_no, normalized_data, raw_data
       FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no ASC`,
    [batchId],
  );
  return (rows as RowDataPacket[]).map((r) => {
    const source = r.normalized_data ?? r.raw_data;
    const parsed = typeof source === "string" ? JSON.parse(source) : source;
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries((parsed ?? {}) as Record<string, unknown>)) {
      data[String(k).trim().toLowerCase()] = v === null || v === undefined ? "" : String(v).trim();
    }
    return { rowId: String(r.id), rowNo: Number(r.row_no), data };
  });
}

export interface ResolvedEmployee {
  id: string;
  employee_code: string;
  branch_id: string | null;
  process_id: string | null;
  first_name: string | null;
  last_name: string | null;
}

/**
 * Resolve employee codes in one query rather than one per row — a branch-month
 * upload is thousands of rows, and a per-row SELECT is what made earlier bulk
 * imports exceed the frontend request timeout.
 */
export async function resolveEmployees(codes: string[]): Promise<Map<string, ResolvedEmployee>> {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  const map = new Map<string, ResolvedEmployee>();
  if (unique.length === 0) return map;

  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code, branch_id, process_id, first_name, last_name
         FROM employees
        WHERE employee_code IN (${slice.map(() => "?").join(",")})
          AND employment_status = 'active'`,
      slice,
    );
    for (const r of rows as RowDataPacket[]) {
      map.set(String(r.employee_code).trim().toUpperCase(), {
        id: String(r.id),
        employee_code: String(r.employee_code),
        branch_id: r.branch_id ? String(r.branch_id) : null,
        process_id: r.process_id ? String(r.process_id) : null,
        first_name: r.first_name ? String(r.first_name) : null,
        last_name: r.last_name ? String(r.last_name) : null,
      });
    }
  }
  return map;
}

/**
 * A batch belongs to exactly one branch — the branch of the employees in it, not of
 * whoever uploaded it. A super_admin uploading for Noida produces a Noida batch that
 * the Noida branch head approves.
 *
 * A file spanning two branches is refused rather than stored under an arbitrary
 * branch_id, because there is no single branch head who could legitimately approve
 * it and picking one silently would route half the rows past their own approver.
 */
export function resolveSingleBranch(
  employees: ResolvedEmployee[],
): { branchId: string | null; error?: string } {
  const branches = new Set(employees.map((e) => e.branch_id).filter(Boolean) as string[]);
  if (branches.size === 0) return { branchId: null };
  if (branches.size > 1) {
    return {
      branchId: null,
      error:
        `This file covers ${branches.size} branches. A batch is approved by one branch head, ` +
        `so it must contain one branch only — split the file per branch and upload again.`,
    };
  }
  return { branchId: [...branches][0] };
}

/** Record which domain row a spreadsheet line produced, both directions traceable. */
export async function linkRowToEntity(
  rowId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  await db.execute(
    `UPDATE upload_batch_row
        SET created_entity_type = ?, created_entity_id = ?, row_status = 'imported'
      WHERE id = ?`,
    [entityType, entityId, rowId],
  );
}

/** Mark a staged row as failed, keeping the reason on the row itself. */
export async function markRowFailed(rowId: string, message: string): Promise<void> {
  await db.execute(
    `UPDATE upload_batch_row
        SET row_status = 'error', error_messages = ?
      WHERE id = ?`,
    [JSON.stringify([message.slice(0, 500)]), rowId],
  );
}

/**
 * Register an approved row as immutable.
 *
 * There is no hard DELETE against any of the four target tables anywhere in the
 * backend (verified 2026-08-21) — the only removal path is the discard module, which
 * soft-sets status='discarded' and reverses the balance. So this registry plus the
 * guard in discard.service.ts is a complete lock, not a partial one.
 */
export async function lockEntity(params: {
  entityType: string;
  entityId: string;
  batchId: string;
  batchNo: string | null;
  employeeId: string | null;
  lockedBy: string;
  reason?: string;
}): Promise<void> {
  await db.execute(
    `INSERT INTO bulk_upload_locked_entity
       (id, entity_type, entity_id, upload_batch_id, upload_batch_no, employee_id, locked_by, lock_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE locked_at = locked_at`,
    [
      randomUUID(), params.entityType, params.entityId, params.batchId,
      params.batchNo, params.employeeId, params.lockedBy,
      params.reason ?? "Created by an approved bulk upload",
    ],
  );
}

export interface EntityLock {
  upload_batch_no: string | null;
  locked_at: Date | string;
  entity_type: string;
}

/**
 * Is this row locked by an approved bulk upload? Called by the discard path.
 *
 * Returns the lock rather than a boolean so the caller can name the batch in its
 * refusal — "locked by BATCH-1787..." is actionable, "locked" is not.
 */
export async function getEntityLock(
  entityType: string,
  entityId: string,
): Promise<EntityLock | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT entity_type, upload_batch_no, locked_at
         FROM bulk_upload_locked_entity
        WHERE entity_type = ? AND entity_id = ?
        LIMIT 1`,
      [entityType, entityId],
    );
    const row = (rows as RowDataPacket[])[0];
    return row ? (row as unknown as EntityLock) : null;
  } catch (err: unknown) {
    // The table arrives with migration 1522. Before it is applied nothing is locked,
    // so fail open rather than breaking the discard path on a database without it.
    const code = String((err as { code?: unknown })?.code ?? "");
    if (code === "ER_NO_SUCH_TABLE") return null;
    throw err;
  }
}

export interface BatchRecord extends RowDataPacket {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  batch_status: string;
  approval_status: string | null;
  branch_id: string | null;
  uploaded_by: string;
  total_rows: number;
  valid_rows: number;
}

export async function getBatch(batchId: string): Promise<BatchRecord> {
  const [rows] = await db.execute<BatchRecord[]>(
    "SELECT * FROM upload_batch WHERE id = ? LIMIT 1",
    [batchId],
  );
  const batch = (rows as BatchRecord[])[0];
  if (!batch) throw new BulkUploadError("Upload batch not found", 404);
  return batch;
}

/**
 * Can this user approve this batch?
 *
 * Three independent conditions, all required:
 *  1. They hold an approver role (branch_head).
 *  2. The batch branch is inside their assignment scope.
 *  3. They are not the person who uploaded it.
 *
 * (3) is checked first and separately because it is the one a role check cannot
 * express: a branch head who also holds wfm could otherwise upload and approve the
 * same file, and hasAnyRole returns true for super_admin unconditionally.
 */
export async function assertCanApprove(userId: string, batch: BatchRecord): Promise<void> {
  // super_admin is both maker and checker — can approve their own uploads and
  // any batch regardless of branch scope.
  if (await hasAnyRole(userId, "super_admin")) return;

  if (batch.uploaded_by && batch.uploaded_by === userId) {
    throw new BulkUploadError(
      "You uploaded this batch, so you cannot approve it. A different Branch Head must review it.",
      403,
    );
  }

  const isApprover = await hasAnyRole(userId, ...APPROVER_ROLES);
  if (!isApprover) {
    throw new BulkUploadError(
      "Only a Branch Head can approve a bulk upload of leave, regularization, incentive or deduction.",
      403,
    );
  }

  const inScope = await hasScopedAccess(
    userId,
    APPROVER_ROLES,
    { branchId: batch.branch_id },
    { allowAdminBypass: false, requireScopeForNonAdmin: true },
  );
  if (!inScope) {
    throw new BulkUploadError("This batch belongs to a branch outside your scope.", 403);
  }
}

/** Move a batch into the branch-head queue after its rows have been staged. */
export async function markPendingApproval(
  batchId: string,
  branchId: string | null,
  staged: number,
  failed: number,
): Promise<void> {
  await db.execute<ResultSetHeader>(
    `UPDATE upload_batch
        SET batch_status = 'pending_approval',
            approval_status = 'pending_branch_head',
            branch_id = ?,
            submitted_for_approval_at = NOW(),
            imported_rows = ?,
            error_rows = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [branchId, staged, failed, batchId],
  );
}

export async function markDecided(
  batchId: string,
  status: BulkApprovalStatus,
  userId: string,
  remarks: string | null,
  summary: string,
): Promise<void> {
  await db.execute(
    `UPDATE upload_batch
        SET batch_status = ?,
            approval_status = ?,
            approved_by = ?,
            approved_at = NOW(),
            approval_remarks = ?,
            error_summary = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [
      status === "rejected" ? "rejected" : "imported",
      status, userId, remarks, summary.slice(0, 1000), batchId,
    ],
  );
}

/**
 * Claim the batch before a long-running apply, so a client retry after a false
 * timeout cannot run the domain engines twice and double-deduct a leave balance.
 * Mirrors the claim the existing import dispatcher uses.
 */
// A claim older than this is assumed to be from a crashed server and is safe to release.
const STALE_CLAIM_MINUTES = 5;

export async function claimForDecision(batchId: string): Promise<boolean> {
  // Auto-release any claim that has been stuck in 'approving' for more than
  // STALE_CLAIM_MINUTES — this happens when the server restarts mid-approval.
  await db.execute(
    `UPDATE upload_batch
        SET batch_status = 'pending_approval', updated_at = NOW()
      WHERE id = ? AND batch_status = 'approving'
        AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [batchId, STALE_CLAIM_MINUTES],
  );
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE upload_batch
        SET batch_status = 'approving', updated_at = NOW()
      WHERE id = ? AND approval_status = 'pending_branch_head' AND batch_status <> 'approving'`,
    [batchId],
  );
  return res.affectedRows > 0;
}

export async function releaseClaim(batchId: string): Promise<void> {
  await db.execute(
    `UPDATE upload_batch SET batch_status = 'pending_approval', updated_at = NOW()
      WHERE id = ? AND batch_status = 'approving'`,
    [batchId],
  );
}

/** Force-releases a stuck claim regardless of age. Super-admin only. */
export async function releaseStuckClaim(batchId: string): Promise<boolean> {
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE upload_batch SET batch_status = 'pending_approval', updated_at = NOW()
      WHERE id = ? AND batch_status = 'approving'`,
    [batchId],
  );
  return res.affectedRows > 0;
}

export async function auditBatchAction(params: {
  userId: string;
  actionType: string;
  batch: BatchRecord;
  reason?: string;
  detail?: Record<string, unknown>;
  req?: Request;
}): Promise<void> {
  void logSensitiveAction({
    actor_user_id: params.userId,
    action_type: params.actionType,
    module_key: "bulk_upload",
    entity_type: "upload_batch",
    entity_id: params.batch.id,
    reason: params.reason,
    new_value_json: {
      upload_batch_no: params.batch.upload_batch_no,
      upload_type_code: params.batch.upload_type_code,
      branch_id: params.batch.branch_id,
      ...params.detail,
    },
    req: params.req,
  });
}

interface FailedRowForEmail {
  row_no: number;
  raw_data: Record<string, unknown>;
  error_messages: string[];
}

/**
 * Sends an email to the batch uploader listing the rows that failed during
 * partial approval, so they can fix and re-upload only the failed records.
 */
export async function sendPartialApplyEmail(params: {
  batch: BatchRecord;
  appliedCount: number;
  failedCount: number;
  approverName: string;
  remarks: string | null;
}): Promise<void> {
  if (!emailService.isConfigured()) return;

  // Fetch uploader email
  const [userRows] = await db.execute<RowDataPacket[]>(
    "SELECT email, full_name FROM auth_user WHERE id = ? LIMIT 1",
    [params.batch.uploaded_by],
  );
  const uploader = (userRows as RowDataPacket[])[0];
  if (!uploader?.email) return;

  // Fetch failed rows
  const [rowData] = await db.execute<RowDataPacket[]>(
    `SELECT row_no, raw_data, error_messages
       FROM upload_batch_row
      WHERE upload_batch_id = ?
        AND (row_status = 'error' OR row_status = 'failed')
      ORDER BY row_no ASC
      LIMIT 200`,
    [params.batch.id],
  );
  const failedRows = (rowData as RowDataPacket[]).map((r) => ({
    row_no: r.row_no as number,
    raw_data: (typeof r.raw_data === "string" ? JSON.parse(r.raw_data) : r.raw_data) as Record<string, unknown>,
    error_messages: (typeof r.error_messages === "string" ? JSON.parse(r.error_messages) : r.error_messages ?? []) as string[],
  })) as FailedRowForEmail[];

  if (!failedRows.length) return;

  // Derive column headers from the first row's keys
  const dataKeys = Object.keys(failedRows[0].raw_data);

  const tableRows = failedRows.map((row) => {
    const cells = dataKeys.map(
      (k) => `<td style="padding:6px 10px;border:1px solid #e2e8f0;white-space:nowrap">${String(row.raw_data[k] ?? "")}</td>`,
    ).join("");
    const errors = (row.error_messages || []).map((e) => `<li>${e}</li>`).join("");
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;color:#64748b">${row.row_no}</td>
      ${cells}
      <td style="padding:6px 10px;border:1px solid #e2e8f0;color:#dc2626"><ul style="margin:0;padding-left:14px">${errors}</ul></td>
    </tr>`;
  }).join("");

  const headerCells = [`<th style="padding:6px 10px;border:1px solid #cbd5e1;background:#f8fafc;text-align:left">Row #</th>`,
    ...dataKeys.map((k) => `<th style="padding:6px 10px;border:1px solid #cbd5e1;background:#f8fafc;text-align:left">${k}</th>`),
    `<th style="padding:6px 10px;border:1px solid #cbd5e1;background:#f8fafc;text-align:left;color:#dc2626">Errors (fix & re-upload)</th>`,
  ].join("");

  const typeLabel: Record<string, string> = {
    LEAVE_APPLICATION_BULK: "Leave Application",
    ATTENDANCE_REGULARIZATION_BULK: "Attendance Regularization",
    INCENTIVE_BULK: "Incentive",
    DEDUCTION_BULK: "Deduction",
  };

  const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:900px;margin:0 auto;color:#1e293b">
  <div style="background:#1e293b;padding:20px 28px;border-radius:12px 12px 0 0">
    <h2 style="margin:0;color:#fff;font-size:18px">MAS Callnet PeopleOS — Partial Approval Notice</h2>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">
    <p>Hi ${uploader.full_name || uploader.email},</p>
    <p>Your bulk upload batch <strong>${params.batch.upload_batch_no}</strong> (${typeLabel[params.batch.upload_type_code] ?? params.batch.upload_type_code}) has been <strong>partially approved</strong> by ${params.approverName}.</p>

    <table style="border-collapse:collapse;width:100%;margin:12px 0">
      <tr>
        <td style="padding:6px 12px;background:#f0fdf4;border-radius:6px;font-weight:600;color:#16a34a">✓ ${params.appliedCount} row(s) applied successfully</td>
      </tr>
      <tr><td style="height:6px"></td></tr>
      <tr>
        <td style="padding:6px 12px;background:#fef2f2;border-radius:6px;font-weight:600;color:#dc2626">✗ ${params.failedCount} row(s) failed — listed below</td>
      </tr>
    </table>

    ${params.remarks ? `<p style="background:#f8fafc;border-left:3px solid #94a3b8;padding:8px 12px;margin:12px 0;font-size:13px"><strong>Approver remarks:</strong> ${params.remarks}</p>` : ""}

    <h3 style="font-size:14px;margin:20px 0 8px;color:#dc2626">Failed Rows — Fix and Re-Upload</h3>
    <p style="font-size:13px;color:#64748b;margin:0 0 10px">Correct the highlighted errors in each row below and submit a new upload batch.</p>

    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;font-size:12px;width:100%">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>

    <p style="margin-top:20px;font-size:13px;color:#64748b">
      Log in to <a href="https://mcnhrms.teammas.in/bulk-upload" style="color:#4f46e5">PeopleOS Bulk Upload</a>, create a new batch with only the failed rows above (corrected), and submit for re-approval.
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
    <p style="font-size:11px;color:#94a3b8">MAS Callnet PeopleOS · Automated notification — do not reply</p>
  </div>
</div>`;

  // Build CSV attachment — headers + data + errors column
  const csvHeaders = ["Row No", ...dataKeys, "Errors"];
  const csvLines = [
    csvHeaders.map((h) => `"${h}"`).join(","),
    ...failedRows.map((row) => {
      const cells = [
        row.row_no,
        ...dataKeys.map((k) => `"${String(row.raw_data[k] ?? "").replace(/"/g, '""')}"`),
        `"${(row.error_messages || []).join("; ").replace(/"/g, '""')}"`,
      ];
      return cells.join(",");
    }),
  ];
  const csvContent = csvLines.join("\n");

  await emailService.send({
    to: uploader.email as string,
    subject: `[PeopleOS] Partial Approval — ${params.batch.upload_batch_no} (${params.failedCount} row(s) need correction)`,
    html,
    text: `Hi ${uploader.full_name || uploader.email},\n\nYour batch ${params.batch.upload_batch_no} was partially approved.\n${params.appliedCount} row(s) succeeded, ${params.failedCount} row(s) failed.\n\nFailed rows are attached as a CSV. Fix the errors and re-upload a new batch.\n\nMAS Callnet PeopleOS`,
    attachments: [
      {
        filename: `failed_rows_${params.batch.upload_batch_no}.csv`,
        content: Buffer.from(csvContent, "utf8"),
        contentType: "text/csv",
      },
    ],
  }).catch(() => { /* email failure must not block the approval response */ });
}

/**
 * Normalise a spreadsheet date cell to YYYY-MM-DD.
 *
 * Three shapes have to be accepted, because all three genuinely arrive:
 *  - YYYY-MM-DD, what the sample template ships and what the DB stores.
 *  - DD-MM-YYYY / DD/MM/YYYY, what the Bulk Upload Hub's own template guide tells
 *    users to type, and what an Indian-locale Excel writes.
 *  - A serial number like 46234, what a real .xlsx gives when the cell is formatted
 *    as a date rather than text — the failure that broke the roster import on live
 *    files, where every date silently became a number.
 *
 * Returns null for anything unrecognised, so the caller reports a row error instead
 * of writing a wrong date.
 */
export function normalizeDate(raw: string | undefined | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const dmy = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    // Day-first, not month-first: the template guide specifies DD-MM-YYYY and the
    // users are in India. An ambiguous 05-06-2026 must resolve the same way the
    // guide told the uploader it would.
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  if (/^\d{5}$/.test(value)) {
    // Excel serial: day 1 is 1900-01-01, offset by the famous phantom 1900 leap day.
    const serial = Number(value);
    const ms = (serial - 25_569) * 86_400_000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  return null;
}

/** Normalise a month cell to YYYY-MM, accepting MM-YYYY and a full date too. */
export function normalizeMonth(raw: string | undefined | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  const mmyyyy = value.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (mmyyyy) return `${mmyyyy[2]}-${mmyyyy[1].padStart(2, "0")}`;
  const asDate = normalizeDate(value);
  return asDate ? asDate.slice(0, 7) : null;
}
