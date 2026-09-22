// Ops Control Tower: branch-wise rollup of 8 operational deliverables the owner previously
// tracked by hand in Excel (2026-09-22). Each metric reads an existing table — nothing here is a
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
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { logger } from '../../logger.js';
import {
  APPOINTMENT_LETTER_SLA_DAYS,
  JOINING_DOCUMENT_SLA_DAYS,
  JOIN_BUCKETS,
  classifyIdCreationSla,
  emptyBucketTally,
  joinBucketFor,
  type JoinBucket,
} from './ops-control-tower.logic.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** New-joiner blocks (DigiLocker, eSign, Appointment letter, Joining count) only look at employee
 *  codes created within this window — otherwise a dormant employee who never finished DigiLocker
 *  years ago would sit in the pending count forever. */
const NEW_JOINER_WINDOW_DAYS = 30;

function isMissingObject(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e?.code === 'ER_NO_SUCH_TABLE' || e?.errno === 1146 || e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054;
}

async function query<T extends RowDataPacket>(label: string, sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params as never[]);
    return rows as T[];
  } catch (err) {
    if (!isMissingObject(err)) throw err;
    logger.warn({ err: (err as Error).message, block: label }, '[ops-control-tower] source object missing — block reads as empty');
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
  branches: (BranchRef & { count: number; correctionLastDateMs: number | null; stale: boolean })[];
  grandTotal: number;
}

export interface JoiningBlock {
  branches: (BranchRef & { total: number; buckets: Record<JoinBucket, number> })[];
  grandTotal: number;
  grandBuckets: Record<JoinBucket, number>;
}

async function allBranches(): Promise<BranchRef[]> {
  const rows = await query<RowDataPacket>(
    'branches',
    `SELECT id, branch_name FROM branch_master WHERE active_status = 1 ORDER BY branch_name`,
  );
  return rows.map((r) => ({ branchId: String(r.id), branchName: String(r.branch_name) }));
}

/** Left-joins a per-branch count map onto the full branch list, so an empty branch still shows 0. */
function rollupCounts(branches: BranchRef[], counts: Map<string, number>): CountBlock {
  const rows = branches.map((b) => ({ ...b, count: counts.get(b.branchId) ?? 0 }));
  return { branches: rows, grandTotal: rows.reduce((a, r) => a + r.count, 0) };
}

