// Ops Control Tower: branch-wise rollup of operational deliverables the owner previously
// tracked by hand in Excel (2026-09-22), plus six onboarding-status checks added later
// (penny drop, account details, BGV, IT/Admin/WFM provisioning) to close the "employee ID
// created but X still pending" gap. Each metric reads an existing table — nothing here is a
// new source of truth, and nothing here writes.
//
// Every query is wrapped so a missing table/column degrades that one block to "no data" rather
// than failing the whole page — the same isMissingObject pattern used in
// roster-upload-tracker.service.ts and mismatch-escalation.service.ts. Two blocks (eSign and
// Appointment letter) read a free-text/VARCHAR status column whose exact live values were not
// confirmed against the database when this was written (SSH to the DB host was unreachable that
// session) — see the "done" value lists below, each called out at its definition. The SLA day
// counts themselves (3 for eSign, 7 for the appointment letter) ARE confirmed — owner ruling
// 2026-09-22 — and the eSign figure independently matches appointmentLetterEligibility.
// service.ts's own `idCreationSlaBreached: daysSinceIdCreated > 3`, the same employees.created_at
// clock used there.
import { DIGILOCKER_EVIDENCE_SQL } from "../ats/onboarding-bridge-heal.js";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import {
  APPOINTMENT_LETTER_SLA_DAYS,
  JOINING_DOCUMENT_SLA_DAYS,
  JOIN_BUCKETS,
  classifyIdCreationSla,
  emptyBucketTally,
  joinBucketFor,
  type JoinBucket,
} from "./ops-control-tower.logic.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** New-joiner blocks (DigiLocker, eSign, Appointment letter, Joining count) only look at employee
 *  codes created within this window — otherwise a dormant employee who never finished DigiLocker
 *  years ago would sit in the pending count forever. */
const NEW_JOINER_WINDOW_DAYS = 30;

function isMissingObject(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return (
    e?.code === "ER_NO_SUCH_TABLE" ||
    e?.errno === 1146 ||
    e?.code === "ER_BAD_FIELD_ERROR" ||
    e?.errno === 1054
  );
}

/** A query slower than this is logged by name. */
const SLOW_QUERY_MS = 2_000;

/**
 * Who the Ops Control Tower counts. People who have LEFT are not chased for onboarding paperwork and do not
 * inflate branch totals:
 *   - STILL_WITH_US: current staff plus pre-joiners (not active yet, employment_status 'preboarding'), so the
 *     joiner-journey sections keep the very people they exist for while dropping anyone who has since exited.
 *   - ACTIVE_STAFF_ONLY: current staff only, for attendance (a pre-joiner has none, and a leaver's old
 *     mismatches are no longer something the branch can act on).
 * F&F and NOC are exit trackers and deliberately still list people who have left.
 */
export const STILL_WITH_US = "(e.active_status = 1 OR LOWER(COALESCE(e.employment_status, '')) = 'preboarding')";
export const ACTIVE_STAFF_ONLY = "e.active_status = 1";

async function query<T extends RowDataPacket>(
  label: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const startedAt = Date.now();
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params as never[]);
    // The summary ran 12-41 s on production; naming the slow query is the first step to fixing it.
    const ms = Date.now() - startedAt;
    if (ms >= SLOW_QUERY_MS) logger.warn({ block: label, ms }, "[ops-control-tower] slow query");
    return rows as T[];
  } catch (err) {
    if (!isMissingObject(err)) throw err;
    logger.warn(
      { err: (err as Error).message, block: label },
      "[ops-control-tower] source object missing — block reads as empty",
    );
    return [];
  }
}

export interface BranchRef {
  branchId: string;
  branchName: string;
}

export interface CountBlock {
  branches: (BranchRef & { count: number })[];
  grandTotal: number;
}

export interface DateBlock {
  branches: (BranchRef & { lastDateMs: number | null; stale: boolean })[];
}

export interface MismatchBlock {
  branches: (BranchRef & {
    count: number;
    correctionLastDateMs: number | null;
    stale: boolean;
  })[];
  grandTotal: number;
}

export interface JoiningBlock {
  branches: (BranchRef & {
    total: number;
    buckets: Record<JoinBucket, number>;
  })[];
  grandTotal: number;
  grandBuckets: Record<JoinBucket, number>;
}

export async function allBranches(): Promise<BranchRef[]> {
  const rows = await query<RowDataPacket>(
    "branches",
    `SELECT id, branch_name FROM branch_master WHERE active_status = 1 ORDER BY branch_name`,
  );
  return rows.map((r) => ({
    branchId: String(r.id),
    branchName: String(r.branch_name),
  }));
}

/** Left-joins a per-branch count map onto the full branch list, so an empty branch still shows 0. */
function rollupCounts(
  branches: BranchRef[],
  counts: Map<string, number>,
): CountBlock {
  const rows = branches.map((b) => ({
    ...b,
    count: counts.get(b.branchId) ?? 0,
  }));
  return { branches: rows, grandTotal: rows.reduce((a, r) => a + r.count, 0) };
}

// ── 1. Attendance mismatched ────────────────────────────────────────────────────────────────
// Source: attendance_reconciliation_issue, the same table runAttendanceMismatchBranchDigest()
// (attendance-mismatch-branch-digest.service.ts) already reads. resolved_at IS NULL = still
// mismatched; MAX(resolved_at) per branch = when a correction was last actually made.
export async function getAttendanceMismatchBlock(): Promise<MismatchBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "attendance-mismatch",
    `SELECT e.branch_id, SUM(ari.resolved_at IS NULL) AS open_count, MAX(ari.resolved_at) AS last_resolved
       FROM attendance_reconciliation_issue ari
       JOIN employees e ON e.id = ari.employee_id
      WHERE ${ACTIVE_STAFF_ONLY}
      GROUP BY e.branch_id`,
  );
  const byBranch = new Map(rows.map((r) => [String(r.branch_id), r]));
  const out = branches.map((b) => {
    const r = byBranch.get(b.branchId);
    const count = Number(r?.open_count ?? 0);
    const lastResolved = r?.last_resolved
      ? new Date(String(r.last_resolved)).getTime()
      : null;
    return {
      ...b,
      count,
      correctionLastDateMs: lastResolved,
      stale:
        count > 0 &&
        lastResolved !== null &&
        Date.now() - lastResolved > 3 * DAY_MS,
    };
  });
  return { branches: out, grandTotal: out.reduce((a, r) => a + r.count, 0) };
}

