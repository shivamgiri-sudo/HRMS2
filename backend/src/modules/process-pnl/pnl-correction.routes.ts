/**
 * pnl-correction.routes.ts
 *
 * CRUD for pnl_monthly_correction — Finance team manual P&L reconciliation entries.
 * Also exposes GET /api/pnl/period-status, a read-only diagnostic for a given period.
 *
 * Mount in app.ts:
 *   app.use("/api/finance", pnlCorrectionRouter);
 * (before processPnlRouter so the /pnl/period-status and /pnl/corrections paths are
 *  handled here and not swallowed by processPnlRouter's requireRole("/pnl") gate.)
 */

import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { randomUUID } from "crypto";

const router = Router();

const CORRECTION_WRITE_ROLES = ["finance_head", "super_admin"] as const;
const CORRECTION_READ_ROLES = [
  "super_admin",
  "admin",
  "ceo",
  "coo",
  "finance",
  "finance_head",
  "accounts_head",
  "payroll_head",
] as const;

const LINE_ITEM_VALUES = ["revenue", "salary", "grn", "ebitda"] as const;
type LineItem = (typeof LINE_ITEM_VALUES)[number];

const PERIOD_RE = /^\d{4}-\d{2}$/;

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

function bad(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function notFound(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 404 });
}

// ---------------------------------------------------------------------------
// GET /api/finance/pnl/corrections
// ---------------------------------------------------------------------------
router.get(
  "/pnl/corrections",
  requireAuth,
  requireRole(...CORRECTION_READ_ROLES),
  h(async (req, res) => {
    const period = req.query.period ? String(req.query.period) : null;
    const company = req.query.company ? String(req.query.company) : null;

    if (period && !PERIOD_RE.test(period)) bad("period must be YYYY-MM");

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (period) {
      conditions.push("pmc.period_code = ?");
      params.push(period);
    }
    if (company) {
      conditions.push("pmc.company_name = ?");
      params.push(company);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pmc.id, pmc.period_code, pmc.company_name, pmc.line_item,
              pmc.amount, pmc.reason, pmc.created_by,
              COALESCE(e.full_name, au.email) AS created_by_name,
              pmc.created_at, pmc.updated_at
         FROM pnl_monthly_correction pmc
         LEFT JOIN auth_user au ON au.id = pmc.created_by
         LEFT JOIN employees e ON e.user_id = pmc.created_by
         ${where}
         ORDER BY pmc.created_at DESC`,
      params,
    );

    res.json({ success: true, data: rows });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/finance/pnl/corrections
// ---------------------------------------------------------------------------
router.post(
  "/pnl/corrections",
  requireAuth,
  requireWriteAccess,
  requireRole(...CORRECTION_WRITE_ROLES),
  h(async (req, res) => {
    const { period_code, company_name, line_item, amount, reason } =
      req.body ?? {};

    if (!period_code || !PERIOD_RE.test(String(period_code)))
      bad("period_code must be YYYY-MM");
    if (!line_item || !LINE_ITEM_VALUES.includes(String(line_item) as LineItem))
      bad(
        `line_item must be one of: ${LINE_ITEM_VALUES.join(", ")}`,
      );
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount === 0)
      bad("amount must be a non-zero decimal");

    const id = randomUUID();
    const companyVal =
      company_name
        ? String(company_name)
        : "Mas Callnet India Pvt Ltd";
    const reasonVal = reason ? String(reason) : null;
    const createdBy =
      (req as AuthenticatedRequest).authUser?.id ?? null;

    await db.execute<ResultSetHeader>(
      `INSERT INTO pnl_monthly_correction
         (id, period_code, company_name, line_item, amount, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, String(period_code), companyVal, String(line_item), numAmount, reasonVal, createdBy],
    );

    const [created] = await db.execute<RowDataPacket[]>(
      `SELECT pmc.id, pmc.period_code, pmc.company_name, pmc.line_item,
              pmc.amount, pmc.reason, pmc.created_by,
              COALESCE(e.full_name, au.email) AS created_by_name,
              pmc.created_at, pmc.updated_at
         FROM pnl_monthly_correction pmc
         LEFT JOIN auth_user au ON au.id = pmc.created_by
         LEFT JOIN employees e ON e.user_id = pmc.created_by
        WHERE pmc.id = ?`,
      [id],
    );

    res.status(201).json({ success: true, data: created[0] ?? null });
  }),
);

