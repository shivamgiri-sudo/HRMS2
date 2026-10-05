// What HR / payroll can DO about attendance mismatches from the Ops Control Tower, and the sync-health view
// that tells them whether the pipeline (not an employee) is the cause.
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { nowIST } from "../../shared/timezone.js";
import { healMissingAttendance, type HealResult } from "../wfm/attendance-heal.service.js";
import {
  AUTO_HEAL_DAYS, addDays, coveragePct, isLowCoverage, jobTone, validateBackfillRange, type HealthTone,
} from "../wfm/attendance-heal.logic.js";

export const REVIEW_REASON_MIN = 5;
export const REVIEW_REASON_MAX = 500;

/** Issue types HR may close as reviewed. All are data gaps, never payroll decisions. */
export const CLOSABLE_ISSUE_TYPES = [
  "missing_adr", "unmapped_cosec_user", "inactive_cosec_user_activity", "missing_ibd", "zero_minute_attendance",
  "missing_punch_with_usable_source", "dialler_source_without_evidence", "salary_payable_days_mismatch",
] as const;

export function todayIst(): string {
  return nowIST().split("T")[0]!;
}

// ── Close as reviewed ────────────────────────────────────────────────────────────────────────

export type CloseOutcome =
  | { ok: true; closed: number; leftOpen: number; closableMonths: string[] }
  | { ok: false; status: number; message: string };

/** Payroll run states that mean the month is finished: its attendance can no longer change anyone's pay. */
export const CLOSED_PAYROLL_STATUSES = ["locked", "finalized", "disbursed", "closed", "paid"];
/** Runs in these states are ignored (they never went anywhere). */
const IGNORED_PAYROLL_STATUSES = ["rejected", "cancelled"];

/**
 * Months whose attendance may be closed as reviewed: at least one payroll run is finished AND no run for that
 * month is still open. A month with no run at all (payroll not started) or with a run still processing is NOT
 * closable, because attendance gaps in it can still change what people are paid.
 */
export function closablePayrollMonths(runs: Array<{ month: string; status: string }>): string[] {
  const closed = new Set<string>();
  const open = new Set<string>();
  for (const r of runs) {
    const status = String(r.status ?? "").toLowerCase();
    if (IGNORED_PAYROLL_STATUSES.includes(status)) continue;
    if (CLOSED_PAYROLL_STATUSES.includes(status)) closed.add(r.month);
    else open.add(r.month);
  }
  return [...closed].filter((m) => !open.has(m)).sort();
}

/**
 * Closes OLD open mismatch items for one branch as "reviewed, no action", recording who and why.
 *
 * Only items older than the automatic window may be closed: the nightly audit re-opens anything it still
 * detects inside the last 7 days, and the heal worker fixes those for real, so closing them would be
 * undone and would hide a live problem. auto_fix_status is an ENUM; 'skipped' is its "not auto-fixed"
 * value, and the review columns carry the actual reason.
 */
