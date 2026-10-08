import { Router, type NextFunction, type Response } from "express";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  assertFinanceRecordBranch,
  resolveFinanceBranchScopeSet,
} from "../finance/finance-access-scope.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { refuse } from "./finance-error.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { clearPnlReadCache } from "./pnl-read-cache.js";
import { revenueForecastService } from "./revenue-forecast.service.js";

/**
 * /api/finance/revenue-forecasts — Branch Head monthly revenue forecast (migration 2118).
 * Role lists match the FINANCE_REVENUE_FORECAST grants in that migration, so the page and its
 * API agree on who may do what. Only the Finance Head approves; the Payroll Head has read access.
 */
const READ_ROLES = [
  "super_admin", "branch_head", "branch_admin", "finance_head", "payroll_head",
  "accounts_head", "finance", "ceo", "coo",
] as const;
const WRITE_ROLES = ["super_admin", "branch_head", "branch_admin"] as const;
// Payroll Head reads (READ_ROLES) but does not approve — owner ruling 2026-10-06.
const REVIEW_ROLES = ["super_admin", "finance_head"] as const;
const REOPEN_ROLES = ["super_admin", "finance_head"] as const;

export const revenueForecastRouter = Router();
revenueForecastRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

function actor(req: AuthenticatedRequest) {
  return {
    id: req.authUser.id,
    role: String(req.authUser.role ?? req.userRoles?.[0] ?? "unknown"),
    roles: (req.userRoles ?? []).map((r) => String(r).toLowerCase()),
  };
}

/** finance-access-scope refuses with a plain Error; answer 403, not 500. */
async function forbiddenOnScope<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    if (!err.statusCode && /^(Your user account is not mapped|You cannot access|You can only access)/.test(String(err.message))) {
      err.statusCode = 403;
    }
    throw err;
  }
}

async function assertBranch(req: AuthenticatedRequest, branchId: string | null | undefined) {
  const user = actor(req);
  await forbiddenOnScope(assertFinanceRecordBranch({
    userId: user.id, primaryRole: user.role, userRoles: user.roles, recordBranchId: branchId,
  }));
}

async function scopedForecast(req: AuthenticatedRequest, id: string) {
  const forecast = await revenueForecastService.get(id);
  await assertBranch(req, String(forecast.branch_id));
  return forecast;
}

revenueForecastRouter.get(
  "/",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const scope = await forbiddenOnScope(resolveFinanceBranchScopeSet({
      userId: user.id, primaryRole: user.role, userRoles: user.roles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    }));
    const data = await revenueForecastService.list(String(req.query.period ?? ""), scope.mode === "all" ? null : scope.branchIds);
    res.json({ success: true, data });
  }),
);

revenueForecastRouter.get(
  "/:id",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    res.json({ success: true, data: await scopedForecast(req, req.params.id) });
  }),
);

/** Create or replace the draft for a cost centre + month. */
revenueForecastRouter.put(
  "/",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const costCentreId = String(req.body?.costCentreId ?? "");
    const period = String(req.body?.period ?? "");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, branch_id FROM cost_centre_master WHERE id = ? LIMIT 1`, [costCentreId],
    );
    if (!rows[0]) throw refuse(404, "COST_CENTRE_NOT_FOUND", "Cost centre not found");
    await assertBranch(req, rows[0].branch_id ? String(rows[0].branch_id) : null);
    const data = await revenueForecastService.saveDraft({
      costCentreId, branchId: String(rows[0].branch_id), period,
      notes: req.body?.notes ?? null, lines: req.body?.lines ?? [],
    }, actor(req).id);
    res.json({ success: true, data });
  }),
);

revenueForecastRouter.post(
  "/:id/submit",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    await scopedForecast(req, req.params.id);
    res.json({ success: true, data: await revenueForecastService.submit(req.params.id, actor(req).id) });
  }),
);

revenueForecastRouter.post(
  "/:id/review",
  requireWriteAccess,
  requireRole(...REVIEW_ROLES),
  h(async (req, res) => {
    await scopedForecast(req, req.params.id);
    const decision = req.body?.decision;
    if (decision !== "approved" && decision !== "rejected") throw refuse(400, "FORECAST_DECISION", "decision must be approved or rejected");
    const data = await revenueForecastService.review(req.params.id, "finance_head", decision, req.body?.note ?? null, actor(req).id);
    clearPnlReadCache();
    res.json({ success: true, data });
  }),
);

revenueForecastRouter.post(
  "/:id/close",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    await scopedForecast(req, req.params.id);
    const data = await revenueForecastService.close(req.params.id, req.body?.actuals ?? [], req.body?.note ?? null, actor(req).id);
    clearPnlReadCache();
    res.json({ success: true, data });
  }),
);

revenueForecastRouter.post(
  "/:id/reopen",
  requireWriteAccess,
  requireRole(...REOPEN_ROLES),
  h(async (req, res) => {
    await scopedForecast(req, req.params.id);
    const data = await revenueForecastService.reopen(req.params.id, String(req.body?.reason ?? ""), actor(req).id);
    clearPnlReadCache();
    res.json({ success: true, data });
  }),
);

revenueForecastRouter.delete(
  "/:id",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const forecast = await scopedForecast(req, req.params.id);
    const user = actor(req);
    const isSuperAdmin = [user.role, ...user.roles].includes("super_admin");
    // A Branch Head discards only a draft or returned forecast. A super_admin may remove one in
    // any status (raised in error, test data) — with a reason, and the whole forecast kept in the
    // audit log, because an approved or closed forecast has already been counted by the P&L.
    const anyStatus = isSuperAdmin && !["draft", "rejected"].includes(String(forecast.status));
    if (anyStatus) {
      const reason = String(req.body?.reason ?? req.query.reason ?? "").trim();
      if (!reason) throw refuse(400, "FORECAST_DELETE_REASON", "Give a reason for deleting an approved or closed forecast");
      await writeAuditLog({
        actor_user_id: user.id, actor_role: "super_admin", action_type: "REVENUE_FORECAST_DELETE",
        module_key: "finance", entity_type: "revenue_forecast", entity_id: req.params.id, reason, req,
        old_value_json: forecast as unknown as Record<string, unknown>,
      });
    }
    const data = await revenueForecastService.discard(req.params.id, { anyStatus });
    if (anyStatus) clearPnlReadCache();
    res.json({ success: true, data });
  }),
);