// ── 1. Attendance mismatched ────────────────────────────────────────────────────────────────
// Source: attendance_reconciliation_issue, the same table runAttendanceMismatchBranchDigest()
// (attendance-mismatch-branch-digest.service.ts) already reads. resolved_at IS NULL = still
// mismatched; MAX(resolved_at) per branch = when a correction was last actually made.
export async function getAttendanceMismatchBlock(): Promise<MismatchBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    'attendance-mismatch',
    `SELECT e.branch_id, SUM(ari.resolved_at IS NULL) AS open_count, MAX(ari.resolved_at) AS last_resolved
       FROM attendance_reconciliation_issue ari
       JOIN employees e ON e.id = ari.employee_id
      GROUP BY e.branch_id`,
  );
  const byBranch = new Map(rows.map((r) => [String(r.branch_id), r]));
  const out = branches.map((b) => {
    const r = byBranch.get(b.branchId);
    const count = Number(r?.open_count ?? 0);
    const lastResolved = r?.last_resolved ? new Date(String(r.last_resolved)).getTime() : null;
    return { ...b, count, correctionLastDateMs: lastResolved, stale: count > 0 && lastResolved !== null && Date.now() - lastResolved > 3 * DAY_MS };
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

export async function getAttendanceMismatchDetail(branchId: string): Promise<AttendanceMismatchDetailRow[]> {
  const rows = await query<RowDataPacket>(
    'attendance-mismatch-detail',
    `SELECT ari.employee_id, ari.employee_code, e.full_name, ari.issue_date, ari.issue_type,
            DATEDIFF(CURDATE(), ari.issue_date) AS days_open
       FROM attendance_reconciliation_issue ari
       JOIN employees e ON e.id = ari.employee_id
      WHERE e.branch_id = ? AND ari.resolved_at IS NULL
      ORDER BY ari.issue_date ASC
      LIMIT 200`,
    [branchId],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ''),
    employeeName: String(r.full_name ?? ''),
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
    'roster-uploaded',
    `SELECT COALESCE(b.branch_id, e.branch_id) AS branch_id, MAX(b.committed_at) AS last_committed
       FROM wfm_roster_import_batch b
       LEFT JOIN wfm_roster_import_row r ON r.batch_id = b.id
       LEFT JOIN employees e ON e.employee_code COLLATE utf8mb4_unicode_ci = r.employee_id_raw COLLATE utf8mb4_unicode_ci
      WHERE b.status = 'COMMITTED'
      GROUP BY COALESCE(b.branch_id, e.branch_id)`,
  );
  const byBranch = new Map(rows.map((r) => [String(r.branch_id), r.last_committed ? new Date(String(r.last_committed)).getTime() : null]));
  const out = branches.map((b) => {
    const lastDateMs = byBranch.get(b.branchId) ?? null;
    return { ...b, lastDateMs, stale: lastDateMs === null || Date.now() - lastDateMs > 7 * DAY_MS };
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
    'joining-count',
    `SELECT branch_id, DATEDIFF(date_of_joining, created_at) AS lag_days
       FROM employees
      WHERE date_of_joining = ? AND created_at >= DATE_SUB(?, INTERVAL ? DAY)`,
    [onDate, onDate, NEW_JOINER_WINDOW_DAYS],
  );
  const perBranch = new Map<string, Record<JoinBucket, number>>();
  for (const r of rows) {
    const branchId = String(r.branch_id ?? '');
    if (!branchId) continue;
    const tally = perBranch.get(branchId) ?? emptyBucketTally();
    tally[joinBucketFor(Number(r.lag_days))] += 1;
    perBranch.set(branchId, tally);
  }
  const out = branches.map((b) => {
    const buckets = perBranch.get(b.branchId) ?? emptyBucketTally();
    return { ...b, buckets, total: Object.values(buckets).reduce((a, v) => a + v, 0) };
  });
  const grandBuckets = emptyBucketTally();
  out.forEach((r) => JOIN_BUCKETS.forEach((k) => { grandBuckets[k] += r.buckets[k]; }));
  return { branches: out, grandTotal: out.reduce((a, r) => a + r.total, 0), grandBuckets };
}

// ── 4. F&F pending ───────────────────────────────────────────────────────────────────────────
// full_final_calculation.status stays 'draft'/'verified'/'approved' until Finance marks it
// 'paid'. Branch comes off the leaving employee's own record.
export async function getFnfPendingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    'fnf-pending',
    `SELECT e.branch_id, COUNT(*) AS n
       FROM full_final_calculation ffc
       JOIN employees e ON e.id = ffc.employee_id
      WHERE ffc.status <> 'paid'
      GROUP BY e.branch_id`,
  );
  return rollupCounts(branches, new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])));
}

export interface FnfDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  daysOpen: number;
  netPayable: number;
}

export async function getFnfPendingDetail(branchId: string): Promise<FnfDetailRow[]> {
  const rows = await query<RowDataPacket>(
    'fnf-pending-detail',
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
    employeeCode: String(r.employee_code ?? ''),
    employeeName: String(r.full_name ?? ''),
    status: String(r.status),
    daysOpen: Number(r.days_open ?? 0),
    netPayable: Number(r.net_payable ?? 0),
  }));
}

// ── 5. NOC pending ───────────────────────────────────────────────────────────────────────────
// noc_case.status is 'invited'/'employee_submitted'/'in_progress' while still open; 'completed',
// 'cancelled' and 'declined' are terminal. branch_id is carried directly on the case.
const NOC_OPEN_STATUSES = ['invited', 'employee_submitted', 'in_progress'];

export async function getNocPendingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    'noc-pending',
    `SELECT branch_id, COUNT(*) AS n FROM noc_case WHERE status IN (${NOC_OPEN_STATUSES.map(() => '?').join(',')}) GROUP BY branch_id`,
    NOC_OPEN_STATUSES,
  );
  return rollupCounts(branches, new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])));
}

export interface NocDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  daysOpen: number;
}