export async function closeOldAttendanceIssues(input: {
  branchId: string; reason: string; actorId: string; issueTypes?: string[]; today?: string;
}): Promise<CloseOutcome> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < REVIEW_REASON_MIN) return { ok: false, status: 400, message: `Give a reason of at least ${REVIEW_REASON_MIN} characters` };
  if (reason.length > REVIEW_REASON_MAX) return { ok: false, status: 400, message: `The reason must be ${REVIEW_REASON_MAX} characters or fewer` };
  const types = (input.issueTypes ?? []).filter((t) => (CLOSABLE_ISSUE_TYPES as readonly string[]).includes(t));
  if (input.issueTypes && input.issueTypes.length > 0 && types.length === 0) {
    return { ok: false, status: 400, message: "None of the chosen issue types can be closed here" };
  }
  const cutoff = addDays(input.today ?? todayIst(), -AUTO_HEAL_DAYS);

  // Only months whose payroll is finished. An August item while August payroll is still processing is a live
  // pay problem, not history, and must not be hidden by a close.
  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT LEFT(CAST(run_month AS CHAR), 7) AS month, status FROM salary_prep_run WHERE run_month IS NOT NULL`,
  );
  const months = closablePayrollMonths((runRows as RowDataPacket[]).map((r) => ({ month: String(r.month), status: String(r.status) })));
  const countOld = async (): Promise<number> => {
    const [c] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM attendance_reconciliation_issue ari JOIN employees e ON e.id = ari.employee_id
        WHERE ari.resolved_at IS NULL AND e.branch_id = ? AND e.active_status = 1 AND ari.issue_date < ?`,
      [input.branchId, cutoff],
    );
    return Number((c as RowDataPacket[])[0]?.n ?? 0);
  };
  if (months.length === 0) return { ok: true, closed: 0, leftOpen: await countOld(), closableMonths: [] };

  const params: unknown[] = [input.actorId, reason, input.branchId, cutoff, ...months];
  let typeSql = "";
  if (types.length > 0) { typeSql = ` AND ari.issue_type IN (${types.map(() => "?").join(",")})`; params.push(...types); }
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE attendance_reconciliation_issue ari
       JOIN employees e ON e.id = ari.employee_id
        SET ari.resolved_at = NOW(),
            ari.auto_fix_status = 'skipped',
            ari.reviewed_by = ?,
            ari.reviewed_at = NOW(),
            ari.review_notes = CONCAT('Closed by HR as reviewed: ', ?)
      WHERE ari.resolved_at IS NULL
        AND e.branch_id = ?
        AND e.active_status = 1
        AND ari.issue_date < ?
        AND LEFT(CAST(ari.issue_date AS CHAR), 7) IN (${months.map(() => "?").join(",")})${typeSql}`,
    params,
  );
  return { ok: true, closed: Number(res.affectedRows ?? 0), leftOpen: await countOld(), closableMonths: months };
}

// ── Backfill ─────────────────────────────────────────────────────────────────────────────────

export interface BackfillPreview extends HealResult {
  from: string;
  to: string;
  needsConfirmation: boolean;
  /** Payroll runs for months this range touches that are already past draft, so the approver sees the stakes. */
  payrollRunsInRange: Array<{ month: string; status: string }>;
}

export type BackfillOutcome =
  | { ok: true; data: BackfillPreview }
  | { ok: false; status: number; message: string };

/**
 * Preview or run a backfill for one branch and range. Preview writes nothing. A range reaching beyond the
 * automatic window can only be committed with the exact confirmation phrase, because the months it touches
 * may already be paid; the preview lists any payroll runs for those months.
 */
export async function runBackfill(input: {
  branchId: string; from: string; to: string; mode: "preview" | "commit"; confirm?: string; actorId: string; today?: string;
}): Promise<BackfillOutcome> {
  const today = input.today ?? todayIst();
  const check = validateBackfillRange(input.from, input.to, today);
  if (!check.ok) return { ok: false, status: 400, message: check.message ?? "Invalid range" };

  const months = new Set<string>();
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) months.add(d.slice(0, 7));
  const [runs] = await db.execute<RowDataPacket[]>(
    `SELECT LEFT(CAST(run_month AS CHAR), 7) AS month, status
       FROM salary_prep_run
      WHERE LEFT(CAST(run_month AS CHAR), 7) IN (${[...months].map(() => "?").join(",")})
        AND status NOT IN ('draft', 'rejected', 'cancelled')`,
    [...months],
  );
  const payrollRunsInRange = (runs as RowDataPacket[]).map((r) => ({ month: String(r.month), status: String(r.status) }));

  if (input.mode === "commit" && check.needsConfirmation && input.confirm !== "BACKFILL") {
    return { ok: false, status: 409, message: 'This reaches beyond the automatic 7-day window. Send confirm: "BACKFILL" to proceed.' };
  }

  const result = await healMissingAttendance({
    from: input.from, to: input.to, branchId: input.branchId, dryRun: input.mode === "preview", actor: `backfill:${input.actorId}`,
  });
  return { ok: true, data: { ...result, from: input.from, to: input.to, needsConfirmation: check.needsConfirmation, payrollRunsInRange } };
}

// ── Sync health ──────────────────────────────────────────────────────────────────────────────

export interface JobHealth {
  key: string;
  label: string;
  lastRunAt: string | null;
  status: string | null;
  tone: HealthTone;
  note: string | null;
}
export interface CoverageBranch { branchId: string; branchName: string; activeStaff: number; days: Array<{ date: string; records: number; pct: number; low: boolean }> }
export interface AprFeedDay { date: string; users: number; low: boolean }
export interface SyncHealth {
  generatedAt: string; jobs: JobHealth[]; days: string[]; coverage: CoverageBranch[]; lowDays: number;
  aprFeed: AprFeedDay[]; aprLowDays: number;
}

/**
 * A dialler (APR) day is "low" when it carries under half the agents of a normal day in the window (median of
 * the non-empty weekdays), or none at all. That is what 21-29 Sep 2026 (~14-37 agents vs ~195) and 2 Oct 2026
 * (no rows) looked like; a quiet Sunday stays well above half.
 */
export function flagLowAprDays(days: Array<{ date: string; users: number }>): AprFeedDay[] {
  const weekday = days.filter((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() !== 0 && d.users > 0).map((d) => d.users).sort((a, b) => a - b);
  const median = weekday.length ? weekday[Math.floor(weekday.length / 2)] : 0;
  return days.map((d) => ({ ...d, low: d.users === 0 || (median > 0 && d.users < median / 2) }));
}

const WORKERS: Array<{ key: string; label: string; name: string; everyHours: number }> = [
  { key: "engine", label: "Nightly attendance engine", name: "attendance-engine-sweep", everyHours: 24 },
  { key: "heal", label: "Missing-record repair", name: "attendance-engine-heal", everyHours: 6 },
  { key: "reconciliation", label: "Nightly reconciliation", name: "ncosec-attendance-reconciliation", everyHours: 24 },
  { key: "apr", label: "Dialler APR sync", name: "apr-vicidial-sync", everyHours: 2 },
];

async function lastWorkerRun(name: string): Promise<{ at: Date | null; status: string | null; note: string | null }> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status, COALESCE(completed_at, started_at) AS at, metadata
         FROM worker_job_run WHERE worker_name = ? ORDER BY COALESCE(completed_at, started_at) DESC LIMIT 1`,
      [name],
    );
    const r = (rows as RowDataPacket[])[0];
    if (!r) return { at: null, status: null, note: null };
    let note: string | null = null;
    try {
      const m = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
      if (m && typeof m === "object") {
        if (m.found !== undefined) note = `${m.processed ?? 0} filled of ${m.found} missing${m.failed ? `, ${m.failed} failed` : ""}`;
        else if (m.processed !== undefined) note = `${m.processed} processed${m.failed ? `, ${m.failed} failed` : ""}`;
        else if (m.detectedIssues !== undefined) note = `${m.detectedIssues} issues seen, ${m.resolvedIssues ?? 0} resolved`;
        else if (m.upserted !== undefined) note = `${m.changed ?? 0} agent-days changed, ${m.regraded ?? 0} re-graded${m.skippedPayroll ? `, ${m.skippedPayroll} held (payroll started)` : ""}${Array.isArray(m.failedDates) && m.failedDates.length ? `, failed: ${m.failedDates.join(", ")}` : ""}`;
      }
    } catch { /* metadata is optional */ }
    return { at: r.at ? new Date(r.at as string) : null, status: String(r.status), note };
  } catch {
    return { at: null, status: null, note: null }; // table missing in this environment: unknown, never an error
  }
}

