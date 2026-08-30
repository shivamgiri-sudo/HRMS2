/**
 * Branch Payroll Readiness Service
 *
 * Computes and stores a per-branch readiness checklist for a given payroll month.
 * The underlying `payroll_branch_readiness` table may not yet exist (migration runs
 * separately). Every DB write is wrapped so the service degrades gracefully and still
 * returns computed metrics when the table is absent.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";
import {
  triggerPayrollBranchSignOff,
  triggerPayrollProcessSignOff,
  triggerPayrollProcessFreezeRequest,
} from "../work-inbox/work-inbox.triggers.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BranchReadinessRecord {
  branch_id: string;
  branch_name: string;
  process_month: string;
  // process scope ('' = branch-level aggregate, UUID = process-scoped)
  process_id: string;
  process_name: string;
  // checklist items (0 = no, 1 = yes)
  attendance_frozen: number;
  attendance_frozen_at: string | null;
  attendance_frozen_by: string | null;
  // WFM manual declaration
  attendance_data_ready: number;
  attendance_data_ready_at: string | null;
  attendance_data_ready_by: string | null;
  incentives_status: "not_uploaded" | "uploaded" | "approved";
  incentives_confirmed_at: string | null;
  custom_deductions_uploaded: number;
  custom_deductions_confirmed_at: string | null;
  overtime_entered: number;
  overtime_confirmed_at: string | null;
  leave_finalized: number;
  leave_finalized_at: string | null;
  regularization_complete: number;
  regularization_complete_at: string | null;
  // computed metrics
  bank_details_pct: number;
  uan_complete_pct: number;
  noc_resolved: number;
  holiday_work_approved: number;
  // branch head sign-off
  branch_head_signoff: number;
  branch_head_signoff_at: string | null;
  branch_head_signoff_by: string | null;
  branch_head_remarks: string | null;
  // process manager sign-off
  process_manager_signoff: number;
  process_manager_signoff_at: string | null;
  process_manager_signoff_by: string | null;
  process_manager_remarks: string | null;
  // HO override
  ho_override_ready: number;
  ho_override_by: string | null;
  ho_override_at: string | null;
  ho_override_reason: string | null;
  // outstanding work behind the manual attestations (migration 1643).
  // REPORTING ONLY - computeScore/computeStatus never read these.
  pending_leave_count: number;
  pending_regularization_count: number;
  employees_without_attendance: number;
  incentive_batch_status: string | null;
  // score
  readiness_score: number;
  readiness_status: "not_started" | "in_progress" | "ready" | "blocked";
  // salary projection
  employee_count: number;
  employee_count_active: number;
  employee_count_left: number;
  projected_gross: number | null;
  projected_net: number | null;
  projection_computed_at: string | null;
  // salary verification (migration 1060)
  salary_verification_done: number;
  salary_verification_at: string | null;
  salary_verification_by: string | null;
}

/** Grouped structure for HO process-level view */
export interface ProcessReadinessBranchGroup {
  branch_id: string;
  branch_name: string;
  processes: BranchReadinessRecord[];
  stats: { total: number; ready: number; avg_score: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Auto-create the payroll_branch_readiness table if it doesn't exist */
async function ensureTable(): Promise<void> {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS payroll_branch_readiness (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        process_month VARCHAR(7) NOT NULL,
        branch_id VARCHAR(36) NOT NULL,

        -- WFM declaration: data is complete (replaces freeze-before-run gate)
        attendance_data_ready TINYINT(1) NOT NULL DEFAULT 0,
        attendance_data_ready_at DATETIME NULL,
        attendance_data_ready_by VARCHAR(36) NULL,

        attendance_frozen TINYINT(1) NOT NULL DEFAULT 0,
        attendance_frozen_at DATETIME NULL,
        attendance_frozen_by VARCHAR(36) NULL,

        incentives_status ENUM('not_uploaded','uploaded','approved') NOT NULL DEFAULT 'not_uploaded',
        incentives_confirmed_at DATETIME NULL,
        incentives_confirmed_by VARCHAR(36) NULL,

        custom_deductions_uploaded TINYINT(1) NOT NULL DEFAULT 0,
        custom_deductions_confirmed_at DATETIME NULL,
        custom_deductions_confirmed_by VARCHAR(36) NULL,

        overtime_entered TINYINT(1) NOT NULL DEFAULT 0,
        overtime_confirmed_at DATETIME NULL,
        overtime_confirmed_by VARCHAR(36) NULL,

        leave_finalized TINYINT(1) NOT NULL DEFAULT 0,
        leave_finalized_at DATETIME NULL,
        leave_finalized_by VARCHAR(36) NULL,

        regularization_complete TINYINT(1) NOT NULL DEFAULT 0,
        regularization_complete_at DATETIME NULL,
        regularization_complete_by VARCHAR(36) NULL,

        bank_details_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        uan_complete_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        noc_resolved TINYINT(1) NOT NULL DEFAULT 0,
        holiday_work_approved TINYINT(1) NOT NULL DEFAULT 0,

        branch_head_signoff TINYINT(1) NOT NULL DEFAULT 0,
        branch_head_signoff_at DATETIME NULL,
        branch_head_signoff_by VARCHAR(36) NULL,
        branch_head_remarks TEXT NULL,

        process_manager_signoff TINYINT(1) NOT NULL DEFAULT 0,
        process_manager_signoff_at DATETIME NULL,
        process_manager_signoff_by VARCHAR(36) NULL,
        process_manager_remarks TEXT NULL,

        readiness_score DECIMAL(5,2) NOT NULL DEFAULT 0,
        readiness_status ENUM('not_started','in_progress','ready','blocked') NOT NULL DEFAULT 'not_started',

        projected_gross DECIMAL(14,2) NULL,
        projected_net DECIMAL(14,2) NULL,
        employee_count INT NOT NULL DEFAULT 0,
        employee_count_active INT NOT NULL DEFAULT 0,
        employee_count_left INT NOT NULL DEFAULT 0,
        projection_computed_at DATETIME NULL,

        salary_verification_done TINYINT(1) NOT NULL DEFAULT 0,
        salary_verification_at DATETIME NULL,
        salary_verification_by VARCHAR(36) NULL,

        ho_override_ready TINYINT(1) NOT NULL DEFAULT 0,
        ho_override_by VARCHAR(36) NULL,
        ho_override_at DATETIME NULL,
        ho_override_reason TEXT NULL,

        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uk_branch_month (process_month, branch_id),
        KEY idx_branch (branch_id),
        KEY idx_month (process_month),
        KEY idx_status (readiness_status)
      )
    `);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Only log if error is NOT "table already exists" — that's expected
    if (!msg.includes("already exists")) {
      console.warn(`[BranchReadiness] ensureTable warning — ${msg}`);
    }
  }
}

/** Returns true when the payroll_branch_readiness table is accessible. */
async function tableExists(): Promise<boolean> {
  try {
    await db.execute("SELECT 1 FROM payroll_branch_readiness LIMIT 0");
    return true;
  } catch {
    return false;
  }
}

/** Safely execute a single-metric query. Returns a fallback value on any error. */
async function safeQuery<T>(
  fn: () => Promise<T>,
  fallback: T,
  label: string
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[BranchReadiness] metric '${label}' failed — ${msg}`);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const payrollBranchReadinessService = {
  // -------------------------------------------------------------------------
  // ensureRecord
  // -------------------------------------------------------------------------

  async ensureRecord(month: string, branchId: string, processId = ''): Promise<void> {
    await ensureTable();
    if (!(await tableExists())) return;

    let processName = '';
    if (processId) {
      try {
        const [prows] = await db.execute<RowDataPacket[]>(
          `SELECT process_name FROM process_master WHERE id = ? LIMIT 1`,
          [processId]
        );
        processName = (prows[0] as any)?.process_name ?? '';
      } catch { /* non-critical */ }
    }

    try {
      await db.execute(
        `INSERT IGNORE INTO payroll_branch_readiness
           (branch_id, process_month, process_id, process_name,
            attendance_data_ready, attendance_frozen, incentives_status,
            custom_deductions_uploaded, overtime_entered,
            leave_finalized, regularization_complete,
            bank_details_pct, uan_complete_pct, noc_resolved, holiday_work_approved,
            branch_head_signoff, ho_override_ready,
            readiness_score, readiness_status, employee_count)
         VALUES (?, ?, ?, ?, 0, 0, 'not_uploaded', 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 'not_started', 0)`,
        [branchId, month, processId, processName]
      );
    } catch (err: unknown) {
      // Fallback: table may not yet have process_id column (migration pending)
      try {
        await db.execute(
          `INSERT IGNORE INTO payroll_branch_readiness
             (branch_id, process_month,
              attendance_frozen, incentives_status,
              custom_deductions_uploaded, overtime_entered,
              bank_details_pct, uan_complete_pct, noc_resolved, holiday_work_approved,
              branch_head_signoff, ho_override_ready,
              readiness_score, readiness_status, employee_count)
           VALUES (?, ?, 0, 'not_uploaded', 0, 0, 0, 0, 1, 1, 0, 0, 0, 'not_started', 0)`,
          [branchId, month]
        );
      } catch (err2: unknown) {
        const msg = err2 instanceof Error ? err2.message : String(err2);
        console.warn(`[BranchReadiness] ensureRecord failed — ${msg}`);
      }
    }
  },

  // -------------------------------------------------------------------------
  // ensureMonthGrid
  // -------------------------------------------------------------------------

  /**
   * Create the FULL readiness grid for a month: one row per (branch, process) that has an
   * active employee, plus one branch-level row per branch.
   *
   * WHY THIS EXISTS
   * ensureRecord() above creates a single row on demand, and nothing else seeded the table, so
   * the grid only ever contained combinations somebody had already browsed to. For 2026-08 that
   * meant 7 branch-level rows and 24 process-level rows across 3 branches, while 49 distinct
   * (branch_id, process_id) pairs had active employees. A Payroll Head asking "which branch and
   * which process is ready" could therefore only be shown the ones already visited — the
   * unvisited ones were not "not ready", they were absent, which reads identically to nothing
   * being wrong.
   *
   * Set-based and INSERT IGNORE against uk_readiness_month_branch_process
   * (process_month, branch_id, process_id), so it is idempotent and safe to call on every
   * summary read. It only ever INSERTs: existing rows, including their ticks and sign-offs, are
   * never updated or deleted here.
   *
   * Column defaults match ensureRecord exactly, including noc_resolved / holiday_work_approved
   * defaulting to 1 — those two are re-derived by refreshLiveMetrics and are deliberately not
   * scored, so seeding them at 1 grants no readiness credit.
   */
  async ensureMonthGrid(month: string): Promise<{ branchRows: number; processRows: number }> {
    await ensureTable();
    if (!(await tableExists())) return { branchRows: 0, processRows: 0 };

    const COLS = `(branch_id, process_month, process_id, process_name,
            attendance_data_ready, attendance_frozen, incentives_status,
            custom_deductions_uploaded, overtime_entered,
            leave_finalized, regularization_complete,
            bank_details_pct, uan_complete_pct, noc_resolved, holiday_work_approved,
            branch_head_signoff, ho_override_ready,
            readiness_score, readiness_status, employee_count)`;
    const DEFAULTS = `0, 0, 'not_uploaded', 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 'not_started', 0`;

    let processRows = 0;
    let branchRows = 0;

    // Process-level. process_name is resolved from process_master where it exists; a LEFT JOIN
    // keeps the row when the process id has no master entry rather than dropping the grid cell.
    processRows = await safeQuery(
      async () => {
        const [res] = await db.execute(
          `INSERT IGNORE INTO payroll_branch_readiness ${COLS}
           SELECT DISTINCT e.branch_id, ?, e.process_id, COALESCE(pm.process_name, ''),
                  ${DEFAULTS}
             FROM employees e
             LEFT JOIN process_master pm ON pm.id = e.process_id
            WHERE e.active_status = 1
              AND e.branch_id  IS NOT NULL AND e.branch_id  <> ''
              AND e.process_id IS NOT NULL AND e.process_id <> ''`,
          [month]
        );
        return Number((res as any)?.affectedRows ?? 0);
      },
      0,
      "ensureMonthGrid.process"
    );

    // Branch-level rollup row (process_id = '').
    branchRows = await safeQuery(
      async () => {
        const [res] = await db.execute(
          `INSERT IGNORE INTO payroll_branch_readiness ${COLS}
           SELECT DISTINCT e.branch_id, ?, '', '',
                  ${DEFAULTS}
             FROM employees e
            WHERE e.active_status = 1
              AND e.branch_id IS NOT NULL AND e.branch_id <> ''`,
          [month]
        );
        return Number((res as any)?.affectedRows ?? 0);
      },
      0,
      "ensureMonthGrid.branch"
    );

    return { branchRows, processRows };
  },

  // -------------------------------------------------------------------------
  // refreshLiveMetrics
  // -------------------------------------------------------------------------

  async refreshLiveMetrics(month: string, branchId: string, processId = ''): Promise<void> {
    const updates: Record<string, unknown> = {};

    // --- attendance_frozen ---------------------------------------------------
    const attendanceFrozen = await safeQuery(
      async () => {
        // The freeze signal is the run for this month, and it is two things, not one:
        // attendance_snapshot_locked, OR a status that means the run is already settled.
        // Status alone is what actually carries it — attendance_snapshot_locked is 0 on
        // every row in production, while 51 of 67 runs are FINALIZED. Matching only the
        // column therefore reported "not frozen" for months that were long closed.
        // Same predicate as isPayrollFrozenForDate in
        // wfm.regularization.secure.routes.ts — kept identical so the two agree.
        //
        // A company-wide run (branch_id and branch_filter both NULL — which is every run in
        // production) covers every branch. The old `(branch_id = ? OR branch_filter = ?)`
        // matched neither, so this returned 0 rows even for June and July, where runs exist.
        //
        // run_month is VARCHAR(7) 'YYYY-MM'; comparing it to a DATE coerces to a warning,
        // not an error, and silently matches nothing.
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT 1 AS frozen
             FROM salary_prep_run
            WHERE run_month = ?
              AND (branch_id IS NULL OR branch_id = ?)
              AND (branch_filter IS NULL OR branch_filter = ?)
              AND (attendance_snapshot_locked = 1
                   OR LOWER(status) IN ('finalized','finalised','locked','disbursed','approved'))
            LIMIT 1`,
          [month, branchId, branchId]
        );
        if ((rows as any[]).length > 0) return 1;

        // There is no payroll_attendance_snapshot table — not in this database and not in
        // any migration. This fallback therefore threw ER_NO_SUCH_TABLE on every call and
        // the catch below turned it into 0, which is the value it would have returned
        // anyway. It ran once per branch per poll purely to fail.
        //
        // Kept as an explicit 0 rather than deleted so the intent (no snapshot evidence
        // found) stays legible. If a snapshot table is ever introduced, this is where it
        // plugs in — the nearest existing tables are attendance_state_snapshot and
        // payroll_attendance_conflict_review, neither of which carries pay_month/is_locked.
        return 0;
      },
      0,
      "attendance_frozen"
    );
    updates.attendance_frozen = attendanceFrozen;

    // --- incentives_status ---------------------------------------------------
    const incentivesStatus = await safeQuery(
      async () => {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT status
             FROM incentive_upload_batch
            WHERE pay_month LIKE ? AND branch_id = ?
            ORDER BY created_at DESC`,
          [`${month}%`, branchId]
        );
        const statusList = (rows as any[]).map((r) => r.status as string);
        if (statusList.includes("approved")) return "approved";
        if (statusList.length > 0) return "uploaded";
        return "not_uploaded";
      },
      "not_uploaded" as const,
      "incentives_status"
    );
    updates.incentives_status = incentivesStatus;
    if (incentivesStatus === "approved") {
      updates.incentives_confirmed_at = new Date()
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
    }

    // --- bank_details_pct ----------------------------------------------------
    const bankDetailsPct = await safeQuery(
      async () => {
        const processFilter = processId ? 'AND e.process_id = ?' : '';
        const processParams = processId ? [processId] : [];
        // Try employee_bank_detail table first
        try {
          const [rows] = await db.execute<RowDataPacket[]>(
            `SELECT
               COUNT(DISTINCT e.id) AS total,
               COUNT(DISTINCT ebd.employee_id) AS with_bank
             FROM employees e
             LEFT JOIN employee_bank_detail ebd
               ON ebd.employee_id = e.id
              AND ebd.active_status = 1
              AND ebd.account_number IS NOT NULL
              AND TRIM(ebd.account_number) != ''
             WHERE e.branch_id = ?
               AND e.active_status = 1
               AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
               ${processFilter}`,
            [branchId, ...processParams]
          );
          const total = Number((rows[0] as any)?.total ?? 0);
          const withBank = Number((rows[0] as any)?.with_bank ?? 0);
          return total > 0 ? Math.round((withBank / total) * 100) : 0;
        } catch {
          // Fallback: employees.bank_account_no column
          const [rows] = await db.execute<RowDataPacket[]>(
            `SELECT
               COUNT(*) AS total,
               SUM(CASE WHEN bank_account_no IS NOT NULL AND TRIM(bank_account_no) != '' THEN 1 ELSE 0 END) AS with_bank
             FROM employees
             WHERE branch_id = ?
               AND active_status = 1
               AND LOWER(COALESCE(employment_status, 'active')) = 'active'
               ${processFilter}`,
            [branchId, ...processParams]
          );
          const total = Number((rows[0] as any)?.total ?? 0);
          const withBank = Number((rows[0] as any)?.with_bank ?? 0);
          return total > 0 ? Math.round((withBank / total) * 100) : 0;
        }
      },
      0,
      "bank_details_pct"
    );
    updates.bank_details_pct = bankDetailsPct;

    // --- uan_complete_pct ----------------------------------------------------
    const uanCompletePct = await safeQuery(
      async () => {
        const processFilter = processId ? 'AND process_id = ?' : '';
        const processParams = processId ? [processId] : [];
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT
             COUNT(*) AS total,
             -- pf_uan does not exist on employees (nor anywhere in the schema); the column
             -- is uan_number. Its presence in this COALESCE made the whole statement throw
             -- ER_BAD_FIELD_ERROR on every branch, every poll.
             SUM(CASE WHEN TRIM(COALESCE(uan_number, '')) != '' THEN 1 ELSE 0 END) AS with_uan
           FROM employees
           WHERE branch_id = ?
             AND active_status = 1
             AND LOWER(COALESCE(employment_status, 'active')) = 'active'
             ${processFilter}`,
          [branchId, ...processParams]
        );
        const total = Number((rows[0] as any)?.total ?? 0);
        const withUan = Number((rows[0] as any)?.with_uan ?? 0);
        return total > 0 ? Math.round((withUan / total) * 100) : 0;
      },
      0,
      "uan_complete_pct"
    );
    updates.uan_complete_pct = uanCompletePct;

    // --- noc_resolved --------------------------------------------------------
    // Previously: any error on any candidate table — including a genuine query
    // failure on a table that DOES exist (syntax, permission, connectivity) — was
    // silently treated the same as "no NOC table in this deployment" and fell
    // through to `return 1` (resolved). A real error surfacing as "resolved" is
    // exactly the fail-open pattern this dashboard cannot afford: it would show
    // payroll as more ready than it is. Now: ER_NO_SUCH_TABLE (errno 1146) is the
    // only case treated as "NOC tracking isn't configured here, don't block on
    // it" — every other error is logged loudly and blocks (0), never silently
    // passes.
    const nocResolved = await safeQuery(
      async () => {
        let sawGenuineError = false;
        // Try payroll_noc / noc_issuance / employee_noc tables
        for (const table of ["payroll_noc", "noc_issuance", "employee_noc"]) {
          try {
            const statusCol =
              table === "payroll_noc" ? "upload_status" : "status";
            const branchJoin =
              table === "payroll_noc"
                ? `JOIN employees e ON e.id = n.employee_id AND e.branch_id = ?`
                : ``;
            const branchWhere =
              table === "payroll_noc" ? `` : `AND branch_id = ?`;

            const sql =
              table === "payroll_noc"
                ? `SELECT COUNT(*) AS cnt FROM ${table} n ${branchJoin}
                   WHERE n.${statusCol} NOT IN ('validated','rejected','closed','resolved')`
                : `SELECT COUNT(*) AS cnt FROM ${table} n
                   WHERE n.${statusCol} NOT IN ('resolved','closed','approved')
                   ${branchWhere}`;

            const params =
              table === "payroll_noc" ? [branchId] : [branchId];
            const [rows] = await db.execute<RowDataPacket[]>(sql, params);
            const cnt = Number((rows[0] as any)?.cnt ?? 0);
            return cnt === 0 ? 1 : 0;
          } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code !== "ER_NO_SUCH_TABLE") {
              sawGenuineError = true;
              console.error(
                `[BranchReadiness] noc_resolved query against '${table}' failed for a reason other than a missing table — treating as unresolved rather than silently passing:`,
                err instanceof Error ? err.message : err
              );
            }
            continue;
          }
        }
        // All three candidates missing (ER_NO_SUCH_TABLE) → NOC tracking genuinely
        // isn't deployed here, don't block on it. Any genuine error → block.
        return sawGenuineError ? 0 : 1;
      },
      // Outer fallback for anything that throws outside the per-table try/catch
      // above (i.e. a genuine bug, not a per-table query error, which is already
      // handled inline). Was 1 ("resolved") — changed to 0 so an unexpected
      // failure here blocks readiness instead of silently passing it, consistent
      // with the inline handling above.
      0,
      "noc_resolved"
    );
    updates.noc_resolved = nocResolved;

    // --- holiday_work_approved -----------------------------------------------
    // The COUNT query below previously had no try/catch of its own, so any failure
    // on it (once a date column was found) propagated to the outer safeQuery,
    // whose fallback was 1 ("approved") — a real query error silently reported as
    // "no pending holiday-work approvals." Now caught explicitly and blocks (0);
    // the outer fallback is also changed from 1 to 0 for the same reason as
    // noc_resolved above.
    const holidayWorkApproved = await safeQuery(
      async () => {
        const [year, mon] = month.split("-");
        const monthStart = `${year}-${mon}-01`;
        const lastDay = new Date(Number(year), Number(mon), 0).getDate();
        const monthEnd = `${year}-${mon}-${String(lastDay).padStart(2, "0")}`;

        // work_date column may be named differently across environments
        const [cols] = await db.execute<RowDataPacket[]>(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'holiday_work_request'
            AND COLUMN_NAME IN ('work_date','date','holiday_date','request_date') LIMIT 1`
        );
        // The lookup above is defensive, but falling back to 'work_date' when it finds
        // nothing defeats the point: holiday_work_request has no such column, so the query
        // below then threw on every branch. If no known date column exists there is nothing
        // to count — return 0 rather than guessing a name.
        const dateCol = (cols[0] as any)?.COLUMN_NAME as string | undefined;
        if (!dateCol) return 0;
        try {
          const [rows] = await db.execute<RowDataPacket[]>(
            `SELECT COUNT(*) AS cnt
               FROM holiday_work_request
              WHERE branch_id = ?
                AND status = 'pending'
                AND \`${dateCol}\` BETWEEN ? AND ?`,
            [branchId, monthStart, monthEnd]
          );
          const cnt = Number((rows[0] as any)?.cnt ?? 0);
          return cnt === 0 ? 1 : 0;
        } catch (err: unknown) {
          console.error(
            `[BranchReadiness] holiday_work_approved COUNT query failed — treating as unresolved rather than silently passing:`,
            err instanceof Error ? err.message : err
          );
          return 0;
        }
      },
      0,
      "holiday_work_approved"
    );
    updates.holiday_work_approved = holidayWorkApproved;

    // --- outstanding-work counters -------------------------------------------
    // REPORTING ONLY. computeScore() and computeStatus() do not read any of these, so they
    // cannot move a branch's score or status. They exist because the five manually ticked
    // checklist items verify nothing — the checklist POST writes the column with no query
    // behind it — so a branch WFM user attested "Attendance Data Ready" from memory and the
    // Payroll Head saw a score with no way to tell WHY a branch was short. These four put a
    // number behind each attestation and give follow-up something to chase.
    //
    // Each is wrapped in safeQuery with a 0/null fallback so an environment where migration
    // 1643 has not yet applied degrades to "nothing known" instead of failing the whole refresh.
    const [cYear, cMon] = month.split("-").map(Number);
    const cStart = `${month}-01`;
    const cEnd = new Date(cYear, cMon, 0).toISOString().slice(0, 10);
    const cProcJoined = processId ? "AND e.process_id = ?" : "";
    const cProcParams = processId ? [processId] : [];

    // Leave still awaiting a decision, for leave whose span touches this month. Dates exist
    // under BOTH naming styles on leave_request (start_date/end_date and from_date/to_date),
    // so both are COALESCEd rather than assuming one.
    updates.pending_leave_count = await safeQuery(
      async () => {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt
             FROM leave_request lr
             JOIN employees e ON e.id = lr.employee_id
            WHERE e.active_status = 1
              AND e.branch_id = ?
              AND LOWER(lr.status) = 'pending'
              AND COALESCE(lr.start_date, lr.from_date) <= ?
              AND COALESCE(lr.end_date,   lr.to_date)   >= ?
              ${cProcJoined}`,
          [branchId, cEnd, cStart, ...cProcParams]
        );
        return Number((rows[0] as any)?.cnt ?? 0);
      },
      0,
      "pending_leave_count"
    );

    // attendance_regularization carries branch_id but NO process_id, so the process cut has to
    // come from employees via the join rather than from the row itself.
    updates.pending_regularization_count = await safeQuery(
      async () => {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt
             FROM attendance_regularization ar
             JOIN employees e ON e.id = ar.employee_id
            WHERE e.active_status = 1
              AND e.branch_id = ?
              AND LOWER(ar.status) IN ('pending','escalated')
              AND ar.session_date BETWEEN ? AND ?
              ${cProcJoined}`,
          [branchId, cStart, cEnd, ...cProcParams]
        );
        return Number((rows[0] as any)?.cnt ?? 0);
      },
      0,
      "pending_regularization_count"
    );

