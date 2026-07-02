import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { processController } from "./process.controller.js";

export const processRouter = Router();

processRouter.use(requireAuth);

processRouter.get("/", (req, res, next) => {
  processController.list(req, res).catch(next);
});

processRouter.get("/:id", (req, res, next) => {
  processController.getById(req, res).catch(next);
});

processRouter.get("/:id/configuration", (req, res, next) => {
  processController.getConfiguration(req, res).catch(next);
});

processRouter.put("/:id/configuration", requireRole("admin", "hr"), (req, res, next) => {
  processController.saveConfiguration(req, res).catch(next);
});

processRouter.post("/", requireRole("admin", "hr"), (req, res, next) => {
  processController.create(req, res).catch(next);
});

processRouter.put("/:id", requireRole("admin", "hr"), (req, res, next) => {
  processController.update(req, res).catch(next);
});

processRouter.patch("/:id/status", requireRole("admin", "hr"), (req, res, next) => {
  processController.updateStatus(req, res).catch(next);
});