export interface AttendanceMismatchDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  issueDate: string;
  issueType: string;
  daysOpen: number;
}

export async function getAttendanceMismatchDetail(
  branchId: string,
): Promise<AttendanceMismatchDetailRow[]> {
  const rows = await query<RowDataPacket>(
    "attendance-mismatch-detail",
    `SELECT ari.employee_id, ari.employee_code, e.full_name, ari.issue_date, ari.issue_type,
            DATEDIFF(CURDATE(), ari.issue_date) AS days_open
       FROM attendance_reconciliation_issue ari
       JOIN employees e ON e.id = ari.employee_id
      WHERE e.branch_id = ? AND ari.resolved_at IS NULL AND ${ACTIVE_STAFF_ONLY}
      ORDER BY ari.issue_date ASC
      LIMIT 200`,
    [branchId],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.full_name ?? ""),
    issueDate: String(r.issue_date),
    issueType: String(r.issue_type),
    daysOpen: Number(r.days_open),
  }));
}

// ── 2. Roster uploaded — last date ──────────────────────────────────────────────────────────
// Same source as the Roster Upload Tracker (wfm_roster_import_batch.committed_at), rolled up to
// one MAX per branch rather than per branch x process x week.
export async function getRosterUploadedBlock(): Promise<DateBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "roster-uploaded",
    `SELECT COALESCE(b.branch_id, e.branch_id) AS branch_id, MAX(b.committed_at) AS last_committed
       FROM wfm_roster_import_batch b
       LEFT JOIN wfm_roster_import_row r ON r.batch_id = b.id
       LEFT JOIN employees e ON e.employee_code COLLATE utf8mb4_unicode_ci = r.employee_id_raw COLLATE utf8mb4_unicode_ci
      WHERE b.status = 'COMMITTED'
      GROUP BY COALESCE(b.branch_id, e.branch_id)`,
  );
  const byBranch = new Map(
    rows.map((r) => [
      String(r.branch_id),
      r.last_committed ? new Date(String(r.last_committed)).getTime() : null,
    ]),
  );
  const out = branches.map((b) => {
    const lastDateMs = byBranch.get(b.branchId) ?? null;
    return {
      ...b,
      lastDateMs,
      stale: lastDateMs === null || Date.now() - lastDateMs > 7 * DAY_MS,
    };
  });
  return { branches: out };
}

// ── 3. Joining count ─────────────────────────────────────────────────────────────────────────
// Owner ruling 2026-09-22: bucket = days between employees.created_at (when the employee code
// was created) and employees.date_of_joining (when they actually started). Scoped to codes
// created in the last 30 days and a joining date on the selected day.
export async function getJoiningBlock(onDate: string): Promise<JoiningBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "joining-count",
    `SELECT branch_id, DATEDIFF(date_of_joining, created_at) AS lag_days
       FROM employees
      WHERE date_of_joining = ? AND created_at >= DATE_SUB(?, INTERVAL ? DAY)`,
    [onDate, onDate, NEW_JOINER_WINDOW_DAYS],
  );
  const perBranch = new Map<string, Record<JoinBucket, number>>();
  for (const r of rows) {
    const branchId = String(r.branch_id ?? "");
    if (!branchId) continue;
    const tally = perBranch.get(branchId) ?? emptyBucketTally();
    tally[joinBucketFor(Number(r.lag_days))] += 1;
    perBranch.set(branchId, tally);
  }
  const out = branches.map((b) => {
    const buckets = perBranch.get(b.branchId) ?? emptyBucketTally();
    return {
      ...b,
      buckets,
      total: Object.values(buckets).reduce((a, v) => a + v, 0),
    };
  });
  const grandBuckets = emptyBucketTally();
  out.forEach((r) =>
    JOIN_BUCKETS.forEach((k) => {
      grandBuckets[k] += r.buckets[k];
    }),
  );
  return {
    branches: out,
    grandTotal: out.reduce((a, r) => a + r.total, 0),
    grandBuckets,
  };
}

// ── 4. F&F pending ───────────────────────────────────────────────────────────────────────────
// full_final_calculation.status stays 'draft'/'verified'/'approved' until Finance marks it
// 'paid'. Branch comes off the leaving employee's own record.
export async function getFnfPendingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "fnf-pending",
    `SELECT e.branch_id, COUNT(*) AS n
       FROM full_final_calculation ffc
       JOIN employees e ON e.id = ffc.employee_id
      WHERE ffc.status <> 'paid'
      GROUP BY e.branch_id`,
  );
  return rollupCounts(
    branches,
    new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])),
  );
}

export interface FnfDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  daysOpen: number;
  netPayable: number;
}

export async function getFnfPendingDetail(
  branchId: string,
): Promise<FnfDetailRow[]> {
  const rows = await query<RowDataPacket>(
    "fnf-pending-detail",
    `SELECT e.id AS employee_id, e.employee_code, e.full_name, ffc.status, ffc.net_payable,
            DATEDIFF(CURDATE(), ffc.calculation_date) AS days_open
       FROM full_final_calculation ffc
       JOIN employees e ON e.id = ffc.employee_id
      WHERE e.branch_id = ? AND ffc.status <> 'paid'
      ORDER BY ffc.calculation_date ASC
      LIMIT 200`,
    [branchId],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.full_name ?? ""),
    status: String(r.status),
    daysOpen: Number(r.days_open ?? 0),
    netPayable: Number(r.net_payable ?? 0),
  }));
}

