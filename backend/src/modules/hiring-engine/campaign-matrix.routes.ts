/** GET /api/he/campaign-matrix (WS3 C2): the campaign x requisition x drive matrix, VIEW roles, the caller's branch scope. Counts and ids only. */
import type { Request, Response, Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logger } from "../../logger.js";
import { branchScopeOf } from "./he-stream.routes.js";
import { getCampaignMatrix } from "./campaign-matrix.service.js";

const ID_RE = /^[0-9a-f-]{36}$/i;
const bad = (res: Response, message: string): void => { res.status(400).json({ success: false, message }); };
const logText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split("\n")[0].replace(/\d{6,}/g, "#").slice(0, 200);

export function registerCampaignMatrixRoutes(r: Router, roles: { view: readonly string[] }): void {
  r.get("/campaign-matrix", requireAuth, requireRole(...roles.view), async (req: Request, res: Response) => {
    try {
      const { branch, requisitionId, campaignId } = req.query;
      for (const id of [requisitionId, campaignId]) if (id != null && (typeof id !== "string" || !ID_RE.test(id))) return bad(res, "Invalid id");
      if (branch != null && (typeof branch !== "string" || !branch || branch.length > 150)) return bad(res, "Invalid branch");
      const data = await getCampaignMatrix({ branch: (branch as string | undefined) ?? null, requisitionId: (requisitionId as string | undefined) ?? null, campaignId: (campaignId as string | undefined) ?? null },
        await branchScopeOf(req as AuthenticatedRequest));
      res.json({ success: true, data });
    } catch (err) {
      logger.error({ err: logText(err) }, "[he-matrix] read failed");
      res.status(500).json({ success: false, message: "Could not load the campaign map" });
    }
  });
}
