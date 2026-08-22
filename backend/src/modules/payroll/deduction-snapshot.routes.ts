/**
 * Deduction & Qual-Incentive snapshot routes — mounted at /api/payroll
 *
 * Read-only endpoints exposing the db_bill mirror tables:
 *   upload_deduction_snapshot   → /api/payroll/deduction-snapshot
 *   qual_incentive_snapshot     → /api/payroll/qual-incentive-snapshot
 *
 * These are the source-of-truth snapshots for what db_bill holds.
 * They should match db_bill exactly after each nightly sync.
 */

import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";

export const deductionSnapshotRouter = Router();

type RouteHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h =
  (fn: RouteHandler) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void): void => {
    void fn(req, res).catch(next);
  };

const READ_ROLES = ["super_admin", "hr_admin", "payroll", "payroll_head", "finance", "branch_head"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// upload_deduction_snapshot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/payroll/deduction-snapshot/months
 * Returns distinct salary_month values available in the snapshot.
 */
deductionSnapshotRouter.get(
  "/deduction-snapshot/months",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...READ_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT salary_month
         FROM upload_deduction_snapshot
        WHERE salary_month IS NOT NULL
        ORDER BY salary_month DESC
        LIMIT 36`
    );
    return res.json({ success: true, data: rows.map((r) => r.salary_month as string) });
  })
);

/**
 * GET /api/payroll/deduction-snapshot
 * Query params: salary_month (YYYY-MM), branch_name, employee_code, page, limit
 */
deductionSnapshotRouter.get(
  "/deduction-snapshot",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...READ_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { salary_month, branch_name, employee_code } = req.query as Record<string, string>;
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const offset = (page - 1) * limit;

    const conds: string[] = [];
    const params: unknown[] = [];

    if (salary_month)  { conds.push("salary_month = ?");   params.push(salary_month); }
    if (branch_name)   { conds.push("branch_name = ?");    params.push(branch_name); }
    if (employee_code) { conds.push("employee_code = ?");  params.push(employee_code); }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [[{ total }]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM upload_deduction_snapshot ${where}`,
      params
    ) as [RowDataPacket[], unknown];

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, branch_name, cost_center, employee_code, employee_name,
              salary_month, mobile_deduction, short_collection, asset_recovery,
              insurance, professional_tax, leave_deduction, others_deduction,
              remarks, deduction_remarks, process_status, import_date, synced_at
         FROM upload_deduction_snapshot
         ${where}
         ORDER BY salary_month DESC, branch_name, employee_code
         LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return res.json({ success: true, data: rows, total: Number(total), page, limit });
  })
);

/**
 * GET /api/payroll/deduction-snapshot/summary
 * Returns per-branch totals for a given salary_month.
 * Query params: salary_month (YYYY-MM, required)
 */
