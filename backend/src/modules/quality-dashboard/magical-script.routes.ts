import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getMagicalScript } from "./magical-script.service.js";

const router = Router();
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(
  requireAuth,
  requireRole("super_admin", "admin", "ceo", "manager", "process_manager", "operations_manager", "qa", "quality_analyst")
);

router.get(
  "/",
  h(async (req, res) => {
    const { clientId, processId, startDate, endDate } = req.query as Record<string, string>;
    const data = await getMagicalScript({ clientId, processId, startDate, endDate });
    res.json({ data });
  })
);

export { router as magicalScriptRouter };
