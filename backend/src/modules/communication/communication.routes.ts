import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { templateService } from "./template.service.js";
import { dispatchService } from "./dispatch.service.js";
import { notificationPreferencesService } from "./notification-preferences.service.js";

const router = Router();
router.use(requireAuth);

const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) => fn(req, res).catch(next);

// GET /api/communication/preferences — get employee notification preferences
router.get("/preferences", h(async (req: any, res: Response) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  const emp = await getEmployeeForUser(userId);
  const data = emp
    ? await notificationPreferencesService.getPreferences(emp.id)
    : await notificationPreferencesService.getUserPreferences(userId);
  return res.json({ success: true, data });
}));

// PATCH /api/communication/preferences — update notification preferences
router.patch("/preferences", h(async (req: any, res: Response) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  const emp = await getEmployeeForUser(userId);
  const dto = req.body;
  if (!dto.category || !dto.preferred_channel) {
    return res.status(400).json({ success: false, error: "category and preferred_channel are required" });
  }
  const data = emp
    ? await notificationPreferencesService.updatePreference(emp.id, dto)
    : await notificationPreferencesService.updateUserPreference(userId, dto);
  return res.json({ success: true, data });
}));

// ─── Templates ──────────────────────────────────────────────────────────────

// GET /api/communication/templates
router.get("/templates", requireRole("admin", "hr", "super_admin", "process_manager", "manager"), h(async (req: any, res: Response) => {
  const filters = {
    category: req.query.category as string | undefined,
    channel: req.query.channel as string | undefined,
    is_active: req.query.active === undefined ? true : req.query.active === "true",
    search: req.query.search as string | undefined,
  };
  const templates = await templateService.getTemplates(filters as any);
  return res.json({ success: true, data: templates });
}));

// GET /api/communication/templates/:id
router.get("/templates/:id", requireRole("admin", "hr", "super_admin"), h(async (req: any, res: Response) => {
  const tpl = await templateService.getTemplateById(req.params.id);
  if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
  return res.json({ success: true, data: tpl });
}));

// POST /api/communication/templates
router.post("/templates", requireRole("admin", "hr", "super_admin"), h(async (req: any, res: Response) => {
  const tpl = await templateService.createTemplate(req.body);
  return res.status(201).json({ success: true, data: tpl });
}));

// PUT /api/communication/templates/:id
router.put("/templates/:id", requireRole("admin", "hr", "super_admin"), h(async (req: any, res: Response) => {
  const tpl = await templateService.updateTemplate(req.params.id, req.body);
  return res.json({ success: true, data: tpl });
}));

// DELETE /api/communication/templates/:id
router.delete("/templates/:id", requireRole("admin", "super_admin"), h(async (req: any, res: Response) => {
  await templateService.deactivateTemplate(req.params.id);
  return res.json({ success: true });
}));

// GET /api/communication/templates/variable-schema/:category
router.get("/templates/variable-schema/:category", requireRole("admin", "hr", "super_admin"), h(async (req: any, res: Response) => {
  const schema = await templateService.getVariableSchema(req.params.category);
  return res.json({ success: true, data: schema });
}));

// ─── Dispatch ────────────────────────────────────────────────────────────────

// POST /api/communication/dispatch/send
router.post("/dispatch/send", requireRole("admin", "hr", "super_admin", "process_manager", "manager"), h(async (req: any, res: Response) => {
  const result = await dispatchService.send(req.body);
  return res.json({ success: true, data: result });
}));

// POST /api/communication/dispatch/bulk-send
router.post("/dispatch/bulk-send", requireRole("admin", "hr", "super_admin"), h(async (req: any, res: Response) => {
  const result = await dispatchService.bulkSend(req.body);
  return res.json({ success: true, data: result });
}));

// POST /api/communication/dispatch/retry/:id
router.post("/dispatch/retry/:id", requireRole("admin", "hr", "super_admin"), h(async (req: any, res: Response) => {
  await dispatchService.retry(req.params.id);
  return res.json({ success: true });
}));

// GET /api/communication/dispatch/logs
router.get("/dispatch/logs", requireRole("admin", "hr", "super_admin"), h(async (req: any, res: Response) => {
  const filters = {
    employee_id: req.query.employee_id as string | undefined,
    template_name: req.query.template_name as string | undefined,
    channel: req.query.channel as string | undefined,
    status: req.query.status as string | undefined,
    from_date: req.query.from_date as string | undefined,
    to_date: req.query.to_date as string | undefined,
    page: req.query.page ? Number(req.query.page) : 1,
    limit: req.query.limit ? Number(req.query.limit) : 25,
  };
  const result = await dispatchService.getLogs(filters as any);
  return res.json({ success: true, ...result });
}));

// GET /api/communication/dispatch/stats
router.get("/dispatch/stats", requireRole("admin", "hr", "super_admin"), h(async (req: any, res: Response) => {
  const stats = await dispatchService.getStats();
  return res.json({ success: true, data: stats });
}));

export const communicationRouter = router;
