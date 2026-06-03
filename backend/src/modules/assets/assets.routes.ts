import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { assetsService } from "./assets.service.js";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// Full asset master list: admin/hr only
router.get("/", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await assetsService.list(req.query as any) });
}));

router.post("/", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.status(201).json({ data: await assetsService.create(req.body) });
}));

// Employee self-service: own assignments only; admin/hr can query any employee
router.get("/employee/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const targetId = req.params.employeeId;

  if (await hasRole(userId, "admin", "hr")) {
    return res.json({ data: await assetsService.listByEmployee(targetId) });
  }

  const callerEmp = await getEmployeeForUser(userId);
  if (!callerEmp || callerEmp.id !== targetId) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  res.json({ data: await assetsService.listByEmployee(targetId) });
}));

// Asset detail: admin/hr only
router.get("/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const asset = await assetsService.getById(req.params.id);
  if (!asset) return res.status(404).json({ error: "Not found" });
  res.json({ data: asset });
}));

router.put("/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await assetsService.update(req.params.id, req.body) });
}));

router.post("/:id/assign", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, notes } = req.body;
  if (!employee_id) return res.status(400).json({ error: "employee_id required" });
  const assignment = await assetsService.assign(req.params.id, employee_id, req.authUser!.id, notes, req);
  res.status(201).json({ data: assignment });
}));

router.post("/:id/return", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { condition } = req.body;
  await assetsService.returnAsset(req.params.id, condition ?? "good", req.authUser!.id, req);
  res.json({ ok: true });
}));

router.post("/:id/service", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const id = await assetsService.addServiceLog(req.params.id, req.body);
  res.status(201).json({ data: { id } });
}));

router.delete("/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const asset = await assetsService.getById(req.params.id);
  if (!asset) return res.status(404).json({ error: "Asset not found" });
  await db.execute("UPDATE asset_master SET active_status = 0, updated_at = NOW() WHERE id = ?", [req.params.id]);
  await logSensitiveAction({
    actor_user_id: req.authUser!.id, action_type: "ASSET_DELETED", module_key: "ASSETS",
    entity_type: "asset", entity_id: req.params.id,
    change_summary: { asset_code: asset.asset_code },
    req,
  });
  res.json({ ok: true });
}));

export { router as assetsRouter };