export async function getSyncHealth(nowMs = Date.now()): Promise<SyncHealth> {
  const jobs: JobHealth[] = [];

  // Biometric (COSEC) sync writes its own run rows
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status, COALESCE(completed_at, started_at) AS at, records_written, records_failed
         FROM integration_sync_run WHERE integration_key = 'cosec' ORDER BY started_at DESC LIMIT 1`,
    );
    const r = (rows as RowDataPacket[])[0];
    const at = r?.at ? new Date(r.at as string) : null;
    jobs.push({
      key: "biometric", label: "Biometric sync (COSEC)", lastRunAt: at ? at.toISOString() : null, status: r ? String(r.status) : null,
      tone: jobTone(at, r ? String(r.status) : null, nowMs, 1),
      note: r ? `${r.records_written ?? 0} day(s) written${Number(r.records_failed) ? `, ${r.records_failed} failed` : ""}` : null,
    });
  } catch {
    jobs.push({ key: "biometric", label: "Biometric sync (COSEC)", lastRunAt: null, status: null, tone: "unknown", note: null });
  }
  for (const w of WORKERS) {
    const r = await lastWorkerRun(w.name);
    jobs.push({ key: w.key, label: w.label, lastRunAt: r.at ? r.at.toISOString() : null, status: r.status, tone: jobTone(r.at, r.status, nowMs, w.everyHours), note: r.note });
  }

  // Coverage: share of active staff with an attendance record, per branch, over 7 days ending the day BEFORE
  // yesterday. Yesterday is left out on purpose: the nightly engine writes it at 23:00 today, so it always
  // looks incomplete until then and would raise a false alarm every single day.
  const today = todayIst();
  const to = addDays(today, -2);
  const from = addDays(today, -1 - AUTO_HEAL_DAYS);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

  const [branchRows] = await db.execute<RowDataPacket[]>(`SELECT id, branch_name FROM branch_master WHERE COALESCE(active_status, 1) = 1 ORDER BY branch_name`);
  const [activeRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, COUNT(*) AS n FROM employees
      WHERE active_status = 1 AND LOWER(COALESCE(employment_status, 'active')) = 'active' GROUP BY branch_id`,
  );
  const [recRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id, DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS d, COUNT(*) AS n
       FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
      WHERE adr.record_date BETWEEN ? AND ? AND e.active_status = 1
      GROUP BY e.branch_id, adr.record_date`,
    [from, to],
  );
  const active = new Map((activeRows as RowDataPacket[]).map((r) => [String(r.branch_id), Number(r.n)]));
  const rec = new Map((recRows as RowDataPacket[]).map((r) => [`${r.branch_id}|${r.d}`, Number(r.n)]));
  let lowDays = 0;
  const coverage: CoverageBranch[] = [];
  for (const b of branchRows as RowDataPacket[]) {
    const id = String(b.id);
    const staff = active.get(id) ?? 0;
    if (staff === 0) continue;
    const perDay = days.map((date) => {
      const records = rec.get(`${id}|${date}`) ?? 0;
      const pct = coveragePct(records, staff);
      const low = isLowCoverage(pct);
      if (low) lowDays++;
      return { date, records, pct, low };
    });
    coverage.push({ branchId: id, branchName: String(b.branch_name), activeStaff: staff, days: perDay });
  }

  // Dialler feed: distinct agents per ReportDate for the 7 complete days up to yesterday. A missing or thin day
  // here is a feed outage, not absent staff; the APR sync re-pulls the last 7 days every morning.
  let aprFeed: AprFeedDay[] = [];
  try {
    const aprFrom = addDays(today, -AUTO_HEAL_DAYS);
    const aprTo = addDays(today, -1);
    const [aprRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ReportDate, '%Y-%m-%d') AS d, COUNT(DISTINCT UserID) AS n FROM apr WHERE ReportDate BETWEEN ? AND ? GROUP BY ReportDate`,
      [aprFrom, aprTo],
    );
    const byDate = new Map((aprRows as RowDataPacket[]).map((r) => [String(r.d), Number(r.n)]));
    const aprDays: Array<{ date: string; users: number }> = [];
    for (let d = aprFrom; d <= aprTo; d = addDays(d, 1)) aprDays.push({ date: d, users: byDate.get(d) ?? 0 });
    aprFeed = flagLowAprDays(aprDays);
  } catch { /* apr table missing in this environment: show nothing rather than an error */ }
  const aprLowDays = aprFeed.filter((d) => d.low).length;

  return { generatedAt: new Date(nowMs).toISOString(), jobs, days, coverage, lowDays, aprFeed, aprLowDays };
}
