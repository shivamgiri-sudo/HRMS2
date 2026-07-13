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

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BranchReadinessRecord {
  branch_id: string;
  branch_name: string;
  process_month: string;
  // checklist items (0 = no, 1 = yes)
  attendance_frozen: number;
  attendance_frozen_at: string | null;
  attendance_frozen_by: string | null;
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
  projected_gross: number | null;
  projected_net: number | null;
  projection_computed_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

  async ensureRecord(month: string, branchId: string): Promise<void> {
    if (!(await tableExists())) return;

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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[BranchReadiness] ensureRecord failed — ${msg}`);
    }
  },

  // -------------------------------------------------------------------------
  // refreshLiveMetrics
  // -------------------------------------------------------------------------

  async refreshLiveMetrics(month: string, branchId: string): Promise<void> {
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
               AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'`,
            [branchId]
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
               AND LOWER(COALESCE(employment_status, 'active')) = 'active'`,
            [branchId]
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
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN pf_uan IS NOT NULL AND TRIM(pf_uan) != '' THEN 1 ELSE 0 END) AS with_uan
           FROM employees
           WHERE branch_id = ?
             AND active_status = 1
             AND LOWER(COALESCE(employment_status, 'active')) = 'active'`,
          [branchId]
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
    const values = [...Object.values(updates), month, branchId];

    try {
      await db.execute(
        `UPDATE payroll_branch_readiness
            SET ${setClauses}
          WHERE process_month = ? AND branch_id = ?`,
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

    if (record.attendance_frozen) score += 25;
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

  computeStatus(
    score: number,
    frozen: number,
    hoOverride: number
  ): "not_started" | "in_progress" | "ready" | "blocked" {
    if (hoOverride === 1) return "ready";
    if (score >= 80 && frozen === 1) return "ready";
    if (frozen === 0 && score < 50) return "blocked";
    if (score >= 50) return "in_progress";
    if (score > 0) return "in_progress";
    return "not_started";
  },

  // -------------------------------------------------------------------------
  // refreshProjection
  // -------------------------------------------------------------------------

  async refreshProjection(month: string, branchId: string): Promise<void> {
    let projectedGross: number | null = null;
    let projectedNet: number | null = null;
    let employeeCount = 0;

    // Try salary_prep_run lines first
    try {
      const [runRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM salary_prep_run
          WHERE run_month = ?
            AND (branch_id = ? OR branch_filter = ?)
          LIMIT 1`,
        [month, branchId, branchId]
      );
      const runId = (runRows[0] as any)?.id as string | undefined;

      if (runId) {
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
             AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'`,
          [branchId]
        );
        const row = estRows[0] as any;
        if (row) {
          employeeCount = Number(row.emp_count ?? 0);
          projectedGross = row.est_gross != null ? Number(row.est_gross) : null;
          // Net estimated as 85% of gross (rough heuristic before deductions computed)
          projectedNet =
            projectedGross != null ? Math.round(projectedGross * 0.85) : null;
        }
      } catch {
        // employee_salary_assignment may not exist
        try {
          const [empRows] = await db.execute<RowDataPacket[]>(
            `SELECT COUNT(*) AS emp_count FROM employees
              WHERE branch_id = ?
                AND active_status = 1
                AND LOWER(COALESCE(employment_status, 'active')) = 'active'`,
            [branchId]
          );
          employeeCount = Number((empRows[0] as any)?.emp_count ?? 0);
        } catch {
          employeeCount = 0;
        }
      }
    }

    // Persist
    if (!(await tableExists())) return;

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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[BranchReadiness] refreshProjection persist failed — ${msg}`);
    }
  },

  // -------------------------------------------------------------------------
  // getOrRefresh
  // -------------------------------------------------------------------------

  async getOrRefresh(
    month: string,
    branchId: string
  ): Promise<BranchReadinessRecord> {
    const hasTable = await tableExists();

    if (hasTable) {
      await this.ensureRecord(month, branchId);
    }

    await this.refreshLiveMetrics(month, branchId);
    await this.refreshProjection(month, branchId);

    // Compute score/status and persist
    let record: Partial<BranchReadinessRecord> = {};

    if (hasTable) {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT r.*, COALESCE(b.branch_name, ?) AS branch_name
             FROM payroll_branch_readiness r
             LEFT JOIN branch_master b ON b.id = r.branch_id
            WHERE r.process_month = ? AND r.branch_id = ?
            LIMIT 1`,
          [branchId, month, branchId]
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
    const status = this.computeStatus(
      score,
      Number(record.attendance_frozen ?? 0),
      Number(record.ho_override_ready ?? 0)
    );

    if (hasTable) {
      try {
        await db.execute(
          `UPDATE payroll_branch_readiness
              SET readiness_score = ?, readiness_status = ?
            WHERE process_month = ? AND branch_id = ?`,
          [score, status, month, branchId]
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
            WHERE r.process_month = ? AND r.branch_id = ?
            LIMIT 1`,
          [branchId, month, branchId]
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
      attendance_frozen: Number(record.attendance_frozen ?? 0),
      attendance_frozen_at: (record.attendance_frozen_at as string) ?? null,
      attendance_frozen_by: (record.attendance_frozen_by as string) ?? null,
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
      ho_override_ready: Number(record.ho_override_ready ?? 0),
      ho_override_by: (record.ho_override_by as string) ?? null,
      ho_override_at: (record.ho_override_at as string) ?? null,
      ho_override_reason: (record.ho_override_reason as string) ?? null,
      readiness_score: score,
      readiness_status: status,
      employee_count: Number(record.employee_count ?? 0),
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
    remarks: string
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
        WHERE process_month = ? AND branch_id = ?`,
      [userId, remarks, month, branchId]
    );

    // Recompute score/status after sign-off
    const rec = await this.getOrRefresh(month, branchId);
    const score = this.computeScore(rec);
    const status = this.computeStatus(
      score,
      rec.attendance_frozen,
      rec.ho_override_ready
    );

    try {
      await db.execute(
        `UPDATE payroll_branch_readiness
            SET readiness_score = ?, readiness_status = ?
          WHERE process_month = ? AND branch_id = ?`,
        [score, status, month, branchId]
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
    reason: string
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
        WHERE process_month = ? AND branch_id = ?`,
      [userId, reason, month, branchId]
    );
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
