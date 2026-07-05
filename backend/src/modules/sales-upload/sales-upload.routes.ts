import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";

export const salesUploadRouter = Router();

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

salesUploadRouter.use(requireAuth);
salesUploadRouter.use(requireRole("super_admin", "admin", "ceo", "coo", "sales", "hr"));

salesUploadRouter.get("/health", h(async (_req, res) => {
  return res.json({
    success: true,
    data: {
      module: "sales-upload",
      status: "available",
      message: "Sales upload routes are registered. Upload workflow can be enabled from the Sales module.",
    },
  });
}));
