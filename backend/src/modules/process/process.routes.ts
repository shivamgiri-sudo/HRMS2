import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { processController } from "./process.controller.js";

export const processRouter = Router();

processRouter.use(requireAuth);

processRouter.get("/", (req, res, next) => {
  processController.list(req, res).catch(next);
});

processRouter.get("/:id", (req, res, next) => {
  processController.getById(req, res).catch(next);
});

processRouter.post("/", (req, res, next) => {
  processController.create(req, res).catch(next);
});

processRouter.put("/:id", (req, res, next) => {
  processController.update(req, res).catch(next);
});

processRouter.patch("/:id/status", (req, res, next) => {
  processController.updateStatus(req, res).catch(next);
});