// ---------------------------------------------------------------------------
// PUT /api/finance/pnl/corrections/:id
// ---------------------------------------------------------------------------
router.put(
  "/pnl/corrections/:id",
  requireAuth,
  requireWriteAccess,
  requireRole(...CORRECTION_WRITE_ROLES),
  h(async (req, res) => {
    const { id } = req.params;
    const { amount, reason } = req.body ?? {};

    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount === 0)
      bad("amount must be a non-zero decimal");

    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM pnl_monthly_correction WHERE id = ?`,
      [id],
    );
    if (!existing.length) notFound("Correction not found");

    await db.execute<ResultSetHeader>(
      `UPDATE pnl_monthly_correction SET amount = ?, reason = ? WHERE id = ?`,
      [numAmount, reason ? String(reason) : null, id],
    );

    const [updated] = await db.execute<RowDataPacket[]>(
      `SELECT pmc.id, pmc.period_code, pmc.company_name, pmc.line_item,
              pmc.amount, pmc.reason, pmc.created_by,
              COALESCE(e.full_name, au.email) AS created_by_name,
              pmc.created_at, pmc.updated_at
         FROM pnl_monthly_correction pmc
         LEFT JOIN auth_user au ON au.id = pmc.created_by
         LEFT JOIN employees e ON e.user_id = pmc.created_by
        WHERE pmc.id = ?`,
      [id],
    );

    res.json({ success: true, data: updated[0] ?? null });
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/finance/pnl/corrections/:id
// ---------------------------------------------------------------------------
router.delete(
  "/pnl/corrections/:id",
  requireAuth,
  requireWriteAccess,
  requireRole(...CORRECTION_WRITE_ROLES),
  h(async (req, res) => {
    const { id } = req.params;

    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM pnl_monthly_correction WHERE id = ?`,
      [id],
    );
    if (!existing.length) notFound("Correction not found");

    await db.execute<ResultSetHeader>(
      `DELETE FROM pnl_monthly_correction WHERE id = ?`,
      [id],
    );

    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/finance/pnl/period-status
// ---------------------------------------------------------------------------
router.get(
  "/pnl/period-status",
  requireAuth,
  requireRole(...CORRECTION_READ_ROLES),
  h(async (req, res) => {
    const period = req.query.period ? String(req.query.period) : "";
    if (!PERIOD_RE.test(period)) bad("period must be YYYY-MM");

    // 1. Salary basis — finalised payroll run means ACTUAL, else ACCRUAL
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_prep_run
        WHERE run_month = ?
          AND status IN ('finalized','FINALIZED','approved','disbursed','locked')
        LIMIT 1`,
      [period],
    );
    const salaryBasis: "ACTUAL" | "ACCRUAL" =
      runRows.length > 0 ? "ACTUAL" : "ACCRUAL";

    const salaryRunStatus: "finalized" | "draft" | "none" = await (async () => {
      const [allRuns] = await db.execute<RowDataPacket[]>(
        `SELECT status FROM salary_prep_run WHERE run_month = ? LIMIT 1`,
        [period],
      );
      if (!allRuns.length) return "none";
      const s = String(allRuns[0]!.status ?? "").toLowerCase();
      if (["finalized", "approved", "disbursed", "locked"].includes(s))
        return "finalized";
      return "draft";
    })();

    // 2. Revenue mode — count by billing source
    const [revRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN bip.billing_type = 'forecast'  THEN 1 ELSE 0 END) AS forecast_count,
         SUM(CASE WHEN bip.billing_type = 'invoiced'  THEN 1 ELSE 0 END) AS invoiced_count,
         SUM(CASE WHEN bip.billing_type = 'estimated' THEN 1 ELSE 0 END) AS estimated_count
       FROM billing_invoice_particular bip
       WHERE bip.period_code = ?`,
      [period],
    ).catch(() => [[{ forecast_count: 0, invoiced_count: 0, estimated_count: 0 }]]);

    const rv = (revRows as RowDataPacket[])[0] ?? {};
    const revenueMode = {
      forecastCostCentres: Number(rv.forecast_count ?? 0),
      invoicedCostCentres: Number(rv.invoiced_count ?? 0),
      estimatedCostCentres: Number(rv.estimated_count ?? 0),
    };

    // 3. GRN source — periods before 2026-10 include legacy mirror data
    const grnSource: "hrms_only" | "hrms_plus_legacy" =
      period < "2026-10" ? "hrms_plus_legacy" : "hrms_only";

    // 4. Mode — if the period has ended and salary is finalised it is FINAL
    const [year, monthStr] = period.split("-");
    const periodEnd = new Date(
      Number(year),
      Number(monthStr), // month is 1-based → first day of NEXT month
      0,                // day=0 → last day of previous month
    );
    const mode: "FINAL" | "LIVE_MTD" =
      salaryBasis === "ACTUAL" && periodEnd < new Date() ? "FINAL" : "LIVE_MTD";

    // 5. Corrections totals per line_item
    const correctionDefaults: Record<LineItem, number> = {
      revenue: 0,
      salary: 0,
      grn: 0,
      ebitda: 0,
    };

    const [corrRows] = await db.execute<RowDataPacket[]>(
      `SELECT line_item, SUM(amount) AS total
         FROM pnl_monthly_correction
        WHERE period_code = ?
          AND company_name = 'Mas Callnet India Pvt Ltd'
        GROUP BY line_item`,
      [period],
    ).catch(() => [[]] as [RowDataPacket[]]);

    const corrections = { ...correctionDefaults };
    for (const row of corrRows as RowDataPacket[]) {
      const key = String(row.line_item) as LineItem;
      if (key in corrections) corrections[key] = Number(row.total ?? 0);
    }

    res.json({
      success: true,
      data: {
        period,
        salaryBasis,
        salaryRunStatus,
        revenueMode,
        grnSource,
        mode,
        corrections,
      },
    });
  }),
);

export { router as pnlCorrectionRouter };
