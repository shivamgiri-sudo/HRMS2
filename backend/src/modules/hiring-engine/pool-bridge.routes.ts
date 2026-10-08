/**
 * Pool bridge routes (WS3 D2), ADMIN roles: POST /api/he/pool/bridge-ats (dry run unless `dryRun: false`) and GET /api/he/pool/bridge-ats/sources.
 * A real run refreshes the Hiring Engine facts cache in the background so the selection preview reads the new people; nobody is contacted.
 */
import type { Request, Response, Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logger } from "../../logger.js";
import { BRIDGE_RECORD_TYPES, bridgeAtsUpload, bridgeSources, type BridgeRecordType } from "./he-upload-bridge.service.js";
import { refreshFactCache } from "../selection/fact-cache.service.js";
import type { SubSource } from "../selection/selection-types.js";

const NEXT_STEP = "People are in the pool for preview only. Open Drives > Selection criteria to preview and approve a shortlist per requisition; nothing is sent without approval.";
const logText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split("\n")[0].replace(/\d{6,}/g, "#").slice(0, 200);
const bad = (res: Response, message: string): void => { res.status(400).json({ success: false, message }); };
const intOrUndef = (v: unknown): number | undefined | null => (v == null ? undefined : Number.isInteger(v) && Number(v) > 0 ? Number(v) : null);

export function registerPoolBridgeRoutes(r: Router, roles: { admin: readonly string[] }): void {
  const admin = [requireAuth, requireRole(...roles.admin)] as const;

  r.post("/pool/bridge-ats", ...admin, async (req: Request, res: Response) => {
    try {
      const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
      const types = Array.isArray(b.recordTypes) ? (b.recordTypes as unknown[]) : [];
      if (!types.length || types.some((t) => typeof t !== "string" || !(BRIDGE_RECORD_TYPES as readonly string[]).includes(t))) return bad(res, "Pick candidate, naukri_import or workindia_import");
      const details = b.sourceDetails == null ? undefined : Array.isArray(b.sourceDetails) && b.sourceDetails.every((d) => typeof d === "string") ? (b.sourceDetails as string[]) : null;
      const maxRows = intOrUndef(b.maxRows), chunk = intOrUndef(b.chunk);
      if (details === null || maxRows === null || chunk === null) return bad(res, "Invalid request");
      const after = b.after && typeof b.after === "object" ? b.after as { recordType?: unknown; afterId?: unknown } : null;
      const dryRun = b.dryRun !== false;
      const actorId = (req as AuthenticatedRequest).authUser?.id ?? null;
      const out = await bridgeAtsUpload({
        recordTypes: types as BridgeRecordType[], sourceDetails: details, dryRun, actorId, maxRows, chunk,
        after: after && typeof after.recordType === "string" && typeof after.afterId === "string" ? { recordType: after.recordType as BridgeRecordType, afterId: after.afterId } : null,
      });
      if (!dryRun) {
        void refreshFactCache({ sourceKind: "he", subSources: types as SubSource[] })
          .catch((e: unknown) => logger.error({ err: logText(e) }, "[he-bridge] facts cache refresh failed"));
      }
      res.json({ success: true, data: { ...out, next_step: NEXT_STEP } });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e?.statusCode && e.statusCode < 500) return void res.status(e.statusCode).json({ success: false, message: e.message });
      logger.error({ err: logText(err) }, "[he-bridge] run failed");
      res.status(500).json({ success: false, message: "Could not bring the imports into the pool" });
    }
  });

  r.get("/pool/bridge-ats/sources", ...admin, async (_req: Request, res: Response) => {
    try { res.json({ success: true, data: await bridgeSources() }); } catch (err) {
      logger.error({ err: logText(err) }, "[he-bridge] sources failed");
      res.status(500).json({ success: false, message: "Could not list the import files" });
    }
  });
}