// ── 5. NOC pending ───────────────────────────────────────────────────────────────────────────
// noc_case.status is 'invited'/'employee_submitted'/'in_progress' while still open; 'completed',
// 'cancelled' and 'declined' are terminal. branch_id is carried directly on the case.
const NOC_OPEN_STATUSES = ["invited", "employee_submitted", "in_progress"];

export async function getNocPendingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "noc-pending",
    `SELECT branch_id, COUNT(*) AS n FROM noc_case WHERE status IN (${NOC_OPEN_STATUSES.map(() => "?").join(",")}) GROUP BY branch_id`,
    NOC_OPEN_STATUSES,
  );
  return rollupCounts(
    branches,
    new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])),
  );
}

export interface NocDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  daysOpen: number;
}

export async function getNocPendingDetail(
  branchId: string,
): Promise<NocDetailRow[]> {
  const rows = await query<RowDataPacket>(
    "noc-pending-detail",
    `SELECT employee_id, employee_code, employee_name, status, DATEDIFF(CURDATE(), COALESCE(initiated_at, employee_submitted_at)) AS days_open
       FROM noc_case
      WHERE branch_id = ? AND status IN (${NOC_OPEN_STATUSES.map(() => "?").join(",")})
      ORDER BY initiated_at ASC
      LIMIT 200`,
    [branchId, ...NOC_OPEN_STATUSES],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.employee_name ?? ""),
    status: String(r.status),
    daysOpen: Number(r.days_open ?? 0),
  }));
}

// ── 6. DigiLocker documents pending ─────────────────────────────────────────────────────────
// ats_onboarding_bridge.digilocker_status stays 'not_started'/'initiated' until DigiLocker hands
// back documents ('documents_received') or the session lapses ('expired', still not resolved —
// counted as pending so it doesn't silently disappear). Bridge rows are keyed by employee_id
// once the candidate has converted, which is when a branch can be attributed.
const DIGILOCKER_DONE = ["documents_received"];

export async function getDigilockerPendingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "digilocker-pending",
    `SELECT e.branch_id, COUNT(*) AS n
       FROM ats_onboarding_bridge b
       JOIN employees e ON e.id = b.employee_id
      WHERE e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
        AND (b.digilocker_status IS NULL OR b.digilocker_status NOT IN (${DIGILOCKER_DONE.map(() => "?").join(",")}))
        AND NOT ${DIGILOCKER_EVIDENCE_SQL}
      GROUP BY e.branch_id`,
    [NEW_JOINER_WINDOW_DAYS, ...DIGILOCKER_DONE],
  );
  return rollupCounts(
    branches,
    new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])),
  );
}

export interface OnboardingDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  daysOpen: number;
}

export async function getDigilockerPendingDetail(
  branchId: string,
): Promise<OnboardingDetailRow[]> {
  const rows = await query<RowDataPacket>(
    "digilocker-pending-detail",
    `SELECT e.id AS employee_id, e.employee_code, e.full_name, COALESCE(b.digilocker_status, 'not_started') AS status,
            DATEDIFF(CURDATE(), e.created_at) AS days_open
       FROM ats_onboarding_bridge b
       JOIN employees e ON e.id = b.employee_id
      WHERE e.branch_id = ? AND e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
        AND (b.digilocker_status IS NULL OR b.digilocker_status NOT IN (${DIGILOCKER_DONE.map(() => "?").join(",")}))
        AND NOT ${DIGILOCKER_EVIDENCE_SQL}
      ORDER BY e.created_at ASC
      LIMIT 200`,
    [branchId, NEW_JOINER_WINDOW_DAYS, ...DIGILOCKER_DONE],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.full_name ?? ""),
    status: String(r.status),
    daysOpen: Number(r.days_open ?? 0),
  }));
}

// ── Shared shape for the two Day-N SLA blocks (eSign, Appointment letter) ──────────────────────
// Both ask the same question — "is this done within N days of employees.created_at?" — of a
// different source table, with a different "done" definition. classifyIdCreationSla carries the
// actual date arithmetic; this just runs one query, classifies each row, and rolls up/lists only
// the ones that are overdue ('pending' per classifyIdCreationSla).
interface SlaSourceRow extends RowDataPacket {
  branch_id: unknown;
  employee_id: unknown;
  employee_code: unknown;
  full_name: unknown;
  created_at: unknown;
  done_at: unknown;
}

async function slaPendingBlock(
  label: string,
  sql: string,
  params: unknown[],
  slaDays: number,
  nowMs: number,
): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<SlaSourceRow>(label, sql, params);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const branchId = String(r.branch_id ?? "");
    if (!branchId) continue;
    const result = classifyIdCreationSla(
      {
        createdAtMs: new Date(String(r.created_at)).getTime(),
        doneAtMs: r.done_at ? new Date(String(r.done_at)).getTime() : null,
        nowMs,
      },
      slaDays,
    );
    if (result.pending) counts.set(branchId, (counts.get(branchId) ?? 0) + 1);
  }
  return rollupCounts(branches, counts);
}

export interface SlaDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  dueDateMs: number;
  daysOverdue: number;
}

