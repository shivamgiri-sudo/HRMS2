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

        bank_details_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        uan_complete_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        noc_resolved TINYINT(1) NOT NULL DEFAULT 0,
        holiday_work_approved TINYINT(1) NOT NULL DEFAULT 0,

        branch_head_signoff TINYINT(1) NOT NULL DEFAULT 0,
        branch_head_signoff_at DATETIME NULL,
        branch_head_signoff_by VARCHAR(36) NULL,
        branch_head_remarks TEXT NULL,

        readiness_score DECIMAL(5,2) NOT NULL DEFAULT 0,
        readiness_status ENUM('not_started','in_progress','ready','blocked') NOT NULL DEFAULT 'not_started',

        projected_gross DECIMAL(14,2) NULL,
        projected_net DECIMAL(14,2) NULL,
        employee_count INT NOT NULL DEFAULT 0,
        employee_count_active INT NOT NULL DEFAULT 0,
        employee_count_left INT NOT NULL DEFAULT 0,
        projection_computed_at DATETIME NULL,

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
            attendance_frozen, incentives_status,
            custom_deductions_uploaded, overtime_entered,
            bank_details_pct, uan_complete_pct, noc_resolved, holiday_work_approved,
            branch_head_signoff, ho_override_ready,
            readiness_score, readiness_status, employee_count)
         VALUES (?, ?, ?, ?, 0, 'not_uploaded', 0, 0, 0, 0, 1, 1, 0, 0, 0, 'not_started', 0)`,
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
  // refreshLiveMetrics
  // -------------------------------------------------------------------------

  async refreshLiveMetrics(month: string, branchId: string, processId = ''): Promise<void> {
    const updates: Record<string, unknown> = {};

    // --- attendance_frozen ---------------------------------------------------
    const attendanceFrozen = await safeQuery(
      async () => {
        // Check salary_prep_run first
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT attendance_snapshot_locked
             FROM salary_prep_run
            WHERE run_month = ?
              AND (branch_id = ? OR branch_filter = ?)
            LIMIT 1`,
          [month, branchId, branchId]
        );
        if ((rows as any[]).length > 0) {
          return Number((rows[0] as any).attendance_snapshot_locked ?? 0);
        }

        // Fallback: check payroll_attendance_snapshot table
        try {
          const [snapRows] = await db.execute<RowDataPacket[]>(
            `SELECT COUNT(*) AS cnt
               FROM payroll_attendance_snapshot
              WHERE pay_month = ? AND branch_id = ? AND is_locked = 1
              LIMIT 1`,
            [month, branchId]
          );
          return Number((snapRows[0] as any)?.cnt ?? 0) > 0 ? 1 : 0;
        } catch {
          return 0;
        }
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
             SUM(CASE WHEN pf_uan IS NOT NULL AND TRIM(pf_uan) != '' THEN 1 ELSE 0 END) AS with_uan
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
    const nocResolved = await safeQuery(
      async () => {
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
          } catch {
            continue;
          }
        }
        return 1; // table doesn't exist — treat as resolved
      },
      1,
      "noc_resolved"
    );
    updates.noc_resolved = nocResolved;

    // --- holiday_work_approved -----------------------------------------------
    const holidayWorkApproved = await safeQuery(
      async () => {
        const [year, mon] = month.split("-");
        const monthStart = `${year}-${mon}-01`;
        const lastDay = new Date(Number(year), Number(mon), 0).getDate();
        const monthEnd = `${year}-${mon}-${String(lastDay).padStart(2, "0")}`;

        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt
             FROM holiday_work_request
            WHERE branch_id = ?
              AND status = 'pending'
              AND work_date BETWEEN ? AND ?`,
          [branchId, monthStart, monthEnd]
        );
        const cnt = Number((rows[0] as any)?.cnt ?? 0);
        return cnt === 0 ? 1 : 0;
      },
      1,
      "holiday_work_approved"
    );
    updates.holiday_work_approved = holidayWorkApproved;

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

    if (record.attendance_data_ready) score += 15; // WFM declaration (new)
    if (record.attendance_frozen)     score += 10; // payroll freeze (was 25)
    if (record.incentives_status === "approved") score += 20;
    if (record.custom_deductions_uploaded) score += 10;
    if (record.overtime_entered) score += 10;

    const bankPct = record.bank_details_pct ?? 0;
    score += Math.min(15, (bankPct * 15) / 100);

    const uanPct = record.uan_complete_pct ?? 0;
    score += Math.min(10, (uanPct * 10) / 100);

    if (record.noc_resolved) score += 5;
    if (record.holiday_work_approved) score += 5;

    return Math.round(Math.min(100, Math.max(0, score)));
  },

  // -------------------------------------------------------------------------
  // computeStatus
  // -------------------------------------------------------------------------

  async computeStatus(
    score: number,
    frozen: number,
    hoOverride: number
  ): Promise<"not_started" | "in_progress" | "ready" | "blocked"> {
    if (hoOverride === 1) return "ready";
    const minScore = Number(await getPolicyValue("payroll", "readiness", "min_readiness_score", "80"));
    if (score >= minScore && frozen === 1) return "ready";
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
             COALESCE(SUM(gross_pay), SUM(gross_salary), SUM(gross_amount)) AS total_gross,
             COALESCE(SUM(net_pay), SUM(net_salary), SUM(net_amount)) AS total_net
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
            AND (
              (last_working_day IS NOT NULL AND last_working_day >= ? AND last_working_day <= ?)
              OR (resignation_date IS NOT NULL AND resignation_date >= ? AND resignation_date <= ?
                  AND last_working_day IS NULL)
            )
            ${processFilterPlain}`,
        [branchId, monthStart, monthEnd, monthStart, monthEnd, ...processParams]
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
        await db.execute(
          `UPDATE payroll_branch_readiness
              SET projected_gross = ?,
                  projected_net = ?,
                  projection_computed_at = NOW(),
                  employee_count = ?
            WHERE process_month = ? AND branch_id = ?`,
          [projectedGross, projectedNet, employeeCount, month, branchId]
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
             LEFT JOIN branch_master b ON b.id = r.branch_id
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
      Number(record.ho_override_ready ?? 0)
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
             LEFT JOIN branch_master b ON b.id = r.branch_id
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
      rec.ho_override_ready
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
    const status = await this.computeStatus(score, rec.attendance_frozen, rec.ho_override_ready);
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
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id, process_name FROM process_master
          WHERE branch_id = ? AND active_status = 1
          ORDER BY process_name`,
        [branchId]
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
        const isReady =
          rec.ho_override_ready === 1 ||
          (rec.attendance_frozen === 1 && rec.readiness_status === "ready");
        const isBlocked =
          rec.attendance_frozen === 0 ||
          (rec.ho_override_ready === 0 && rec.readiness_status !== "ready");

        if (isReady && !isBlocked) {
          ready.push(branch.branch_name);
        } else {
          blocked.push(branch.branch_name);
        }
      } catch {
        blocked.push(branch.branch_name);
      }
    }

    return { blocked, ready };
  },
};
