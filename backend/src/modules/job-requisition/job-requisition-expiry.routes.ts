import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  decideExpiry,
  ExpiryDecisionError,
  HR_TEAM_ROLES,
  listPendingExpiryDecisions,
} from "./job-requisition-deadline.service.js";

export const jobRequisitionExpiryRouter = Router();

// The HR team (every HR role) sees and decides; super_admin passes requireRole for every route.
jobRequisitionExpiryRouter.use(requireAuth);
jobRequisitionExpiryRouter.use(requireRole(...HR_TEAM_ROLES));

const handler =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

jobRequisitionExpiryRouter.get(
  "/pending",
  handler(async (_req, res) => {
    const data = await listPendingExpiryDecisions();
    return res.json({ success: true, data });
  }),
);

const decisionBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("close"),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("extend"),
    reason: z.string().trim().min(3).max(500),
    newValidity: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    action: z.literal("keep_open"),
    reason: z.string().trim().min(3).max(500),
  }),
]);

jobRequisitionExpiryRouter.post(
  "/:decisionId/decide",
  handler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.decisionId);
    const body = decisionBody.safeParse(req.body);
    if (!id.success || !body.success) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "A valid action and a reason of at least 3 characters are required",
        });
    }
    try {
      await decideExpiry(
        id.data,
        { id: req.authUser!.id, name: req.authUser?.email ?? null },
        body.data,
      );
      return res.json({ success: true });
    } catch (error) {
      if (error instanceof ExpiryDecisionError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      throw error;
    }
  }),
);