async function slaPendingDetail(
  label: string,
  sql: string,
  params: unknown[],
  slaDays: number,
  nowMs: number,
): Promise<SlaDetailRow[]> {
  const rows = await query<SlaSourceRow>(label, sql, params);
  const out: SlaDetailRow[] = [];
  for (const r of rows) {
    const result = classifyIdCreationSla(
      {
        createdAtMs: new Date(String(r.created_at)).getTime(),
        doneAtMs: r.done_at ? new Date(String(r.done_at)).getTime() : null,
        nowMs,
      },
      slaDays,
    );
    if (!result.pending) continue;
    out.push({
      employeeId: String(r.employee_id),
      employeeCode: String(r.employee_code ?? ""),
      employeeName: String(r.full_name ?? ""),
      dueDateMs: result.dueAtMs,
      daysOverdue: result.daysOverdue ?? 0,
    });
  }
  return out;
}

// ── 7. eSign pending (joining kit) — must be signed within Day 3 ───────────────────────────────
// ats_onboarding_bridge has no single "signed at" timestamp, only a status/percentage pair — a
// row is "done" the moment completion reaches 100%, and joining_document_status is carried along
// only for display in the drawer. This session could not confirm the live status strings used
// for "complete" (SSH unreachable) — DONE_STATUS_VALUES is a fallback for a NULL/0% row whose
// status text nonetheless already reads as finished; verify against real data. done_at is
// approximated as created_at (i.e. "already done, exact timing unknown") because the bridge
// table does not record when completion_pct crossed 100 — good enough to decide pending vs not,
// not to say precisely when it finished.
const JOINING_DOC_DONE_STATUS_VALUES = ["completed", "signed", "all_signed"];

function esignSql(scoped: boolean): string {
  const doneClause = `LOWER(COALESCE(b.joining_document_status, '')) IN (${JOINING_DOC_DONE_STATUS_VALUES.map(() => "?").join(",")})`;
  return `SELECT e.branch_id, e.id AS employee_id, e.employee_code, e.full_name, e.created_at,
                 CASE WHEN COALESCE(b.joining_document_completion_pct, 0) >= 100 OR ${doneClause}
                           OR EXISTS (SELECT 1 FROM employee_joining_esign_kit ek WHERE ek.employee_id = e.id AND ek.status = 'signed')
                      THEN e.created_at ELSE NULL END AS done_at
            FROM ats_onboarding_bridge b
            JOIN employees e ON e.id = b.employee_id
           WHERE ${scoped ? "e.branch_id = ? AND " : ""}e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}`;
}

export async function getEsignPendingBlock(
  nowMs = Date.now(),
): Promise<CountBlock> {
  return slaPendingBlock(
    "esign-pending",
    esignSql(false),
    [...JOINING_DOC_DONE_STATUS_VALUES, NEW_JOINER_WINDOW_DAYS],
    JOINING_DOCUMENT_SLA_DAYS,
    nowMs,
  );
}

export async function getEsignPendingDetail(
  branchId: string,
  nowMs = Date.now(),
): Promise<SlaDetailRow[]> {
  // Param order follows the ? placeholders left to right: the CASE/done clause is in the SELECT
  // list, ahead of the WHERE branch filter, so DONE_STATUS_VALUES comes before branchId.
  return slaPendingDetail(
    "esign-pending-detail",
    esignSql(true),
    [...JOINING_DOC_DONE_STATUS_VALUES, branchId, NEW_JOINER_WINDOW_DAYS],
    JOINING_DOCUMENT_SLA_DAYS,
    nowMs,
  );
}

// ── 8. Appointment letter — eSigned before Day 7 ────────────────────────────────────────────
// appointment_letter_issue.employee_esign_status defaults 'not_sent'; this session could not
// confirm the live value used for "signed" (SSH unreachable) — DONE_VALUES below is a best
// guess from the migration's own naming and should be checked against real data.
const APPOINTMENT_ESIGN_DONE_VALUES = ["signed", "esigned", "completed"];

/**
 * HR's APPOINTMENT_LETTER_ESIGN provisioning task is the owner of "does this person need a letter chased".
 * 'waived' is a deliberate exemption (the same convention the document checklist and provisioning blocks use);
 * live 2026-10-05: 139 of the 143 employees listed as overdue had that task waived by HR. 'confirmed' / 'actioned'
 * mean HR closed it too.
 */
const APPOINTMENT_TASK_CLOSED_SQL = `NOT EXISTS (SELECT 1 FROM it_provisioning_request wt
                      WHERE wt.employee_id = e.id AND wt.request_type = 'join'
                        AND wt.task_code = 'APPOINTMENT_LETTER_ESIGN' AND wt.status IN ('waived', 'confirmed', 'actioned'))`;

function appointmentLetterSql(scoped: boolean): string {
  const doneClause = `LOWER(COALESCE(al.employee_esign_status, '')) IN (${APPOINTMENT_ESIGN_DONE_VALUES.map(() => "?").join(",")})`;
  return `SELECT e.branch_id, e.id AS employee_id, e.employee_code, e.full_name, e.created_at,
                 CASE WHEN ${doneClause} THEN al.employee_esign_at ELSE NULL END AS done_at
            FROM employees e
            LEFT JOIN appointment_letter_issue al ON al.employee_id = e.id
           WHERE ${scoped ? "e.branch_id = ? AND " : ""}e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
             AND ${APPOINTMENT_TASK_CLOSED_SQL}`;
}

export async function getAppointmentLetterBlock(
  nowMs = Date.now(),
): Promise<CountBlock> {
  return slaPendingBlock(
    "appointment-letter",
    appointmentLetterSql(false),
    [...APPOINTMENT_ESIGN_DONE_VALUES, NEW_JOINER_WINDOW_DAYS],
    APPOINTMENT_LETTER_SLA_DAYS,
    nowMs,
  );
}

export async function getAppointmentLetterDetail(
  branchId: string,
  nowMs = Date.now(),
): Promise<SlaDetailRow[]> {
  // Same left-to-right placeholder order as esignSql: the done clause precedes the branch filter.
  return slaPendingDetail(
    "appointment-letter-detail",
    appointmentLetterSql(true),
    [...APPOINTMENT_ESIGN_DONE_VALUES, branchId, NEW_JOINER_WINDOW_DAYS],
    APPOINTMENT_LETTER_SLA_DAYS,
    nowMs,
  );
}

