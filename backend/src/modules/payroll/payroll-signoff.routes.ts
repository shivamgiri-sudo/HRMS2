import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignOffStatus {
  run_id: string;
  run_month: string;
  status: string;
  total_net_salary: number;
  finance_approved_by: string | null;
  finance_approved_at: string | null;
  finance_remarks: string | null;
  ceo_acknowledged_by: string | null;
  ceo_acknowledged_at: string | null;
  ceo_remarks: string | null;
  ceo_required: boolean;
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();
const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void): void => {
    fn(req, res).catch(next);
  };

router.use(requireAuth);

// ── Helper: fetch threshold from payroll_config_flags ─────────────────────────
async function getCeoThreshold(): Promise<number> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM payroll_config_flags WHERE config_key = 'ceo_ack_threshold' LIMIT 1`,
    );
    const val = Number((rows as RowDataPacket[])[0]?.config_value);
    return Number.isFinite(val) && val > 0 ? val : 5_000_000;
  } catch {
    return 5_000_000;
  }
}

// ── Helper: build SignOffStatus for a run row ─────────────────────────────────
async function buildStatus(
  run: RowDataPacket,
  threshold: number,
): Promise<SignOffStatus> {
  const [sumRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(net_salary), 0) AS total_net FROM salary_prep_line WHERE run_id = ?`,
    [run.id],
  );
  const totalNet = Number((sumRows as RowDataPacket[])[0]?.total_net ?? 0);

  return {
    run_id: String(run.id),
    run_month: run.run_month,
    status: run.status,
    total_net_salary: totalNet,
    finance_approved_by: run.finance_approved_by ?? null,
    finance_approved_at: run.finance_approved_at ?? null,
    finance_remarks: run.finance_remarks ?? null,
    ceo_acknowledged_by: run.ceo_acknowledged_by ?? null,
    ceo_acknowledged_at: run.ceo_acknowledged_at ?? null,
    ceo_remarks: run.ceo_remarks ?? null,
    ceo_required: totalNet > threshold,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /runs/:runId/status
// Returns sign-off status for a single run.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/runs/:runId/status",
  requireRole("finance", "super_admin", "payroll_head", "payroll", "ceo", "admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;

    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status,
              finance_approved_by, finance_approved_at, finance_remarks,
              ceo_acknowledged_by, ceo_acknowledged_at, ceo_remarks
         FROM salary_prep_run
        WHERE id = ?
        LIMIT 1`,
      [runId],
    );

    const run = (runRows as RowDataPacket[])[0];
    if (!run) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }

    const threshold = await getCeoThreshold();
    const statusObj = await buildStatus(run, threshold);

    return res.json({ success: true, data: statusObj });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /runs
// List runs pending finance sign-off (calculated or validated, not yet finance-approved).
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/runs",
  requireRole("finance", "super_admin", "payroll_head", "payroll", "ceo", "admin"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status,
              finance_approved_by, finance_approved_at, finance_remarks,
              ceo_acknowledged_by, ceo_acknowledged_at, ceo_remarks
         FROM salary_prep_run
        WHERE status IN ('calculated', 'validated')
          AND finance_approved_at IS NULL
        ORDER BY run_month DESC
        LIMIT 20`,
    );

    return res.json({ success: true, data: rows });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /runs/:runId/finance-approve
// Finance approval for a payroll run.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/runs/:runId/finance-approve",
  requireRole("finance", "super_admin", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;
    const actorId = req.authUser!.id;
    const remarks: string | null = (req.body as { remarks?: string })?.remarks?.trim() || null;

    // Fetch run
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status, finance_approved_at FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const run = (runRows as RowDataPacket[])[0];
    if (!run) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }
    if (run.finance_approved_at) {
      return res.status(409).json({ success: false, message: "Run is already finance-approved" });
    }

    await db.execute(
      `UPDATE salary_prep_run
          SET finance_approved_by = ?,
              finance_approved_at = NOW(),
              finance_remarks     = ?
        WHERE id = ?`,
      [actorId, remarks, runId],
    );

    void logSensitiveAction({
      actor_user_id: actorId,
      action_type: "PAYROLL_FINANCE_APPROVE",
      module_key: "payroll",
      entity_type: "salary_prep_run",
      entity_id: String(runId),
      change_summary: { run_id: runId, run_month: run.run_month, remarks },
      req,
    });

    // Return updated status
    const [updated] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status,
              finance_approved_by, finance_approved_at, finance_remarks,
              ceo_acknowledged_by, ceo_acknowledged_at, ceo_remarks
         FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const threshold = await getCeoThreshold();
    const statusObj = await buildStatus((updated as RowDataPacket[])[0], threshold);

    return res.json({ success: true, data: statusObj });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /runs/:runId/ceo-acknowledge
// CEO acknowledgement for a payroll run (only when ceo_required = true).
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/runs/:runId/ceo-acknowledge",
  requireRole("ceo", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;
    const actorId = req.authUser!.id;
    const remarks: string | null = (req.body as { remarks?: string })?.remarks?.trim() || null;

    // Fetch run
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status, ceo_acknowledged_at FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const run = (runRows as RowDataPacket[])[0];
    if (!run) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }
    if (run.ceo_acknowledged_at) {
      return res.status(409).json({ success: false, message: "Run is already CEO-acknowledged" });
    }

    // Check whether CEO sign-off is actually required
    const threshold = await getCeoThreshold();
    const [sumRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(net_salary), 0) AS total_net FROM salary_prep_line WHERE run_id = ?`,
      [runId],
    );
    const totalNet = Number((sumRows as RowDataPacket[])[0]?.total_net ?? 0);
    if (totalNet <= threshold) {
      return res
        .status(400)
        .json({ success: false, message: "CEO acknowledgement is not required for this run (total net salary is below threshold)" });
    }

    await db.execute(
      `UPDATE salary_prep_run
          SET ceo_acknowledged_by = ?,
              ceo_acknowledged_at = NOW(),
              ceo_remarks         = ?
        WHERE id = ?`,
      [actorId, remarks, runId],
    );

    void logSensitiveAction({
      actor_user_id: actorId,
      action_type: "PAYROLL_CEO_ACKNOWLEDGE",
      module_key: "payroll",
      entity_type: "salary_prep_run",
      entity_id: String(runId),
      change_summary: { run_id: runId, run_month: run.run_month, total_net: totalNet, remarks },
      req,
    });

    // Return updated status
    const [updated] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status,
              finance_approved_by, finance_approved_at, finance_remarks,
              ceo_acknowledged_by, ceo_acknowledged_at, ceo_remarks
         FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const statusObj = await buildStatus((updated as RowDataPacket[])[0], threshold);

    return res.json({ success: true, data: statusObj });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /runs/:runId/finance-revoke
// Revoke finance approval (super_admin only — rollback path).
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/runs/:runId/finance-revoke",
  requireRole("super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;
    const actorId = req.authUser!.id;

    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, finance_approved_by, finance_approved_at
         FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const run = (runRows as RowDataPacket[])[0];
    if (!run) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }

    await db.execute(
      `UPDATE salary_prep_run
          SET finance_approved_by = NULL,
              finance_approved_at = NULL,
              finance_remarks     = NULL
        WHERE id = ?`,
      [runId],
    );

    void logSensitiveAction({
      actor_user_id: actorId,
      action_type: "PAYROLL_FINANCE_REVOKE",
      module_key: "payroll",
      entity_type: "salary_prep_run",
      entity_id: String(runId),
      change_summary: {
        run_id: runId,
        run_month: run.run_month,
        previously_approved_by: run.finance_approved_by,
        previously_approved_at: run.finance_approved_at,
      },
      req,
    });

    // Return updated status
    const [updated] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status,
              finance_approved_by, finance_approved_at, finance_remarks,
              ceo_acknowledged_by, ceo_acknowledged_at, ceo_remarks
         FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const threshold = await getCeoThreshold();
    const statusObj = await buildStatus((updated as RowDataPacket[])[0], threshold);

    return res.json({ success: true, data: statusObj });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /runs/:runId/tds-summary
// Aggregates TDS from salary_prep_line for a run; joins tax_declaration for
// regime breakdown.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/runs/:runId/tds-summary",
  requireRole("finance", "super_admin", "payroll_head", "payroll", "ceo", "admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;

    const [runCheck] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    if (!(runCheck as RowDataPacket[])[0]) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(spl.tds), 0)                                                          AS total_tds,
         COUNT(CASE WHEN spl.tds > 0 THEN 1 END)                                            AS employee_count_with_tds,
         ROUND(AVG(CASE WHEN spl.tds > 0 THEN spl.tds END), 2)                              AS avg_tds,
         COUNT(CASE WHEN COALESCE(td.regime, 'new') = 'new' AND spl.tds > 0 THEN 1 END)    AS regime_new,
         COUNT(CASE WHEN td.regime = 'old'           AND spl.tds > 0 THEN 1 END)            AS regime_old
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
       LEFT JOIN tax_declaration td
         ON td.employee_id = spl.employee_id
        AND td.financial_year = CASE
              WHEN MONTH(STR_TO_DATE(spr.run_month, '%Y-%m')) >= 4
              THEN CONCAT(YEAR(STR_TO_DATE(spr.run_month, '%Y-%m')), '-',
                          LPAD(MOD(YEAR(STR_TO_DATE(spr.run_month, '%Y-%m')) - 2000 + 1, 100), 2, '0'))
              ELSE CONCAT(YEAR(STR_TO_DATE(spr.run_month, '%Y-%m')) - 1, '-',
                          LPAD(MOD(YEAR(STR_TO_DATE(spr.run_month, '%Y-%m')) - 2000, 100), 2, '0'))
            END
       WHERE spl.run_id = ?`,
      [runId],
    );

    const row = (rows as RowDataPacket[])[0] ?? {};

    return res.json({
      success: true,
      data: {
        total_tds:               Number(row.total_tds ?? 0),
        employee_count_with_tds: Number(row.employee_count_with_tds ?? 0),
        avg_tds:                 Number(row.avg_tds ?? 0),
        regime_breakdown: {
          new: Number(row.regime_new ?? 0),
          old: Number(row.regime_old ?? 0),
        },
      },
    });
  }),
);

export { router as payrollSignoffRouter };
