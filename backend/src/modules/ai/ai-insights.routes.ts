import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { aiInsightsService } from "./ai-insights.service.js";

const router = Router();

router.post(
  "/insights",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const { context_type, data, role } = req.body as {
      context_type?: string;
      data?: unknown;
      role?: string;
    };

    if (!context_type || typeof data !== "object" || data === null || !role) {
      return res.status(400).json({
        success: false,
        message: "context_type, data (object), and role are required",
      });
    }

    try {
      const result = await aiInsightsService.getInsights({
        context_type,
        data: data as Record<string, unknown>,
        role,
        user_id: req.authUser!.id,
      });
      return res.json({ success: true, data: result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "AI service error";
      const status = msg.includes("rate limit") ? 429 : 500;
      return res.status(status).json({ success: false, message: msg });
    }
  }
);

export const aiInsightsRouter = router;