// ── 9. Penny drop missing ───────────────────────────────────────────────────────────────────
// bank_penny_drop_log has no "current status" column of its own — a bank-detail change can be
// retried, so a row can go initiated -> failed -> (new row) success. Pending = the latest attempt
// per employee (by initiated_at) is not a closed state, or there's no attempt at all yet.
// 'skipped' counts as done/closed, matching this codebase's own convention for that value
// (NativeHROnboardingRequests.tsx classifies skipped/waived/override/not_applicable as the
// closed "info" bucket, distinct from in-progress "warn" and failed "bad") — a penny-drop check
// deliberately bypassed (e.g. cash-only employee) is not an open item. Confirmed against live
// data (2026-09-25): only 'initiated' and 'skipped' rows exist so far, no 'success'/'failed' yet.
const PENNY_DROP_DONE = ["success", "skipped"];

/**
 * Penny drop done, from every place the verification is actually recorded. bank_penny_drop_log is only
 * written by the post-joining bank-detail flow (7 rows ever on production); the onboarding journey verifies the
 * account earlier, on the candidate, and records it in ats_onboarding_bridge.penny_drop_status and
 * candidate_bank_verification (live 2026-10-05: 174 of 208 recent joiners 'verified' on the bridge, 175 with any
 * verified evidence, yet all 208 showed as pending). Checking the log alone listed people who had verified
 * (e.g. Suhail Khan, MAS63672) under pending. Mock-provider rows are test data and do not count.
 */
const PENNY_DROP_EVIDENCE_SQL = `(
          (latest.penny_drop_status IS NOT NULL AND latest.penny_drop_status IN (${PENNY_DROP_DONE.map((v) => `'${v}'`).join(",")}))
          OR EXISTS (SELECT 1 FROM ats_onboarding_bridge pb
                      WHERE pb.employee_id = e.id
                        AND (LOWER(COALESCE(pb.penny_drop_status, '')) = 'verified' OR pb.penny_drop_verified_at IS NOT NULL))
          OR EXISTS (SELECT 1 FROM employee_bank_detail pd WHERE pd.employee_id = e.id AND pd.verified = 1)
          OR EXISTS (SELECT 1 FROM ats_onboarding_bridge pb2
                       JOIN candidate_bank_verification pv ON pv.candidate_id = pb2.candidate_id
                      WHERE pb2.employee_id = e.id
                        AND LOWER(COALESCE(pv.verification_status, '')) = 'verified'
                        AND LOWER(COALESCE(pv.verification_method, '')) <> 'mock')
        )`;

const PENNY_DROP_LATEST_JOIN = `LEFT JOIN (
         SELECT bpdl1.employee_id, bpdl1.penny_drop_status
           FROM bank_penny_drop_log bpdl1
          WHERE bpdl1.initiated_at = (
                  SELECT MAX(bpdl2.initiated_at) FROM bank_penny_drop_log bpdl2 WHERE bpdl2.employee_id = bpdl1.employee_id
                )
       ) latest ON latest.employee_id = e.id`;

export async function getPennyDropMissingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "penny-drop-missing",
    `SELECT e.branch_id, COUNT(*) AS n
       FROM employees e
       ${PENNY_DROP_LATEST_JOIN}
      WHERE e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
        AND NOT ${PENNY_DROP_EVIDENCE_SQL}
      GROUP BY e.branch_id`,
    [NEW_JOINER_WINDOW_DAYS],
  );
  return rollupCounts(
    branches,
    new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])),
  );
}

export async function getPennyDropMissingDetail(
  branchId: string,
): Promise<OnboardingDetailRow[]> {
  const rows = await query<RowDataPacket>(
    "penny-drop-missing-detail",
    `SELECT e.id AS employee_id, e.employee_code, e.full_name,
            COALESCE(latest.penny_drop_status,
                     (SELECT NULLIF(pb3.penny_drop_status, '') FROM ats_onboarding_bridge pb3 WHERE pb3.employee_id = e.id LIMIT 1),
                     'not_started') AS status,
            DATEDIFF(CURDATE(), e.created_at) AS days_open
       FROM employees e
       ${PENNY_DROP_LATEST_JOIN}
      WHERE e.branch_id = ? AND e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
        AND NOT ${PENNY_DROP_EVIDENCE_SQL}
      ORDER BY e.created_at ASC
      LIMIT 200`,
    [branchId, NEW_JOINER_WINDOW_DAYS],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.full_name ?? ""),
    status: String(r.status),
    daysOpen: Number(r.days_open ?? 0),
  }));
}

// ── 10b. Mandatory joining documents pending ───────────────────────────────────────────────
// Source: employee_joining_document_checklist, the same table the Joining Documents Tracker reads.
// A row is pending while it is mandatory and its status is not one of the closed values below
// (the done list mirrors recalculateDocumentProgress in employeeJoiningDocuments.service.ts;
// waived / not_applicable rows are deliberate exemptions, not open items).
const CHECKLIST_CLOSED_STATUSES = [
  "verified", "signed_verified", "completed", "esign_completed", "wet_signed_uploaded",
  "waived", "not_applicable",
];

/**
 * Owner directive 2026-09-18 (COMPLETION_EXCLUDED_DOCUMENT_CODES in employeeJoiningDocuments.service.ts): the two EPF
 * forms are reviewed by the employee on a separate track and do not count toward joining-document completion.
 * This block must follow the same rule — live 2026-10-05 it listed 206 joiners, 75 of them only because these two
 * forms sat at 'employee_review_pending'. Kept as a local copy: that service pulls in the mailer and storage layers.
 */
