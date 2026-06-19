import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { businessCommandService } from "./business-command.service.js";

export const businessCommandRouter = Router();
businessCommandRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

businessCommandRouter.get("/overview", h(async (_req, res) => {
  res.json({ success: true, data: await businessCommandService.overview() });
}));