export async function getNocPendingDetail(branchId: string): Promise<NocDetailRow[]> {
  const rows = await query<RowDataPacket>(
    'noc-pending-detail',
    `SELECT employee_id, employee_code, employee_name, status, DATEDIFF(CURDATE(), COALESCE(initiated_at, employee_submitted_at)) AS days_open
       FROM noc_case
      WHERE branch_id = ? AND status IN (${NOC_OPEN_STATUSES.map(() => '?').join(',')})
      ORDER BY initiated_at ASC
      LIMIT 200`,
    [branchId, ...NOC_OPEN_STATUSES],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ''),
    employeeName: String(r.employee_name ?? ''),
    status: String(r.status),
    daysOpen: Number(r.days_open ?? 0),
  }));
}

// ── 6. DigiLocker documents pending ─────────────────────────────────────────────────────────
// ats_onboarding_bridge.digilocker_status stays 'not_started'/'initiated' until DigiLocker hands
// back documents ('documents_received') or the session lapses ('expired', still not resolved —
// counted as pending so it doesn't silently disappear). Bridge rows are keyed by employee_id
// once the candidate has converted, which is when a branch can be attributed.
const DIGILOCKER_DONE = ['documents_received'];

export async function getDigilockerPendingBlock(): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<RowDataPacket>(
    'digilocker-pending',
    `SELECT e.branch_id, COUNT(*) AS n
       FROM ats_onboarding_bridge b
       JOIN employees e ON e.id = b.employee_id
      WHERE e.created_at >= NOW() - INTERVAL ? DAY
        AND (b.digilocker_status IS NULL OR b.digilocker_status NOT IN (${DIGILOCKER_DONE.map(() => '?').join(',')}))
      GROUP BY e.branch_id`,
    [NEW_JOINER_WINDOW_DAYS, ...DIGILOCKER_DONE],
  );
  return rollupCounts(branches, new Map(rows.map((r) => [String(r.branch_id), Number(r.n)])));
}

export interface OnboardingDetailRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: string;
  daysOpen: number;
}

