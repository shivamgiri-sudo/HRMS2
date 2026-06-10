import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireClientAuth } from "../../middleware/requireClientAuth.js";
import { portalController as c } from "./portal.controller.js";
import { portalSnapshotService } from "./portal.snapshot.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// ── Public auth (no middleware) ───────────────────────────────────────────
router.get("/health", h(async (_req, res) => {
  return res.json({ success: true, status: "ok", service: "portal" });
}));
router.post("/auth/request-otp", h(c.requestOtp));
router.post("/auth/verify-otp",  h(c.verifyOtp));

// ── Internal ops (internal staff JWT) ── MUST be before requireClientAuth middleware ──
router.use("/internal", requireAuth);
router.post("/internal/glide-paths",          h(c.setGlideCommitment));
router.post("/internal/action-plans",         h(c.createActionPlan));
router.put ("/internal/action-plans/:id",     h(c.updateActionPlan));
router.post("/internal/governance",           h(c.updateGovernance));
router.post("/internal/commentary",           h(c.createCommentary));
router.get ("/internal/client-users",         h(c.listClientUsers));
router.post("/internal/client-users",         h(c.createClientUser));

// ── Internal: Snapshot approval workflow ─────────────────────────────────────
router.post(
  "/internal/snapshots/prepare",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { process_id, snapshot_type, period } = req.body as Record<string, string>;
    if (!process_id || !snapshot_type || !period) {
      return res.status(400).json({ error: "process_id, snapshot_type and period are required" });
    }
    const userId = (req as any).authUser?.id ?? "system";
    const result = await portalSnapshotService.prepare(process_id, snapshot_type as any, period, userId);
    return res.status(201).json({ data: result });
  })
);

router.get(
  "/internal/snapshots/queue",
  requireRole("admin", "hr"),
  h(async (_req, res) => {
    const items = await portalSnapshotService.listQueue();
    return res.json({ data: items });
  })
);

router.patch(
  "/internal/snapshots/:id/review",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { action, rejection_reason } = req.body as { action: "approved" | "rejected"; rejection_reason?: string };
    if (action !== "approved" && action !== "rejected") {
      return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
    }
    const userId = (req as any).authUser?.id ?? "system";
    await portalSnapshotService.review(req.params.id, action, userId, rejection_reason);
    return res.json({ ok: true });
  })
);

router.get(
  "/internal/snapshots/published",
  requireRole("admin", "hr"),
  h(async (_req, res) => {
    const snapshots = await portalSnapshotService.listPublished();
    return res.json({ data: snapshots });
  })
);

router.patch(
  "/internal/snapshots/:id/deactivate",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    await portalSnapshotService.deactivate(req.params.id);
    return res.json({ ok: true });
  })
);

router.get(
  "/internal/access-log",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { process_id, from_date, to_date } = req.query as Record<string, string | undefined>;
    const logs = await portalSnapshotService.listAccessLog(process_id, from_date, to_date);
    return res.json({ data: logs });
  })
);

// ── Client portal (portal JWT) ────────────────────────────────────────────
router.use("/overview",   requireClientAuth);
router.use("/processes",  requireClientAuth);
router.use("/commentary", requireClientAuth);

router.get ("/overview",                              h(c.getOverview));
router.get ("/processes/:id/kpis",                    h(c.getKpis));
router.get ("/processes/:id/glide-paths",             h(c.getGlidePaths));
router.get ("/processes/:id/action-plans",            h(c.getActionPlans));
router.get ("/processes/:id/governance",              h(c.getGovernance));
router.get ("/processes/:id/attrition",               h(c.getAttrition));
router.get ("/processes/:id/commentary",              h(c.getCommentary));
router.post("/commentary/:id/acknowledge",            h(c.acknowledgeCommentary));
router.post("/commentary/:id/reply",                  h(c.replyCommentary));

export { router as portalRouter };
