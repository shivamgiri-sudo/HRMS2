import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";

export const aiInsightsRouter = Router();

aiInsightsRouter.use(requireAuth);

aiInsightsRouter.get("/", (_req, res) => {
  res.json({ success: true, data: [] });
});

aiInsightsRouter.post("/insights", (_req, res) => {
  res.json({ success: true, data: { insights: [] } });
});