deductionSnapshotRouter.get(
  "/deduction-snapshot/summary",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...READ_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { salary_month } = req.query as Record<string, string>;
    if (!salary_month) {
      return res.status(400).json({ success: false, message: "salary_month is required (YYYY-MM)" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         branch_name,
         COUNT(*) AS employee_count,
         SUM(mobile_deduction)  AS mobile_deduction,
         SUM(short_collection)  AS short_collection,
         SUM(asset_recovery)    AS asset_recovery,
         SUM(insurance)         AS insurance,
         SUM(professional_tax)  AS professional_tax,
         SUM(leave_deduction)   AS leave_deduction,
         SUM(others_deduction)  AS others_deduction,
         SUM(mobile_deduction + short_collection + asset_recovery +
             insurance + professional_tax + leave_deduction + others_deduction) AS total_deduction
       FROM upload_deduction_snapshot
       WHERE salary_month = ?
       GROUP BY branch_name
       ORDER BY branch_name`,
      [salary_month]
    );

    const [[totalsRow]] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS employee_count,
         SUM(mobile_deduction)  AS mobile_deduction,
         SUM(short_collection)  AS short_collection,
         SUM(asset_recovery)    AS asset_recovery,
         SUM(insurance)         AS insurance,
         SUM(professional_tax)  AS professional_tax,
         SUM(leave_deduction)   AS leave_deduction,
         SUM(others_deduction)  AS others_deduction,
         SUM(mobile_deduction + short_collection + asset_recovery +
             insurance + professional_tax + leave_deduction + others_deduction) AS total_deduction
       FROM upload_deduction_snapshot
       WHERE salary_month = ?`,
      [salary_month]
    );

    return res.json({ success: true, data: rows, totals: totalsRow, salary_month });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// qual_incentive_snapshot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/payroll/qual-incentive-snapshot/months
 * Returns distinct sal_year + sal_month combos.
 */
deductionSnapshotRouter.get(
  "/qual-incentive-snapshot/months",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...READ_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT sal_year, sal_month
         FROM qual_incentive_snapshot
        WHERE sal_year IS NOT NULL AND sal_month IS NOT NULL
        ORDER BY sal_year DESC, FIELD(sal_month,
          'Jan','Feb','Mar','Apr','May','Jun',
          'Jul','Aug','Sep','Oct','Nov','Dec') DESC
        LIMIT 48`
    );
    return res.json({ success: true, data: rows });
  })
);

/**
 * GET /api/payroll/qual-incentive-snapshot
 * Query params: sal_year, sal_month, employee_code, page, limit
 */
deductionSnapshotRouter.get(
  "/qual-incentive-snapshot",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...READ_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { sal_year, sal_month, employee_code } = req.query as Record<string, string>;
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const offset = (page - 1) * limit;

    const conds: string[] = [];
    const params: unknown[] = [];

    if (sal_year)      { conds.push("sal_year = ?");      params.push(sal_year); }
    if (sal_month)     { conds.push("sal_month = ?");     params.push(sal_month); }
    if (employee_code) { conds.push("employee_code = ?"); params.push(employee_code); }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [[{ total }]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM qual_incentive_snapshot ${where}`,
      params
    ) as [RowDataPacket[], unknown];

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT q.id, q.employee_code, q.sal_year, q.sal_month, q.amount,
              q.remarks, q.import_date, q.synced_at,
              CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) AS employee_name,
              b.branch_name
         FROM qual_incentive_snapshot q
         LEFT JOIN employees e ON e.employee_code = q.employee_code
         LEFT JOIN branch_master b ON b.id = e.branch_id
         ${where}
         ORDER BY q.sal_year DESC, FIELD(q.sal_month,
           'Jan','Feb','Mar','Apr','May','Jun',
           'Jul','Aug','Sep','Oct','Nov','Dec') DESC,
           q.employee_code
         LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return res.json({ success: true, data: rows, total: Number(total), page, limit });
  })
);

/**
 * GET /api/payroll/qual-incentive-snapshot/summary
 * Returns totals for a given sal_year + sal_month.
 */
deductionSnapshotRouter.get(
  "/qual-incentive-snapshot/summary",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...READ_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { sal_year, sal_month } = req.query as Record<string, string>;
    if (!sal_year || !sal_month) {
      return res.status(400).json({ success: false, message: "sal_year and sal_month are required" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(b.branch_name, 'Unknown') AS branch_name,
         COUNT(*) AS employee_count,
         SUM(q.amount) AS total_amount
       FROM qual_incentive_snapshot q
       LEFT JOIN employees e ON e.employee_code = q.employee_code
       LEFT JOIN branch_master b ON b.id = e.branch_id
       WHERE q.sal_year = ? AND q.sal_month = ?
       GROUP BY b.branch_name
       ORDER BY b.branch_name`,
      [sal_year, sal_month]
    );

    const [[totalsRow]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS employee_count, SUM(amount) AS total_amount
         FROM qual_incentive_snapshot
        WHERE sal_year = ? AND sal_month = ?`,
      [sal_year, sal_month]
    );

    return res.json({ success: true, data: rows, totals: totalsRow, sal_year, sal_month });
  })
);
