import { Router, type NextFunction, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth, requireWriteAccess } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { performanceSchedulerService } from "./performance-scheduler.service.js";

const router = Router();
const managers = ["super_admin", "admin", "process_manager", "qa_manager"] as const;
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

const scheduleSchema = z.object({
  cronExpression: z.string().trim().max(100).nullable(),
  scheduleLookbackDays: z.coerce.number().int().min(1).max(31).default(2),
});

router.use(requireAuth);

router.get(
  "/datasets/:id/schedule",
  requireRole(...readers),
  asyncHandler(async (req, res) => {
    const data = await performanceSchedulerService.getSchedule(
      req.authUser!.id,
      req.params.id,
    );
    return res.json({ success: true, data });
  }),
);

router.put(
  "/datasets/:id/schedule",
  requireWriteAccess,
  requireRole(...managers),
  asyncHandler(async (req, res) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
    }
    const data = await performanceSchedulerService.setSchedule(
      req.authUser!.id,
      req.params.id,
      parsed.data,
    );
    return res.json({ success: true, data });
  }),
);

router.post(
  "/datasets/:id/run-now",
  requireWriteAccess,
  requireRole(...managers),
  asyncHandler(async (req, res) => {
    const data = await performanceSchedulerService.runNow(
      req.authUser!.id,
      req.params.id,
    );
    return res.json({ success: true, data });
  }),
);

export { router as performanceSchedulerRouter };
