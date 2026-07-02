import { Router } from "express";

export const aiInsightsRouter = Router();

aiInsightsRouter.get("/", (_req, res) => {
  res.json({ success: true, data: [] });
});