const DOCS_COMPLETION_EXCLUDED_CODES = ["EPF_DECLARATION", "EPF_NOMINATION_FORM2"];

export async function getDocsPendingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "docs-pending",
    `SELECT e.branch_id, COUNT(DISTINCT e.id) AS n
       FROM employees e
       JOIN employee_joining_document_checklist c ON c.employee_id = e.id
      WHERE e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
        AND c.mandatory = 1
        AND UPPER(COALESCE(c.document_code, '')) NOT IN (${DOCS_COMPLETION_EXCLUDED_CODES.map(() => "?").join(",")})
        AND LOWER(COALESCE(c.status, '')) NOT IN (${CHECKLIST_CLOSED_STATUSES.map(() => "?").join(",")})
      GROUP BY e.branch_id`,
    [NEW_JOINER_WINDOW_DAYS, ...DOCS_COMPLETION_EXCLUDED_CODES, ...CHECKLIST_CLOSED_STATUSES],
  );
  return rollupCounts(
    branches,
    new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])),
  );
}

/** Per-employee pending document names, newest-joiner last; status carries "N pending: A, B". */
export async function getDocsPendingDetail(
  branchId: string,
): Promise<OnboardingDetailRow[]> {
  const rows = await query<RowDataPacket>(
    "docs-pending-detail",
    `SELECT e.id AS employee_id, e.employee_code, e.full_name,
            COUNT(*) AS pending_count,
            GROUP_CONCAT(c.document_name ORDER BY c.document_name SEPARATOR ', ') AS pending_names,
            DATEDIFF(CURDATE(), e.created_at) AS days_open
       FROM employees e
       JOIN employee_joining_document_checklist c ON c.employee_id = e.id
      WHERE e.branch_id = ? AND e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
        AND c.mandatory = 1
        AND UPPER(COALESCE(c.document_code, '')) NOT IN (${DOCS_COMPLETION_EXCLUDED_CODES.map(() => "?").join(",")})
        AND LOWER(COALESCE(c.status, '')) NOT IN (${CHECKLIST_CLOSED_STATUSES.map(() => "?").join(",")})
      GROUP BY e.id, e.employee_code, e.full_name, e.created_at
      ORDER BY e.created_at ASC
      LIMIT 200`,
    [branchId, NEW_JOINER_WINDOW_DAYS, ...DOCS_COMPLETION_EXCLUDED_CODES, ...CHECKLIST_CLOSED_STATUSES],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.full_name ?? ""),
    status: `${Number(r.pending_count)} pending: ${String(r.pending_names ?? "").slice(0, 160)}`,
    daysOpen: Number(r.days_open ?? 0),
  }));
}

// ── 10. Account details missing ─────────────────────────────────────────────────────────────
// employee_bank_detail has no status column — the row's mere existence is the signal. Pending =
// no bank-detail row for the employee at all (NOT the `verified` flag, which is a separate,
// later step — this block only answers "has HRMS captured account details yet"). Account details the
// candidate already entered during onboarding (candidate_onboarding_bank_detail, a real account hash) count as
// captured: they reach employee_bank_detail later, and 20 of the 35 listed on 2026-10-05 already had them.
const CANDIDATE_BANK_CAPTURED_SQL = `EXISTS (SELECT 1 FROM ats_onboarding_bridge cb
                      JOIN candidate_onboarding_bank_detail cob ON cob.candidate_id = cb.candidate_id
                     WHERE cb.employee_id = e.id AND cob.account_no_hash IS NOT NULL AND cob.account_no_hash <> '')`;
export async function getAccountDetailsMissingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "account-details-missing",
    `SELECT e.branch_id, COUNT(*) AS n
       FROM employees e
       LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id
      WHERE e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US} AND ebd.id IS NULL AND NOT ${CANDIDATE_BANK_CAPTURED_SQL}
      GROUP BY e.branch_id`,
    [NEW_JOINER_WINDOW_DAYS],
  );
  return rollupCounts(
    branches,
    new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])),
  );
}

export async function getAccountDetailsMissingDetail(
  branchId: string,
): Promise<OnboardingDetailRow[]> {
  const rows = await query<RowDataPacket>(
    "account-details-missing-detail",
    `SELECT e.id AS employee_id, e.employee_code, e.full_name, 'no_bank_details' AS status,
            DATEDIFF(CURDATE(), e.created_at) AS days_open
       FROM employees e
       LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id
      WHERE e.branch_id = ? AND e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US} AND ebd.id IS NULL AND NOT ${CANDIDATE_BANK_CAPTURED_SQL}
      ORDER BY e.created_at ASC
      LIMIT 200`,
    [branchId, NEW_JOINER_WINDOW_DAYS],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.full_name ?? ""),
    status: String(r.status),
    daysOpen: Number(r.days_open ?? 0),
  }));
}

// ── 11. BGV pending ──────────────────────────────────────────────────────────────────────────
// candidate_bgv_report keys off candidate_id, not employee_id — ats_onboarding_bridge (already
// used by the DigiLocker block) is the join path from employee back to candidate. Done = the
// report exists and overall_status = 'clear'; anything else (pending/in_progress/refer/negative,
// or no report row yet) counts as pending.
const BGV_DONE = ["clear"];
/** HR waived BGV initiation for this joiner (live 2026-10-05: 61 of the pending list) — a deliberate exemption, not an open item. */
const BGV_WAIVED_SQL = `NOT EXISTS (SELECT 1 FROM it_provisioning_request wb
                      WHERE wb.employee_id = e.id AND wb.request_type = 'join'
                        AND wb.task_code = 'HR_BGV_INITIATION' AND wb.status = 'waived')`;

