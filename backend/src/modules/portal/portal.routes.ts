import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireClientAuth } from "../../middleware/requireClientAuth.js";
import { portalController as c } from "./portal.controller.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// ── Public auth (no middleware) ───────────────────────────────────────────
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
