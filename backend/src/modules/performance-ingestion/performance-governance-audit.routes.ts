import { Router, type NextFunction, type RequestHandler, type Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { performanceGovernanceAuditService } from "./performance-governance-audit.service.js";

const router = Router();
const readers = [
  "super_admin",
  "admin",
  "hr",
  "process_manager",
  "qa_manager",
  "quality_lead",
] as const;

const asyncHandler = (
  handler: (req: AuthenticatedRequest, res: Response) => Promise<unknown>,
): RequestHandler => (req, res, next: NextFunction) =>
  Promise.resolve(handler(req as AuthenticatedRequest, res)).catch(next);

router.use(requireAuth);

router.get(
  "/governance-audit",
  requireRole(...readers),
  asyncHandler(async (req, res) => {
    const data = await performanceGovernanceAuditService.list(req.authUser!.id, {
      datasetId: req.query.datasetId ? String(req.query.datasetId) : null,
      actionCode: req.query.actionCode ? String(req.query.actionCode) : null,
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 50),
    });
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ success: true, data });
  }),
);

export { router as performanceGovernanceAuditRouter };