export async function getBgvPendingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "bgv-pending",
    `SELECT e.branch_id, COUNT(*) AS n
       FROM ats_onboarding_bridge b
       JOIN employees e ON e.id = b.employee_id
       LEFT JOIN candidate_bgv_report r ON r.candidate_id = b.candidate_id
      WHERE e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
        AND (r.overall_status IS NULL OR r.overall_status NOT IN (${BGV_DONE.map(() => "?").join(",")}))
        AND ${BGV_WAIVED_SQL}
      GROUP BY e.branch_id`,
    [NEW_JOINER_WINDOW_DAYS, ...BGV_DONE],
  );
  return rollupCounts(
    branches,
    new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])),
  );
}

export async function getBgvPendingDetail(
  branchId: string,
): Promise<OnboardingDetailRow[]> {
  const rows = await query<RowDataPacket>(
    "bgv-pending-detail",
    `SELECT e.id AS employee_id, e.employee_code, e.full_name, COALESCE(r.overall_status, 'pending') AS status,
            DATEDIFF(CURDATE(), e.created_at) AS days_open
       FROM ats_onboarding_bridge b
       JOIN employees e ON e.id = b.employee_id
       LEFT JOIN candidate_bgv_report r ON r.candidate_id = b.candidate_id
      WHERE e.branch_id = ? AND e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
        AND (r.overall_status IS NULL OR r.overall_status NOT IN (${BGV_DONE.map(() => "?").join(",")}))
        AND ${BGV_WAIVED_SQL}
      ORDER BY e.created_at ASC
      LIMIT 200`,
    [branchId, NEW_JOINER_WINDOW_DAYS, ...BGV_DONE],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.full_name ?? ""),
    status: String(r.status),
    daysOpen: Number(r.days_open ?? 0),
  }));
}


// ── 11b. Address verification awaiting HR review ────────────────────────────────────────────
// candidate_bgv_address_verification: the candidate submits a geo-tagged selfie; it auto-passes only within 50 m of the
// declared address' reference point (a pincode centre, so it practically never does) and otherwise sits at
// status 'submitted' until HR decides pass / fail / review on that candidate's BGV report page. There was no list of
// those waiting cases anywhere: live 2026-10-05, 33 submissions (up to 17 days old), 0 ever decided. This block is
// that list. Not nudgeable: the open action is HR's, not the joiner's. A candidate with a verified attempt is done.
const ADDRESS_REVIEW_WHERE = `v.status = 'submitted' AND (v.hr_decision IS NULL OR v.hr_decision = 'review')
        AND NOT EXISTS (SELECT 1 FROM candidate_bgv_address_verification vv WHERE vv.candidate_id = v.candidate_id AND vv.status = 'verified')`;

export async function getAddressReviewPendingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    "address-review-pending",
    `SELECT e.branch_id, COUNT(DISTINCT e.id) AS n
       FROM candidate_bgv_address_verification v
       JOIN ats_onboarding_bridge b ON b.candidate_id = v.candidate_id
       JOIN employees e ON e.id = b.employee_id
      WHERE ${ADDRESS_REVIEW_WHERE}
        AND e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
      GROUP BY e.branch_id`,
    [NEW_JOINER_WINDOW_DAYS],
  );
  return rollupCounts(
    branches,
    new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])),
  );
}

export async function getAddressReviewPendingDetail(
  branchId: string,
): Promise<OnboardingDetailRow[]> {
  const rows = await query<RowDataPacket>(
    "address-review-pending-detail",
    `SELECT e.id AS employee_id, e.employee_code, e.full_name, v.submitted_at,
            CASE WHEN v.gps_distance_m IS NULL THEN 'No GPS captured'
                 WHEN v.gps_distance_m < 1000 THEN CONCAT(ROUND(v.gps_distance_m), ' m from declared address')
                 WHEN v.gps_distance_m < 100000 THEN CONCAT(ROUND(v.gps_distance_m / 1000, 1), ' km from declared address')
                 ELSE CONCAT(ROUND(v.gps_distance_m / 1000), ' km away - different city') END AS status,
            DATEDIFF(CURDATE(), DATE(v.submitted_at)) AS days_open
       FROM candidate_bgv_address_verification v
       JOIN ats_onboarding_bridge b ON b.candidate_id = v.candidate_id
       JOIN employees e ON e.id = b.employee_id
      WHERE e.branch_id = ? AND ${ADDRESS_REVIEW_WHERE}
        AND e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
      ORDER BY v.submitted_at DESC
      LIMIT 400`,
    [branchId, NEW_JOINER_WINDOW_DAYS],
  );
  const seen = new Set<string>();
  const out: OnboardingDetailRow[] = [];
  for (const r of rows) {
    const id = String(r.employee_id);
    if (seen.has(id)) continue; // newest attempt per employee
    seen.add(id);
    out.push({
      employeeId: id,
      employeeCode: String(r.employee_code ?? ""),
      employeeName: String(r.full_name ?? ""),
      status: String(r.status),
      daysOpen: Number(r.days_open ?? 0),
    });
  }
  return out.sort((a, b) => b.daysOpen - a.daysOpen).slice(0, 200);
}

// ── 12-14. IT / Admin / WFM Provisioning pending ────────────────────────────────────────────
// it_provisioning_request.assigned_role distinguishes the three onboarding provisioning owners
// sharing one table shape. request_type='join' scopes to onboarding (vs 'exit'). Live data
// (checked 2026-09-25 against mas_hrms) showed the role values actually written are 'it' (IT
// team) and 'admin' — with 'branch_it' and 'branch_admin' each appearing on only 1 legacy row,
// carried here as fallback aliases so they aren't silently dropped. 'wfm' matched as expected.
// Pending statuses are 'pending' AND 'pending_unassigned' (7 rows/role in live data — a task
// nobody has been assigned yet is still an open pending item, not a non-existent one);
// 'actioned'/'confirmed'/'waived' are the only closed states.
const PROVISIONING_PENDING_STATUSES = ["pending", "pending_unassigned"];
const PROVISIONING_ROLE_ALIASES: Record<string, string[]> = {
  it: ["it", "branch_it"],
  admin: ["admin", "branch_admin"],
  wfm: ["wfm"],
};

