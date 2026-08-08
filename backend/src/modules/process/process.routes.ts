import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { processController } from "./process.controller.js";

export const processRouter = Router();

processRouter.use(requireAuth);

processRouter.get("/", (req, res, next) => {
  processController.list(req as AuthenticatedRequest, res).catch(next);
});

// MUST stay above "/:id". Express matches in registration order, so if this were declared
// after it, a request for /my-processes would be handled by getById with id="my-processes"
// and answer "Process not found" — the literal route would never run.
processRouter.get("/my-processes", (req, res, next) => {
  processController.listMyProcesses(req as AuthenticatedRequest, res).catch(next);
});

processRouter.get("/:id", (req, res, next) => {
  processController.getById(req as unknown as AuthenticatedRequest, res).catch(next);
});

processRouter.get("/:id/configuration", (req, res, next) => {
  processController.getConfiguration(req as unknown as AuthenticatedRequest, res).catch(next);
});

processRouter.put("/:id/configuration", requireRole("admin", "hr"), (req, res, next) => {
  processController.saveConfiguration(req as AuthenticatedRequest, res).catch(next);
});

processRouter.post("/", requireRole("admin", "hr"), (req, res, next) => {
  processController.create(req as AuthenticatedRequest, res).catch(next);
});

processRouter.put("/:id", requireRole("admin", "hr"), (req, res, next) => {
  processController.update(req as AuthenticatedRequest, res).catch(next);
});

processRouter.patch("/:id/status", requireRole("admin", "hr"), (req, res, next) => {
  processController.updateStatus(req as AuthenticatedRequest, res).catch(next);
});