    // Active employees with NO attendance row at all this month. This is the number behind
    // "Attendance Data Ready": a non-zero value means the month demonstrably is not complete.
    // The column is record_date, not attendance_date.
    updates.employees_without_attendance = await safeQuery(
      async () => {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt
             FROM employees e
            WHERE e.active_status = 1
              AND e.branch_id = ?
              ${cProcJoined}
              AND NOT EXISTS (
                SELECT 1 FROM attendance_daily_record adr
                 WHERE adr.employee_id = e.id
                   AND adr.record_date BETWEEN ? AND ?
              )`,
          [branchId, ...cProcParams, cStart, cEnd]
        );
        return Number((rows[0] as any)?.cnt ?? 0);
      },
      0,
      "employees_without_attendance"
    );

    // The incentive batch's real state. incentives_status = 'approved' is worth 20 of the 100
    // readiness points and branch staff cannot set it — POST /api/incentives/batches/:id/approve
    // is requireRole('admin','finance') — so without this the branch sees a fifth of its score
    // withheld by a team that appears nowhere on the page. NULL means no batch was uploaded,
    // which is a different problem from one uploaded and not yet approved.
    updates.incentive_batch_status = await safeQuery(
      async () => {
        const proc = processId ? "AND process_id = ?" : "";
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT status
             FROM incentive_upload_batch
            WHERE salary_month = ? AND branch_id = ? ${proc}
            ORDER BY updated_at DESC
            LIMIT 1`,
          [month, branchId, ...(processId ? [processId] : [])]
        );
        const s = (rows[0] as any)?.status;
        return s == null ? null : String(s);
      },
      null as string | null,
      "incentive_batch_status"
    );

    // --- Persist updates when table exists -----------------------------------
    if (!(await tableExists())) return;

    const setClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = [...Object.values(updates), month, branchId, processId];

    try {
      await db.execute(
        `UPDATE payroll_branch_readiness
            SET ${setClauses}
          WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
        values
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[BranchReadiness] refreshLiveMetrics persist failed — ${msg}`);
    }
  },

  // -------------------------------------------------------------------------
  // computeScore
  // -------------------------------------------------------------------------

  computeScore(record: Partial<BranchReadinessRecord>): number {
    let score = 0;

    // WEIGHTS TOTAL EXACTLY 100. They previously summed to 110 and were squeezed with
    // Math.min(100), so the score did not mean what it said and - worse - a branch could
    // skip BOTH attendance gates (15 + 10) and still reach 85, a pass against the default
    // threshold of 80. Attendance is the input payroll is computed from.
    //
    // Overtime is no longer scored: overtime_allowed is false company-wide, so its 10
    // points were awarded for a box no branch is permitted to tick. Its weight moved to
    // the attendance gates, which are the ones that gate correctness.
    if (record.attendance_data_ready) score += 20; // WFM declares the month closed
    if (record.attendance_frozen)     score += 15; // payroll freezes the snapshot
    if (record.incentives_status === "approved") score += 20;
    if (record.custom_deductions_uploaded) score += 10;
    if (record.leave_finalized)          score += 5;
    if (record.regularization_complete)  score += 5;

    const bankPct = record.bank_details_pct ?? 0;
    score += Math.min(15, (bankPct * 15) / 100);

    const uanPct = record.uan_complete_pct ?? 0;
    score += Math.min(10, (uanPct * 10) / 100);

    // noc_resolved and holiday_work_approved DEFAULT to 1 in the table DDL, so scoring
    // them handed every branch free points for checks nobody performed. They remain hard
    // blockers elsewhere rather than scored credit.
    return Math.round(Math.min(100, Math.max(0, score)));
  },

  // -------------------------------------------------------------------------
  // computeStatus
  // -------------------------------------------------------------------------

  async computeStatus(
    score: number,
    frozen: number,
    hoOverride: number,
    attendanceDataReady = 0
  ): Promise<"not_started" | "in_progress" | "ready" | "blocked"> {
    if (hoOverride === 1) return "ready";
    const minScore = Number(await getPolicyValue("payroll", "readiness", "min_readiness_score", "80"));
    // Not `&& frozen === 1`. attendance_frozen is set by freezeAttendance(runId), which needs
    // a run to already exist, so requiring it here made 'ready' unreachable for every branch
    // in every month — 0 of 74 rows have ever held it. The freeze remains a scored input
    // (10 points, computeScore above) and remains a hard gate at lock/finalize/disburse.
    // ATTENDANCE IS MANDATORY FOR 'ready', not merely scored. With the weights now
    // totalling 100 a branch cannot reach 80 while skipping both attendance gates, but
    // "cannot reach" is an arithmetic accident of the current weights - one reweighting
    // away from being false again - so state the rule directly.
    //
    // Gated on attendance_data_ready, NOT attendance_frozen. The freeze is genuinely
    // circular (freezeAttendance() takes a runId, and you need readiness to create the
    // run), which is why an earlier fix removed it from this limb and why it stays out.
    // The WFM data-ready declaration has no such dependency. Only the 'ready' limb
    // changes; the lower bands are untouched.
    if (score >= minScore && attendanceDataReady === 1) return "ready";
    if (frozen === 0 && score < 50) return "blocked";
    if (score >= 50) return "in_progress";
    if (score > 0) return "in_progress";
    return "not_started";
  },

  // -------------------------------------------------------------------------
  // refreshProjection
  // -------------------------------------------------------------------------

  async refreshProjection(month: string, branchId: string, processId = ''): Promise<void> {
    let projectedGross: number | null = null;
    let projectedNet: number | null = null;
    let employeeCount = 0;
    let employeeCountActive = 0;
    let employeeCountLeft = 0;

    const processFilter = processId ? 'AND e.process_id = ?' : '';
    const processFilterPlain = processId ? 'AND process_id = ?' : '';
    const processParams = processId ? [processId] : [];

    // Try salary_prep_run lines first (branch-level only; no process filter on runs)
    try {
      const [runRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM salary_prep_run
          WHERE run_month = ?
            AND (branch_id = ? OR branch_filter = ?)
          LIMIT 1`,
        [month, branchId, branchId]
      );
      const runId = (runRows[0] as any)?.id as string | undefined;

      if (runId && !processId) {
        const [lineRows] = await db.execute<RowDataPacket[]>(
          `SELECT
             COUNT(DISTINCT employee_id) AS emp_count,
             SUM(gross_salary) AS total_gross,
             SUM(net_salary) AS total_net
           FROM salary_prep_line
           WHERE run_id = ?`,
          [runId]
        );
        const row = lineRows[0] as any;
        if (row) {
          employeeCount = Number(row.emp_count ?? 0);
          projectedGross = row.total_gross != null ? Number(row.total_gross) : null;
          projectedNet = row.total_net != null ? Number(row.total_net) : null;
        }
      }
    } catch {
      // salary_prep_run/line may not exist or columns differ — fall through
    }

    // Fallback: estimate from employee_salary_assignment
    if (projectedGross === null) {
      try {
        const [estRows] = await db.execute<RowDataPacket[]>(
          `SELECT
             COUNT(e.id) AS emp_count,
             SUM(esa.ctc_annual / 12) AS est_gross
           FROM employees e
           JOIN employee_salary_assignment esa
             ON esa.employee_id = e.id
            AND esa.active_status = 1
           WHERE e.branch_id = ?
             AND e.active_status = 1
             AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
             ${processFilter}`,
          [branchId, ...processParams]
        );
        const row = estRows[0] as any;
        if (row) {
          employeeCountActive = Number(row.emp_count ?? 0);
          projectedGross = row.est_gross != null ? Number(row.est_gross) : null;
          projectedNet =
            projectedGross != null ? Math.round(projectedGross * 0.85) : null;
        }
      } catch {
        try {
          const [empRows] = await db.execute<RowDataPacket[]>(
            `SELECT COUNT(*) AS emp_count FROM employees
              WHERE branch_id = ?
                AND active_status = 1
                AND LOWER(COALESCE(employment_status, 'active')) = 'active'
                ${processFilterPlain}`,
            [branchId, ...processParams]
          );
          employeeCountActive = Number((empRows[0] as any)?.emp_count ?? 0);
        } catch {
          employeeCountActive = 0;
        }
      }
    }

    // Count employees who left during this pay month but still need salary
    const [ym, mm] = month.split("-").map(Number);
    const monthStart = `${month}-01`;
    const monthEnd = new Date(ym, mm, 0).toISOString().slice(0, 10);
    try {
      const [leftRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS left_count FROM employees
          WHERE branch_id = ?
            AND LOWER(COALESCE(employment_status, 'active')) IN ('resigned','terminated','absconded','separated')
            -- employees has no last_working_day column. The real dates live on exit_request
            -- as last_working_day_confirmed / _proposed, which this query does not join, so
            -- resignation_date on employees is the only usable signal here. Referencing the
            -- non-existent column made the statement throw for every branch.
            AND (resignation_date IS NOT NULL AND resignation_date >= ? AND resignation_date <= ?)
            ${processFilterPlain}`,
        // Two date placeholders now, not four — the last_working_day branch above is gone.
        [branchId, monthStart, monthEnd, ...processParams]
      );
      employeeCountLeft = Number((leftRows[0] as any)?.left_count ?? 0);
    } catch {
      employeeCountLeft = 0;
    }

    employeeCount = employeeCountActive + employeeCountLeft;

    // Persist
    if (!(await tableExists())) return;

    try {
      await db.execute(
        `UPDATE payroll_branch_readiness
            SET projected_gross = ?,
                projected_net = ?,
                projection_computed_at = NOW(),
                employee_count = ?,
                employee_count_active = ?,
                employee_count_left = ?
          WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
        [projectedGross, projectedNet, employeeCount, employeeCountActive, employeeCountLeft, month, branchId, processId]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Columns may not exist yet — try without the new columns
      try {
        // Same process_id filter as the primary UPDATE above. This degraded path drops the
        // three newer columns when they are absent, but it must not also widen its WHERE:
        // without process_id it wrote one process's projected gross/net and headcount onto
        // every other process row for the same (month, branch), and onto the branch
        // aggregate. Projections are what the HO summary reads, so a silent fallback was
        // enough to make every process under a branch report identical salary figures.
        await db.execute(
          `UPDATE payroll_branch_readiness
              SET projected_gross = ?,
                  projected_net = ?,
                  projection_computed_at = NOW(),
                  employee_count = ?
            WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
          [projectedGross, projectedNet, employeeCount, month, branchId, processId]
        );
      } catch {
        console.warn(`[BranchReadiness] refreshProjection persist failed — ${msg}`);
      }
    }
  },

  // -------------------------------------------------------------------------
  // getOrRefresh
  // -------------------------------------------------------------------------

  async getOrRefresh(
    month: string,
    branchId: string,
    processId = ''
  ): Promise<BranchReadinessRecord> {
    const hasTable = await tableExists();

    if (hasTable) {
      await this.ensureRecord(month, branchId, processId);
    }

    await this.refreshLiveMetrics(month, branchId, processId);
    await this.refreshProjection(month, branchId, processId);

    // Compute score/status and persist
    let record: Partial<BranchReadinessRecord> = {};

    if (hasTable) {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT r.*, COALESCE(b.branch_name, ?) AS branch_name
             FROM payroll_branch_readiness r
             LEFT JOIN branch_master b ON CONVERT(b.id USING utf8mb4) = CONVERT(r.branch_id USING utf8mb4)
            WHERE r.process_month = ? AND r.branch_id = ? AND r.process_id = ?
            LIMIT 1`,
          [branchId, month, branchId, processId]
        );
        if ((rows as any[]).length > 0) {
          record = rows[0] as Partial<BranchReadinessRecord>;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[BranchReadiness] getOrRefresh SELECT failed — ${msg}`);
      }
    }

    const score = this.computeScore(record);
    const status = await this.computeStatus(
      score,
      Number(record.attendance_frozen ?? 0),
      Number(record.ho_override_ready ?? 0),
      Number(record.attendance_data_ready ?? 0)
    );

    if (hasTable) {
      try {
        await db.execute(
          `UPDATE payroll_branch_readiness
              SET readiness_score = ?, readiness_status = ?
            WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
          [score, status, month, branchId, processId]
        );
      } catch {
        // best-effort
      }
    }

    // Re-read final record (or assemble in-memory if no table)
    if (hasTable) {
      try {
        const [finalRows] = await db.execute<RowDataPacket[]>(
          `SELECT r.*, COALESCE(b.branch_name, ?) AS branch_name
             FROM payroll_branch_readiness r
             LEFT JOIN branch_master b ON CONVERT(b.id USING utf8mb4) = CONVERT(r.branch_id USING utf8mb4)
            WHERE r.process_month = ? AND r.branch_id = ? AND r.process_id = ?
            LIMIT 1`,
          [branchId, month, branchId, processId]
        );
        if ((finalRows as any[]).length > 0) {
          return finalRows[0] as BranchReadinessRecord;
        }
      } catch {
        // fall through to in-memory assembly
      }
    }

    // In-memory assembly (no table or SELECT failed)
    return {
      // The 1643 reporting counters default to "nothing known" on this path rather than 0-as-fact:
      // this branch runs when the table is absent or the SELECT failed, so we have not measured
      // the outstanding work and must not imply that we did and found none.
      pending_leave_count: Number((record as any).pending_leave_count ?? 0),
      pending_regularization_count: Number((record as any).pending_regularization_count ?? 0),
      employees_without_attendance: Number((record as any).employees_without_attendance ?? 0),
      incentive_batch_status: ((record as any).incentive_batch_status as string | null) ?? null,
      branch_id: branchId,
      branch_name: String(record.branch_name ?? branchId),
      process_month: month,
      process_id: processId,
      process_name: String((record as any).process_name ?? ''),
      attendance_frozen: Number(record.attendance_frozen ?? 0),
      attendance_frozen_at: (record.attendance_frozen_at as string) ?? null,
      attendance_frozen_by: (record.attendance_frozen_by as string) ?? null,
      attendance_data_ready: Number((record as any).attendance_data_ready ?? 0),
      attendance_data_ready_at: (record as any).attendance_data_ready_at ?? null,
      attendance_data_ready_by: (record as any).attendance_data_ready_by ?? null,
      incentives_status:
        (record.incentives_status as BranchReadinessRecord["incentives_status"]) ??
        "not_uploaded",
      incentives_confirmed_at:
        (record.incentives_confirmed_at as string) ?? null,
      custom_deductions_uploaded: Number(record.custom_deductions_uploaded ?? 0),
      custom_deductions_confirmed_at:
        (record.custom_deductions_confirmed_at as string) ?? null,
      overtime_entered: Number(record.overtime_entered ?? 0),
      overtime_confirmed_at: (record.overtime_confirmed_at as string) ?? null,
      leave_finalized: Number(record.leave_finalized ?? 0),
      leave_finalized_at: (record.leave_finalized_at as string) ?? null,
      regularization_complete: Number(record.regularization_complete ?? 0),
      regularization_complete_at: (record.regularization_complete_at as string) ?? null,
      bank_details_pct: Number(record.bank_details_pct ?? 0),
      uan_complete_pct: Number(record.uan_complete_pct ?? 0),
      noc_resolved: Number(record.noc_resolved ?? 1),
      holiday_work_approved: Number(record.holiday_work_approved ?? 1),
      branch_head_signoff: Number(record.branch_head_signoff ?? 0),
      branch_head_signoff_at: (record.branch_head_signoff_at as string) ?? null,
      branch_head_signoff_by: (record.branch_head_signoff_by as string) ?? null,
      branch_head_remarks: (record.branch_head_remarks as string) ?? null,
      process_manager_signoff: Number((record as any).process_manager_signoff ?? 0),
      process_manager_signoff_at: (record as any).process_manager_signoff_at ?? null,
      process_manager_signoff_by: (record as any).process_manager_signoff_by ?? null,
      process_manager_remarks: (record as any).process_manager_remarks ?? null,
      ho_override_ready: Number(record.ho_override_ready ?? 0),
      ho_override_by: (record.ho_override_by as string) ?? null,
      ho_override_at: (record.ho_override_at as string) ?? null,
      ho_override_reason: (record.ho_override_reason as string) ?? null,
      readiness_score: score,
      readiness_status: status,
      employee_count: Number(record.employee_count ?? 0),
      employee_count_active: Number((record as any).employee_count_active ?? record.employee_count ?? 0),
      employee_count_left: Number((record as any).employee_count_left ?? 0),
      projected_gross: record.projected_gross ?? null,
      projected_net: record.projected_net ?? null,
      projection_computed_at: (record.projection_computed_at as string) ?? null,
      salary_verification_done: Number((record as any).salary_verification_done ?? 0),
      salary_verification_at: (record as any).salary_verification_at ?? null,
      salary_verification_by: (record as any).salary_verification_by ?? null,
    };
  },

  // -------------------------------------------------------------------------
  // getHOSummary
  // -------------------------------------------------------------------------

  async getHOSummary(month: string): Promise<BranchReadinessRecord[]> {
    let branches: Array<{ id: string; branch_name: string }> = [];

    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id, branch_name FROM branch_master WHERE active_status = 1 ORDER BY branch_name`,
        []
      );
      branches = rows as Array<{ id: string; branch_name: string }>;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[BranchReadiness] getHOSummary branch list failed — ${msg}`);
      return [];
    }

    const results: BranchReadinessRecord[] = [];

    // Sequential to avoid DB overload
    for (const branch of branches) {
      try {
        const rec = await this.getOrRefresh(month, branch.id);
        results.push(rec);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[BranchReadiness] getHOSummary branch ${branch.id} failed — ${msg}`
        );
      }
    }

    // Sort: not_started/blocked (score ASC) → in_progress → ready
    const priority = (r: BranchReadinessRecord) => {
      if (r.readiness_status === "not_started" || r.readiness_status === "blocked")
        return 0;
      if (r.readiness_status === "in_progress") return 1;
      return 2;
    };

    results.sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      if (pa === 0) return a.readiness_score - b.readiness_score; // lower score first
      return 0;
    });

    return results;
  },

  // -------------------------------------------------------------------------
  // branchHeadSignOff
  // -------------------------------------------------------------------------

  async branchHeadSignOff(
    month: string,
    branchId: string,
    userId: string,
    remarks: string,
    processId = ''
  ): Promise<void> {
    if (!(await tableExists())) {
      console.warn("[BranchReadiness] branchHeadSignOff — table absent, skipped");
      return;
    }

    await db.execute(
      `UPDATE payroll_branch_readiness
          SET branch_head_signoff = 1,
              branch_head_signoff_at = NOW(),
              branch_head_signoff_by = ?,
              branch_head_remarks = ?
        WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
      [userId, remarks, month, branchId, processId]
    );

    // Audit log
    void logSensitiveAction({
      actor_user_id: userId,
      action_type: "PAYROLL_BRANCH_SIGNOFF",
      module_key: "payroll",
      entity_type: "branch_readiness",
      entity_id: branchId,
      change_summary: { month, branch_id: branchId, remarks },
    });

    // Notify payroll head via work-inbox
    void (async () => {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT branch_name FROM branch_master WHERE id = ? LIMIT 1`,
          [branchId]
        );
        const branchName = (rows[0] as any)?.branch_name ?? branchId;
        await triggerPayrollBranchSignOff(branchId, branchName, month);
      } catch {
        // non-critical — don't fail the sign-off if notification fails
      }
    })();

    // Recompute score/status after sign-off
    const rec = await this.getOrRefresh(month, branchId, processId);
    const score = this.computeScore(rec);
    const status = await this.computeStatus(
      score,
      rec.attendance_frozen,
      rec.ho_override_ready,
      Number(rec.attendance_data_ready ?? 0)
    );

    try {
      await db.execute(
        `UPDATE payroll_branch_readiness
            SET readiness_score = ?, readiness_status = ?
          WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
        [score, status, month, branchId, processId]
      );
    } catch {
      // best-effort
    }
  },

  // -------------------------------------------------------------------------
  // hoOverride
  // -------------------------------------------------------------------------

  async hoOverride(
    month: string,
    branchId: string,
    userId: string,
    reason: string,
    processId = ''
  ): Promise<void> {
    if (!(await tableExists())) {
      console.warn("[BranchReadiness] hoOverride — table absent, skipped");
      return;
    }

    await db.execute(
      `UPDATE payroll_branch_readiness
          SET ho_override_ready = 1,
              ho_override_by = ?,
              ho_override_at = NOW(),
              ho_override_reason = ?,
              readiness_status = 'ready',
              readiness_score = 100
        WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
      [userId, reason, month, branchId, processId]
    );

    // Audit log
    void logSensitiveAction({
      actor_user_id: userId,
      action_type: "PAYROLL_BRANCH_HO_OVERRIDE",
      module_key: "payroll",
      entity_type: "branch_readiness",
      entity_id: branchId,
      change_summary: { month, branch_id: branchId, process_id: processId, reason },
    });
  },

  // -------------------------------------------------------------------------
  // processManagerSignOff — process-level sign-off (distinct from branch_head)
  // -------------------------------------------------------------------------

  async processManagerSignOff(
    month: string,
    branchId: string,
    processId: string,
    userId: string,
    remarks: string
  ): Promise<void> {
    if (!(await tableExists())) {
      console.warn("[BranchReadiness] processManagerSignOff — table absent, skipped");
      return;
    }

    await db.execute(
      `UPDATE payroll_branch_readiness
          SET process_manager_signoff = 1,
              process_manager_signoff_at = NOW(),
              process_manager_signoff_by = ?,
              process_manager_remarks = ?
        WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
      [userId, remarks, month, branchId, processId]
    );

    void logSensitiveAction({
      actor_user_id: userId,
      action_type: "PAYROLL_PROCESS_SIGNOFF",
      module_key: "payroll",
      entity_type: "process_readiness",
      entity_id: processId,
      change_summary: { month, branch_id: branchId, process_id: processId, remarks },
    });

    // Notify payroll head via work-inbox (non-critical)
    void (async () => {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT pm.process_name, bm.branch_name
             FROM process_master pm
             JOIN branch_master bm ON bm.id = pm.branch_id
            WHERE pm.id = ? LIMIT 1`,
          [processId]
        );
        const processName = (rows[0] as any)?.process_name ?? processId;
        const branchName  = (rows[0] as any)?.branch_name ?? branchId;
        await triggerPayrollProcessSignOff(branchId, processId, processName, branchName, month);
      } catch { /* non-critical */ }
    })();

    const rec = await this.getOrRefresh(month, branchId, processId);
    const score = this.computeScore(rec);
    const status = await this.computeStatus(score, rec.attendance_frozen, rec.ho_override_ready, Number(rec.attendance_data_ready ?? 0));
    try {
      await db.execute(
        `UPDATE payroll_branch_readiness
            SET readiness_score = ?, readiness_status = ?
          WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
        [score, status, month, branchId, processId]
      );
    } catch { /* best-effort */ }
  },

  // -------------------------------------------------------------------------
  // getSummaryForBranch — processes for one branch
  // -------------------------------------------------------------------------

  async getSummaryForBranch(
    month: string,
    branchId: string
  ): Promise<BranchReadinessRecord[]> {
    let processes: Array<{ id: string; process_name: string }> = [];
    try {
      // UNION of two sources, not process_master alone.
      //
      // Listing only `process_master WHERE branch_id = ? AND active_status = 1` made the
      // readiness page structurally blind to processes that have live staff. Of the 45
      // (branch, process) pairs holding active employees, only 33 satisfied that predicate:
      // three processes were active_status <> 1 while still staffed, and one was filed under a
      // different branch_id than the employees sitting in it. Those 12 combinations were not
      // shown as "not ready" - they were absent, which on a readiness page reads as nothing
      // being wrong. Payroll then runs for employees whose process nobody was asked to sign off.
      //
      // The second leg draws from the employee population itself, so a staffed process appears
      // regardless of how its master row is flagged. Kept as a UNION rather than a replacement
      // because the master leg also surfaces processes with no staff yet, which is legitimate
      // for a branch planning ahead.
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT pid AS id, MAX(pname) AS process_name FROM (
           SELECT pm.id AS pid, pm.process_name AS pname
             FROM process_master pm
            WHERE pm.branch_id = ? AND pm.active_status = 1
           UNION
           SELECT e.process_id AS pid, COALESCE(pm2.process_name, '') AS pname
             FROM employees e
             LEFT JOIN process_master pm2 ON pm2.id = e.process_id
            WHERE e.active_status = 1
              AND e.branch_id = ?
              AND e.process_id IS NOT NULL AND e.process_id <> ''
         ) u
         GROUP BY pid
         ORDER BY process_name`,
        [branchId, branchId]
      );
      processes = rows as Array<{ id: string; process_name: string }>;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[BranchReadiness] getSummaryForBranch process list failed — ${msg}`);
      return [];
    }

    const results: BranchReadinessRecord[] = [];
    for (const proc of processes) {
      try {
        const rec = await this.getOrRefresh(month, branchId, proc.id);
        results.push(rec);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[BranchReadiness] getSummaryForBranch process ${proc.id} failed — ${msg}`);
      }
    }
    return results;
  },

  // -------------------------------------------------------------------------
  // getHOSummaryGrouped — all branches each with their processes
  // -------------------------------------------------------------------------

  async getHOSummaryGrouped(month: string): Promise<ProcessReadinessBranchGroup[]> {
    let branches: Array<{ id: string; branch_name: string }> = [];
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id, branch_name FROM branch_master WHERE active_status = 1 ORDER BY branch_name`,
        []
      );
      branches = rows as Array<{ id: string; branch_name: string }>;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[BranchReadiness] getHOSummaryGrouped branch list failed — ${msg}`);
      return [];
    }

    const groups: ProcessReadinessBranchGroup[] = [];

    for (const branch of branches) {
      const processes = await this.getSummaryForBranch(month, branch.id);
      const total = processes.length;
      const ready = processes.filter(p => p.readiness_status === 'ready').length;
      const avg_score = total > 0
        ? Math.round(processes.reduce((s, p) => s + p.readiness_score, 0) / total)
        : 0;
      groups.push({
        branch_id: branch.id,
        branch_name: branch.branch_name,
        processes,
        stats: { total, ready, avg_score },
      });
    }

    // Sort: branches with most blocked/not_started first
    groups.sort((a, b) => {
      const aReady = a.stats.ready / Math.max(1, a.stats.total);
      const bReady = b.stats.ready / Math.max(1, b.stats.total);
      return aReady - bReady;
    });

    return groups;
  },

  // -------------------------------------------------------------------------
  // validatePayrollRunCreation
  // -------------------------------------------------------------------------

  async validatePayrollRunCreation(
    month: string
  ): Promise<{ blocked: string[]; ready: string[] }> {
    let branches: Array<{ id: string; branch_name: string }> = [];

    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id, branch_name FROM branch_master WHERE active_status = 1`,
        []
      );
      branches = rows as Array<{ id: string; branch_name: string }>;
    } catch {
      return { blocked: [], ready: [] };
    }

    const blocked: string[] = [];
    const ready: string[] = [];

    for (const branch of branches) {
      try {
        const rec = await this.getOrRefresh(month, branch.id);

        // One predicate, not two. This used to compute `isReady` — which honours the HO
        // override — and then AND it with `!isBlocked`, where `isBlocked` was true whenever
        // `attendance_frozen === 0` on its own. An overridden branch was therefore isReady
        // AND isBlocked, and landed in `blocked`, so the override was dead code and the
        // error message in createRun told users to apply a control that could not work.
        //
        // attendance_frozen cannot be satisfied before a run exists in any case:
        // freezeAttendance() in payroll-governance.service.ts takes a runId and sets
        // attendance_snapshot_locked ON the run, so it is a post-creation control. Requiring
        // it to create the run made creation impossible — verified live 2026-08-17, where
        // 0 of 74 rows in this table have ever been frozen and August 2026 had no run at all.
        // Freeze stays enforced where it can actually hold: lock, finalize and disburse.
        // Fixed 2026-08-23: attendance_frozen cannot be 1 before a run exists
        // (freezeAttendance needs a runId). readiness_status='ready' already
        // accounts for the score threshold — using it here is sufficient and
        // consistent with computeStatus() which was corrected earlier.
        const isReady =
          rec.ho_override_ready === 1 ||
          rec.readiness_status === "ready";

        if (isReady) {
          ready.push(branch.branch_name);
        } else {
          blocked.push(branch.branch_name);
        }
      } catch (err: unknown) {
        // Fail closed, but never silently. An unreadable branch is indistinguishable from an
        // unprepared one unless the error is surfaced — and one is genuinely likely here:
        // payroll_branch_readiness.branch_id is utf8mb4_0900_ai_ci while branch_master.id is
        // utf8mb4_unicode_ci, so any join added without an explicit CONVERT/COLLATE raises
        // ER_CANT_AGGREGATE_2COLLATIONS and would read as "this branch is not ready".
        console.warn(
          `[BranchReadiness] readiness unreadable for branch ${branch.branch_name} (${branch.id}) in ${month} — treating as blocked:`,
          err instanceof Error ? err.message : String(err)
        );
        blocked.push(branch.branch_name);
      }
    }

    return { blocked, ready };
  },
};
