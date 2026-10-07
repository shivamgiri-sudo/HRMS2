import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getSuperAdminAnalyticsSummary } from "./super-admin-analytics.service.js";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

const router = Router();
router.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res).catch(next);

// Super Admin Analytics (Dashboard)
router.get(
  "/analytics",
  requireRole("super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const summary = await getSuperAdminAnalyticsSummary();
    res.json({ success: true, data: summary });
  }),
);

export { router as superAdminRouter };