export async function getDigilockerPendingDetail(branchId: string): Promise<OnboardingDetailRow[]> {
  const rows = await query<RowDataPacket>(
    'digilocker-pending-detail',
    `SELECT e.id AS employee_id, e.employee_code, e.full_name, COALESCE(b.digilocker_status, 'not_started') AS status,
            DATEDIFF(CURDATE(), e.created_at) AS days_open
       FROM ats_onboarding_bridge b
       JOIN employees e ON e.id = b.employee_id
      WHERE e.branch_id = ? AND e.created_at >= NOW() - INTERVAL ? DAY
        AND (b.digilocker_status IS NULL OR b.digilocker_status NOT IN (${DIGILOCKER_DONE.map(() => '?').join(',')}))
      ORDER BY e.created_at ASC
      LIMIT 200`,
    [branchId, NEW_JOINER_WINDOW_DAYS, ...DIGILOCKER_DONE],
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ''),
    employeeName: String(r.full_name ?? ''),
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

async function slaPendingBlock(label: string, sql: string, params: unknown[], slaDays: number, nowMs: number): Promise<CountBlock> {
  const branches = await allBranches();
  const rows = await query<SlaSourceRow>(label, sql, params);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const branchId = String(r.branch_id ?? '');
    if (!branchId) continue;
    const result = classifyIdCreationSla(
      { createdAtMs: new Date(String(r.created_at)).getTime(), doneAtMs: r.done_at ? new Date(String(r.done_at)).getTime() : null, nowMs },
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

async function slaPendingDetail(label: string, sql: string, params: unknown[], slaDays: number, nowMs: number): Promise<SlaDetailRow[]> {
  const rows = await query<SlaSourceRow>(label, sql, params);
  const out: SlaDetailRow[] = [];
  for (const r of rows) {
    const result = classifyIdCreationSla(
      { createdAtMs: new Date(String(r.created_at)).getTime(), doneAtMs: r.done_at ? new Date(String(r.done_at)).getTime() : null, nowMs },
      slaDays,
    );
    if (!result.pending) continue;
    out.push({
      employeeId: String(r.employee_id),
      employeeCode: String(r.employee_code ?? ''),
      employeeName: String(r.full_name ?? ''),
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
const JOINING_DOC_DONE_STATUS_VALUES = ['completed', 'signed', 'all_signed'];

function esignSql(scoped: boolean): string {
  const doneClause = `LOWER(COALESCE(b.joining_document_status, '')) IN (${JOINING_DOC_DONE_STATUS_VALUES.map(() => '?').join(',')})`;
  return `SELECT e.branch_id, e.id AS employee_id, e.employee_code, e.full_name, e.created_at,
                 CASE WHEN COALESCE(b.joining_document_completion_pct, 0) >= 100 OR ${doneClause}
                      THEN e.created_at ELSE NULL END AS done_at
            FROM ats_onboarding_bridge b
            JOIN employees e ON e.id = b.employee_id
           WHERE ${scoped ? 'e.branch_id = ? AND ' : ''}e.created_at >= NOW() - INTERVAL ? DAY`;
}

export async function getEsignPendingBlock(nowMs = Date.now()): Promise<CountBlock> {
  return slaPendingBlock('esign-pending', esignSql(false), [...JOINING_DOC_DONE_STATUS_VALUES, NEW_JOINER_WINDOW_DAYS], JOINING_DOCUMENT_SLA_DAYS, nowMs);
}

export async function getEsignPendingDetail(branchId: string, nowMs = Date.now()): Promise<SlaDetailRow[]> {
  // Param order follows the ? placeholders left to right: the CASE/done clause is in the SELECT
  // list, ahead of the WHERE branch filter, so DONE_STATUS_VALUES comes before branchId.
  return slaPendingDetail('esign-pending-detail', esignSql(true), [...JOINING_DOC_DONE_STATUS_VALUES, branchId, NEW_JOINER_WINDOW_DAYS], JOINING_DOCUMENT_SLA_DAYS, nowMs);
}

// ── 8. Appointment letter — eSigned before Day 7 ────────────────────────────────────────────
// appointment_letter_issue.employee_esign_status defaults 'not_sent'; this session could not
// confirm the live value used for "signed" (SSH unreachable) — DONE_VALUES below is a best
// guess from the migration's own naming and should be checked against real data.
const APPOINTMENT_ESIGN_DONE_VALUES = ['signed', 'esigned', 'completed'];

function appointmentLetterSql(scoped: boolean): string {
  const doneClause = `LOWER(COALESCE(al.employee_esign_status, '')) IN (${APPOINTMENT_ESIGN_DONE_VALUES.map(() => '?').join(',')})`;
  return `SELECT e.branch_id, e.id AS employee_id, e.employee_code, e.full_name, e.created_at,
                 CASE WHEN ${doneClause} THEN al.employee_esign_at ELSE NULL END AS done_at
            FROM employees e
            LEFT JOIN appointment_letter_issue al ON al.employee_id = e.id
           WHERE ${scoped ? 'e.branch_id = ? AND ' : ''}e.created_at >= NOW() - INTERVAL ? DAY`;
}

export async function getAppointmentLetterBlock(nowMs = Date.now()): Promise<CountBlock> {
  return slaPendingBlock('appointment-letter', appointmentLetterSql(false), [...APPOINTMENT_ESIGN_DONE_VALUES, NEW_JOINER_WINDOW_DAYS], APPOINTMENT_LETTER_SLA_DAYS, nowMs);
}

export async function getAppointmentLetterDetail(branchId: string, nowMs = Date.now()): Promise<SlaDetailRow[]> {
  // Same left-to-right placeholder order as esignSql: the done clause precedes the branch filter.
  return slaPendingDetail('appointment-letter-detail', appointmentLetterSql(true), [...APPOINTMENT_ESIGN_DONE_VALUES, branchId, NEW_JOINER_WINDOW_DAYS], APPOINTMENT_LETTER_SLA_DAYS, nowMs);
}

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
}

export async function getOpsControlTowerSummary(onDate: string, nowMs = Date.now()): Promise<OpsControlTowerSummary> {
  const [attendanceMismatch, rosterUploaded, joining, fnfPending, nocPending, digilockerPending, esignPending, appointmentLetter] =
    await Promise.all([
      getAttendanceMismatchBlock(),
      getRosterUploadedBlock(),
      getJoiningBlock(onDate),
      getFnfPendingBlock(),
      getNocPendingBlock(),
      getDigilockerPendingBlock(),
      getEsignPendingBlock(nowMs),
      getAppointmentLetterBlock(nowMs),
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
  };
}
