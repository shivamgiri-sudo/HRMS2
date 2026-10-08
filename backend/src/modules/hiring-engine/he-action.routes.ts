/**
 * Recruiter action queue routes (HE_ACTION_QUEUE, default off). Mounted on heRouter before /qualified-followup/:id.
 * The list needs VIEW roles and carries masked mobiles only. The contact link needs WRITE roles, serves one person per request with
 * no-store, and logs ref type, kind and user id only. A record outside the caller's scope answers 404, never 403.
 */
import type { Request, Response, Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logger } from "../../logger.js";
import { parseRef } from "./he-action-queue.js";
import { actionQueueOn, contactFor, getActionQueue, offQueue } from "./he-action-queue.service.js";
import { branchScopeOf } from "./he-stream.routes.js";

const ID_RE = /^[0-9a-f-]{36}$/i;
const bad = (res: Response, message: string): void => { res.status(400).json({ success: false, message }); };
const logText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split("\n")[0].replace(/\d{6,}/g, "#").slice(0, 200);

export function registerActionRoutes(r: Router, roles: { view: readonly string[]; write: readonly string[] }): void {
  r.get("/action-queue", requireAuth, requireRole(...roles.view), async (req: Request, res: Response) => {
    try {
      const { requisitionId: rid, branch } = req.query;
      if (rid != null && (typeof rid !== "string" || !ID_RE.test(rid))) return bad(res, "Invalid id");
      if (branch != null && (typeof branch !== "string" || !branch || branch.length > 150)) return bad(res, "Invalid branch");
      if (!actionQueueOn()) return void res.json({ success: true, data: offQueue() });
      const requisitionId = (rid as string | undefined) ?? null, br = (branch as string | undefined) ?? null;
      const data = await getActionQueue({ requisitionId, branch: br }, await branchScopeOf(req as AuthenticatedRequest));
      if (!data) return void res.status(404).json({ success: false, message: !requisitionId && br ? "Branch not found" : "Requisition not found" });
      res.json({ success: true, data });
    } catch (err) {
      logger.error({ err: logText(err) }, "[he-action] queue failed");
      res.status(500).json({ success: false, message: "Could not load the action queue" });
    }
  });

  r.get("/action-queue/contact", requireAuth, requireRole(...roles.write), async (req: Request, res: Response) => {
    try {
      if (!actionQueueOn()) return void res.status(404).json({ success: false, message: "Not found" });
      const ref = parseRef(req.query.ref), kind = req.query.kind;
      if (!ref || (kind !== "tel" && kind !== "whatsapp")) return bad(res, "Invalid contact request");
      const href = await contactFor(ref, kind, await branchScopeOf(req as AuthenticatedRequest));
      if (!href) return void res.status(404).json({ success: false, message: "Not found" });
      logger.info({ refType: ref.type, kind, userId: (req as AuthenticatedRequest).authUser.id }, "[he-action] contact link served");
      res.set("Cache-Control", "no-store");
      res.json({ success: true, data: { href } });
    } catch (err) {
      logger.error({ err: logText(err) }, "[he-action] contact failed");
      res.status(500).json({ success: false, message: "Could not open the contact" });
    }
  });
}
