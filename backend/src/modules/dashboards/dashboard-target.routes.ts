import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { getAllMetricCodes } from "./dashboard-definition.service.js";

/**
 * Read/write dashboard_metric_target.
 *
 * The table has a reader (getTargetForMetric) and, until now, no writer anywhere in the
 * codebase — so `target` was permanently null and every tile reported status 'unknown'. A
 * target cannot be seeded from code the way the catalog can: "attendance should be 92%" is
 * a business commitment, and inventing one would put a fabricated number behind a red or
 * green tile. This is the path by which someone accountable sets it.
 *
 * Targets are effective-dated. Superseding is done by end-dating the old row rather than
 * overwriting, so a tile's status last quarter stays explicable.
 */

const router = Router();
router.use(requireAuth);

/** Roles allowed to set an organisational target. Deliberately narrow. */
const TARGET_ADMIN_ROLES = ["super_admin", "admin", "ceo", "coo", "management"] as const;

const PERIODS = new Set(["daily", "weekly", "monthly", "annual"]);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<any>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Targets in force today, most specific first, with the names a UI needs to show them. */
router.get("/", h(async (req: AuthenticatedRequest, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.id, t.metric_code, c.metric_name, c.unit, c.higher_is_better,
            t.dashboard_code, t.branch_id, b.branch_name, t.process_id, p.process_name,
            t.target_value, t.target_period, t.effective_from, t.effective_to, t.created_at
       FROM dashboard_metric_target t
       LEFT JOIN dashboard_metric_catalog c ON c.metric_code = t.metric_code
       LEFT JOIN branch_master  b ON b.id = t.branch_id
       LEFT JOIN process_master p ON p.id = t.process_id
      ORDER BY t.metric_code, t.effective_from DESC`,
  );

  return res.json({
    success: true,
    data: {
      targets: rows,
      // Stated so a caller can tell "no targets configured" from "the request failed",
      // which is the distinction the dashboards themselves had to learn to make.
      configured: (rows as RowDataPacket[]).length,
    },
  });
}));

router.post("/", requireRole(...TARGET_ADMIN_ROLES), h(async (req: AuthenticatedRequest, res: any) => {
  const {
    metricCode, targetValue, targetPeriod = "monthly",
    branchId = null, processId = null, dashboardCode = null,
    effectiveFrom, reason,
  } = req.body ?? {};

  const code = String(metricCode ?? "").trim().toUpperCase();
  if (!code) {
    return res.status(400).json({ success: false, error: { code: "METRIC_CODE_REQUIRED", message: "metricCode is required." } });
  }

  // Validated against the code's own metric list, not against the catalog table: a target
  // for a code no metric enriches under would be stored, joined and displayed, yet never
  // applied to anything. That is precisely the DPDP/DPDP_WITHDRAWAL failure mode.
  if (!getAllMetricCodes().includes(code)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "UNKNOWN_METRIC_CODE",
        message: `No metric enriches under '${code}'. A target stored against it would never be applied.`,
        knownCodes: getAllMetricCodes(),
      },
    });
  }

  const value = Number(targetValue);
  if (!Number.isFinite(value)) {
    return res.status(400).json({ success: false, error: { code: "INVALID_TARGET_VALUE", message: "targetValue must be a finite number." } });
  }

  const period = String(targetPeriod).trim().toLowerCase();
  if (!PERIODS.has(period)) {
    return res.status(400).json({ success: false, error: { code: "INVALID_TARGET_PERIOD", message: `targetPeriod must be one of ${[...PERIODS].join(", ")}.` } });
  }

  if (branchId !== null && !isUuid(branchId)) {
    return res.status(400).json({ success: false, error: { code: "INVALID_BRANCH_ID", message: "branchId must be a UUID or null." } });
  }
  if (processId !== null && !isUuid(processId)) {
    return res.status(400).json({ success: false, error: { code: "INVALID_PROCESS_ID", message: "processId must be a UUID or null." } });
  }

  // A target against a branch or process that does not exist resolves for nobody, and is
  // indistinguishable from having set none at all.
  if (branchId) {
    const [b] = await db.execute<RowDataPacket[]>("SELECT id FROM branch_master WHERE id = ?", [branchId]);
    if (!(b as RowDataPacket[]).length) {
      return res.status(400).json({ success: false, error: { code: "BRANCH_NOT_FOUND", message: "branchId does not exist." } });
    }
  }
  if (processId) {
    const [p] = await db.execute<RowDataPacket[]>("SELECT id FROM process_master WHERE id = ?", [processId]);
    if (!(p as RowDataPacket[]).length) {
      return res.status(400).json({ success: false, error: { code: "PROCESS_NOT_FOUND", message: "processId does not exist." } });
    }
  }

  const from = String(effectiveFrom ?? "").trim() || null;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return res.status(400).json({ success: false, error: { code: "INVALID_EFFECTIVE_FROM", message: "effectiveFrom must be YYYY-MM-DD." } });
  }

  const actorId = req.authUser!.id;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // End-date whatever is currently in force for the same metric and scope. Overwriting
    // would erase why a tile was red last month; getTargetForMetric already selects the
    // newest effective row, so an end-dated predecessor simply stops applying.
    const [supersededRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, target_value FROM dashboard_metric_target
        WHERE metric_code = ? AND target_period = ?
          AND ${branchId ? "branch_id = ?" : "branch_id IS NULL"}
          AND ${processId ? "process_id = ?" : "process_id IS NULL"}
          AND (effective_to IS NULL OR effective_to >= COALESCE(?, CURDATE()))`,
      [code, period, ...(branchId ? [branchId] : []), ...(processId ? [processId] : []), from],
    );

    if ((supersededRows as RowDataPacket[]).length) {
      await connection.execute(
        `UPDATE dashboard_metric_target
            SET effective_to = DATE_SUB(COALESCE(?, CURDATE()), INTERVAL 1 DAY),
                updated_at = CURRENT_TIMESTAMP
          WHERE id IN (${(supersededRows as RowDataPacket[]).map(() => "?").join(",")})`,
        [from, ...(supersededRows as RowDataPacket[]).map((r) => r.id)],
      );
    }

    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO dashboard_metric_target
         (id, metric_code, dashboard_code, branch_id, process_id,
          target_value, target_period, effective_from, created_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?)`,
      [code, dashboardCode, branchId, processId, value, period, from, actorId],
    );

    await connection.commit();

    await writeAuditLog({
      actor_user_id: actorId,
      action_type: "DASHBOARD_TARGET_SET",
      module_key: "dashboards",
      entity_type: "dashboard_metric_target",
      entity_id: code,
      reason: reason ? String(reason) : undefined,
      new_value_json: { metricCode: code, targetValue: value, targetPeriod: period, branchId, processId, effectiveFrom: from },
      change_summary: { superseded: (supersededRows as RowDataPacket[]).length },
      req: req as any,
    });

    return res.status(201).json({
      success: true,
      data: {
        metricCode: code,
        targetValue: value,
        targetPeriod: period,
        branchId,
        processId,
        supersededCount: (supersededRows as RowDataPacket[]).length,
        inserted: insert.affectedRows,
      },
    });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}));

/** End-dates a target. Never deletes: the history is why a past status is explicable. */
router.delete("/:id", requireRole(...TARGET_ADMIN_ROLES), h(async (req: AuthenticatedRequest, res: any) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "id must be a UUID." } });
  }

  const [existing] = await db.execute<RowDataPacket[]>(
    "SELECT id, metric_code, target_value FROM dashboard_metric_target WHERE id = ?", [id],
  );
  if (!(existing as RowDataPacket[]).length) {
    return res.status(404).json({ success: false, error: { code: "TARGET_NOT_FOUND", message: "No such target." } });
  }

  await db.execute(
    "UPDATE dashboard_metric_target SET effective_to = CURDATE(), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [id],
  );

  await writeAuditLog({
    actor_user_id: req.authUser!.id,
    action_type: "DASHBOARD_TARGET_RETIRED",
    module_key: "dashboards",
    entity_type: "dashboard_metric_target",
    entity_id: String((existing as RowDataPacket[])[0].metric_code),
    old_value_json: (existing as RowDataPacket[])[0] as Record<string, unknown>,
    reason: req.body?.reason ? String(req.body.reason) : undefined,
    req: req as any,
  });

  return res.json({ success: true, data: { id, endDated: true } });
}));

export default router;