async function provisioningPendingBlock(
  roleKey: keyof typeof PROVISIONING_ROLE_ALIASES,
): Promise<CountBlock> {
  const branches = await allBranches();
  const roles = PROVISIONING_ROLE_ALIASES[roleKey];
  const rows = await query<RowDataPacket>(
    `provisioning-pending-${roleKey}`,
    `SELECT e.branch_id, COUNT(*) AS n
       FROM it_provisioning_request ipr
       JOIN employees e ON e.id = ipr.employee_id
      WHERE ipr.request_type = 'join'
        AND ipr.assigned_role IN (${roles.map(() => "?").join(",")})
        AND ipr.status IN (${PROVISIONING_PENDING_STATUSES.map(() => "?").join(",")})
        AND e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
      GROUP BY e.branch_id`,
    [...roles, ...PROVISIONING_PENDING_STATUSES, NEW_JOINER_WINDOW_DAYS],
  );
  return rollupCounts(
    branches,
    new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])),
  );
}

async function provisioningPendingDetail(
  roleKey: keyof typeof PROVISIONING_ROLE_ALIASES,
  branchId: string,
): Promise<OnboardingDetailRow[]> {
  const roles = PROVISIONING_ROLE_ALIASES[roleKey];
  const rows = await query<RowDataPacket>(
    `provisioning-pending-${roleKey}-detail`,
    `SELECT e.id AS employee_id, e.employee_code, e.full_name, ipr.task_code AS status,
            DATEDIFF(CURDATE(), e.created_at) AS days_open
       FROM it_provisioning_request ipr
       JOIN employees e ON e.id = ipr.employee_id
      WHERE e.branch_id = ? AND ipr.request_type = 'join'
        AND ipr.assigned_role IN (${roles.map(() => "?").join(",")})
        AND ipr.status IN (${PROVISIONING_PENDING_STATUSES.map(() => "?").join(",")})
        AND e.created_at >= NOW() - INTERVAL ? DAY AND ${STILL_WITH_US}
      ORDER BY e.created_at ASC
      LIMIT 200`,
    [
      branchId,
      ...roles,
      ...PROVISIONING_PENDING_STATUSES,
      NEW_JOINER_WINDOW_DAYS,
    ],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.full_name ?? ""),
    status: String(r.status),
    daysOpen: Number(r.days_open ?? 0),
  }));
}

export const getItProvisioningPendingBlock = () =>
  provisioningPendingBlock("it");
export const getItProvisioningPendingDetail = (branchId: string) =>
  provisioningPendingDetail("it", branchId);
export const getAdminProvisioningPendingBlock = () =>
  provisioningPendingBlock("admin");
export const getAdminProvisioningPendingDetail = (branchId: string) =>
  provisioningPendingDetail("admin", branchId);
export const getWfmProvisioningPendingBlock = () =>
  provisioningPendingBlock("wfm");
export const getWfmProvisioningPendingDetail = (branchId: string) =>
  provisioningPendingDetail("wfm", branchId);

export interface OpsControlTowerSummary {
  nowMs: number;
  esignSlaDays: number;
  appointmentLetterSlaDays: number;
  attendanceMismatch: MismatchBlock;
  rosterUploaded: DateBlock;
  joining: JoiningBlock;
  fnfPending: CountBlock;
  nocPending: CountBlock;
  digilockerPending: CountBlock;
  esignPending: CountBlock;
  appointmentLetter: CountBlock;
  pennyDropMissing: CountBlock;
  accountDetailsMissing: CountBlock;
  docsPending: CountBlock;
  bgvPending: CountBlock;
  addressReviewPending: CountBlock;
  itProvisioningPending: CountBlock;
  adminProvisioningPending: CountBlock;
  wfmProvisioningPending: CountBlock;
}

export async function getOpsControlTowerSummary(
  onDate: string,
  nowMs = Date.now(),
): Promise<OpsControlTowerSummary> {
  const [
    attendanceMismatch,
    rosterUploaded,
    joining,
    fnfPending,
    nocPending,
    digilockerPending,
    esignPending,
    appointmentLetter,
    pennyDropMissing,
    accountDetailsMissing,
    docsPending,
    bgvPending,
    addressReviewPending,
    itProvisioningPending,
    adminProvisioningPending,
    wfmProvisioningPending,
  ] = await Promise.all([
    getAttendanceMismatchBlock(),
    getRosterUploadedBlock(),
    getJoiningBlock(onDate),
    getFnfPendingBlock(),
    getNocPendingBlock(),
    getDigilockerPendingBlock(),
    getEsignPendingBlock(nowMs),
    getAppointmentLetterBlock(nowMs),
    getPennyDropMissingBlock(),
    getAccountDetailsMissingBlock(),
    getDocsPendingBlock(),
    getBgvPendingBlock(),
    getAddressReviewPendingBlock(),
    getItProvisioningPendingBlock(),
    getAdminProvisioningPendingBlock(),
    getWfmProvisioningPendingBlock(),
  ]);
  return {
    nowMs,
    esignSlaDays: JOINING_DOCUMENT_SLA_DAYS,
    appointmentLetterSlaDays: APPOINTMENT_LETTER_SLA_DAYS,
    attendanceMismatch,
    rosterUploaded,
    joining,
    fnfPending,
    nocPending,
    digilockerPending,
    esignPending,
    appointmentLetter,
    pennyDropMissing,
    accountDetailsMissing,
    docsPending,
    bgvPending,
    addressReviewPending,
    itProvisioningPending,
    adminProvisioningPending,
    wfmProvisioningPending,
  };
}
