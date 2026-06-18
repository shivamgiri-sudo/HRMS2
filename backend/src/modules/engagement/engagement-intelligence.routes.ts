import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, selfOrAdminHr } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response, NextFunction } from "express";
import {
  calculateEmployeeEngagementHealth,
  scanEngagementHealth,
} from "./engagement-health.service.js";
import { resolvePeopleExperienceScope } from "../people-experience/people-experience.scope.js";
import { getPeopleExperienceCommandCenter } from "../people-experience/people-experience.service.js";

export const engagementIntelligenceRouter = Router();
engagementIntelligenceRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

engagementIntelligenceRouter.get(
  "/command-center",
  requireRole("admin", "hr", "manager", "process_manager", "ceo"),
  h(async (req, res) => {
    const scope = await resolvePeopleExperienceScope(req);
    const data = await getPeopleExperienceCommandCenter(scope, req.query as Record<string, string | undefined>);
    return res.json({ success: true, data });
  })
);

engagementIntelligenceRouter.post(
  "/scan",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const limit = Math.min(Number(req.body?.limit ?? 500), 2000);
    const data = await scanEngagementHealth(limit);
    return res.json({ success: true, data });
  })
);

engagementIntelligenceRouter.get(
  "/health/me",
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ success: false, message: "No employee mapped" });
    const data = await calculateEmployeeEngagementHealth(emp.id);
    return res.json({ success: true, data });
  })
);

engagementIntelligenceRouter.get(
  "/health/:employeeId",
  selfOrAdminHr("employeeId"),
  h(async (req, res) => {
    const data = await calculateEmployeeEngagementHealth(req.params.employeeId);
    return res.json({ success: true, data });
  })
);

engagementIntelligenceRouter.post(
  "/kudos/:kudosId/reactions",
  h(async (req, res) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ success: false, message: "No employee mapped" });
    const reactionType = String(req.body?.reactionType ?? "like");
    const allowed = new Set(["like", "celebrate", "inspire", "thanks", "comment"]);
    if (!allowed.has(reactionType)) return res.status(400).json({ success: false, message: "Invalid reaction type" });
    const comment = req.body?.comment ? String(req.body.comment).slice(0, 700) : null;
    await db.execute(
      `INSERT INTO kudos_reaction (id, kudos_id, employee_id, reaction_type, comment_text)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE comment_text = VALUES(comment_text), created_at = NOW()`,
      [randomUUID(), req.params.kudosId, emp.id, reactionType, comment]
    );
    return res.status(201).json({ success: true, message: "Reaction saved" });
  })
);

engagementIntelligenceRouter.post(
  "/kudos/:kudosId/moderate",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const action = String(req.body?.action ?? "reviewed");
    const allowed = new Set(["flagged", "hidden", "restored", "reviewed"]);
    if (!allowed.has(action)) return res.status(400).json({ success: false, message: "Invalid moderation action" });
    await db.execute(
      `INSERT INTO kudos_moderation_log (id, kudos_id, action, reason, action_by)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), req.params.kudosId, action, req.body?.reason ?? null, req.authUser!.id]
    );
    return res.json({ success: true, message: "Moderation saved" });
  })
);
