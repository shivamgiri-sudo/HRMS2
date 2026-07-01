import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { workforceMandateService } from "./workforce.mandate.service.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

/**
 * GET /api/workforce-mandate
 * List mandates with optional query filters.
 * Roles: admin | hr | wfm | process_manager
 */
router.get(
  "/",
  requireRole("admin", "hr", "wfm", "process_manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { processId, branchId, active } = req.query as Record<string, string>;
    const filters = {
      processId: processId || undefined,
      branchId: branchId || undefined,
      active: active !== undefined ? active === "true" : undefined,
    };
    const data = await workforceMandateService.listMandates(filters);
    return res.json({ data });
  })
);

/**
 * POST /api/workforce-mandate
 * Upsert a mandate record.
 * Roles: admin | hr
 */
router.post(
  "/",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const {
      processId, branchId, roleGroup, hcType, mandatedHc,
      bufferPct, shrinkagePct, attritionBufferPct, trainingBufferPct,
      effectiveFrom, effectiveTo,
    } = req.body as {
      processId?: string; branchId?: string; roleGroup?: string; hcType?: string;
      mandatedHc?: number; bufferPct?: number; shrinkagePct?: number;
      attritionBufferPct?: number; trainingBufferPct?: number;
      effectiveFrom?: string; effectiveTo?: string;
    };

    if (!processId || !roleGroup || !hcType || mandatedHc === undefined || !effectiveFrom) {
      return res.status(400).json({
        error: "processId, roleGroup, hcType, mandatedHc, and effectiveFrom are required",
      });
    }

    const record = await workforceMandateService.upsertMandate(
      {
        processId,
        branchId,
        roleGroup,
        hcType,
        mandatedHc: Number(mandatedHc),
        bufferPct: Number(bufferPct ?? 10),
        shrinkagePct: Number(shrinkagePct ?? 15),
        attritionBufferPct: Number(attritionBufferPct ?? 5),
        trainingBufferPct: Number(trainingBufferPct ?? 5),
        effectiveFrom,
        effectiveTo,
      },
      req.authUser!.id
    );

    return res.json({ data: record });
  })
);

/**
 * GET /api/workforce-mandate/leadership-summary
 * Per-process summary ordered by staffing risk (red first).
 * Roles: admin | hr | ceo
 */
router.get(
  "/leadership-summary",
  requireRole("admin", "hr", "ceo"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await workforceMandateService.getLeadershipSummary();
    return res.json({ data });
  })
);

/**
 * GET /api/workforce-mandate/support-ratios
 * List support role ratio rules.
 * Roles: admin | hr | wfm
 */
router.get(
  "/support-ratios",
  requireRole("admin", "hr", "wfm"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { processId } = req.query as { processId?: string };
    const data = await workforceMandateService.getSupportRatios(processId);
    return res.json({ data });
  })
);

/**
 * GET /api/workforce-mandate/capacity/:processId
 * Full capacity snapshot for a process.
 * Roles: admin | hr | wfm | process_manager | ceo
 */
router.get(
  "/capacity/:processId",
  requireRole("admin", "hr", "wfm", "process_manager", "ceo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { processId } = req.params;
    const { branchId } = req.query as { branchId?: string };
    const data = await workforceMandateService.getCapacitySnapshot(processId, branchId);
    return res.json({ data });
  })
);

export { router as workforceMandateRouter };
