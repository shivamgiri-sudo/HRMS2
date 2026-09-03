import { Router } from "express";
import { requireAuth, requireWriteAccess } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { discardService, type DiscardActor } from "./discard.service.js";
import {
  discardRequestSchema,
  discardBatchRowsRequestSchema,
  discardHistoryQuerySchema,
} from "./discard.validation.js";

export const discardRouter = Router();
discardRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  fn(req, res).catch(next);

/**
 * Restricted to super_admin and wfm.
 *
 * `wfm` is listed explicitly even though `super_admin` short-circuits
 * requireRole — the list is what admits WFM. Branch scope for wfm is enforced
 * inside the service against user_assignment_scope, because route middleware
 * cannot see which employee the record belongs to.
 *
 * requireRole alias-expands wfm to wfm_analyst / wfm_spoc / ho_wfm. Verified
 * harmless: none of those exist in workforce_role_catalog, and user_roles.role_key
 * is FK-constrained to it (user_roles_ibfk_1), so nobody can hold them.
 */
const discardGate = [requireWriteAccess, requireRole("super_admin", "wfm")];

function actorFrom(req: any): DiscardActor {
  return {
    userId: req.authUser.id,
    roles: req.authUser.roles ?? [],
    role: req.authUser.role ?? null,
  };
}

// ─── Preview ─────────────────────────────────────────────────────────────────
// Runs every precondition the POST runs and returns them as `blockers`, so the
// confirmation dialog can explain exactly what will change — or why it cannot —
// without a speculative write.

discardRouter.get("/preview/leave/:id", ...discardGate, h(async (req, res) => {
  const data = await discardService.previewLeave(req.params.id, actorFrom(req));
  return res.json({ success: true, data });
}));

discardRouter.get("/preview/regularization/:id", ...discardGate, h(async (req, res) => {
  const data = await discardService.previewRegularization(req.params.id, actorFrom(req));
  return res.json({ success: true, data });
}));

// Disputes are rows in attendance_regularization with dispute_type set, so they
// share the regularization path rather than duplicating it.
discardRouter.get("/preview/dispute/:id", ...discardGate, h(async (req, res) => {
  const data = await discardService.previewRegularization(req.params.id, actorFrom(req));
  return res.json({ success: true, data });
}));

// ─── Discard ─────────────────────────────────────────────────────────────────

discardRouter.post("/leave/:id", ...discardGate, h(async (req, res) => {
  const parsed = discardRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors,
    });
  }
  const data = await discardService.discardLeave(req.params.id, actorFrom(req), parsed.data.reason);
  return res.json({
    success: true,
    data,
    message: data.daysRestored
      ? `Leave discarded — ${data.daysRestored} day(s) credited back.`
      : "Leave discarded.",
  });
}));

const discardRegularizationHandler = h(async (req: any, res: any) => {
  const parsed = discardRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors,
    });
  }
  const data = await discardService.discardRegularization(req.params.id, actorFrom(req), parsed.data.reason);
  return res.json({
    success: true,
    data,
    message: `Approved ${data.entityType} discarded — attendance restored for ${data.attendance.length} date(s).`,
  });
});

discardRouter.post("/regularization/:id", ...discardGate, discardRegularizationHandler);
discardRouter.post("/dispute/:id", ...discardGate, discardRegularizationHandler);

// ─── Batch reversal ──────────────────────────────────────────────────────────
// The path the bulk-upload lock message has always pointed to: discard one or
// more rows OUT of a specific approved batch. Same discardGate as everything
// else here (super_admin/wfm) — approving a batch and reversing one are
// different authorities, so holding branch_head does not admit this route.

discardRouter.post("/batch/:batchId/rows", ...discardGate, h(async (req, res) => {
  const parsed = discardBatchRowsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors,
    });
  }
  const results = await discardService.discardBatchRows(
    req.params.batchId,
    parsed.data.entityType,
    parsed.data.entityIds,
    actorFrom(req),
    parsed.data.reason,
  );
  const succeeded = results.filter((r) => r.success).length;
  return res.json({
    success: succeeded === results.length,
    data: results,
    message: `${succeeded} of ${results.length} row(s) discarded.`,
  });
}));

// ─── History ─────────────────────────────────────────────────────────────────

discardRouter.get("/history", ...discardGate, h(async (req, res) => {
  const parsed = discardHistoryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors,
    });
  }
  const result = await discardService.listDiscards(parsed.data);
  return res.json({
    success: true,
    data: result.data,
    meta: { total: result.total, page: result.page, limit: result.limit },
  });
}));
