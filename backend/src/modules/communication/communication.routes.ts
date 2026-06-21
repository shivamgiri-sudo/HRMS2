import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { templateService } from "./template.service.js";
import { dispatchService } from "./dispatch.service.js";

const router = Router();
router.use(requireAuth);

const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) => fn(req, res).catch(next);

// GET /api/communication/preferences — get employee notification preferences
router.get("/preferences", h(async (req: any, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser?.id);
  if (!emp) return res.status(404).json({ success: false, error: "No employee record" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id,
            email_on_leave_approval, email_on_leave_rejection,
            email_on_attendance_mark, email_on_payroll_ready,
            email_on_performance_review, email_on_promotion,
            sms_on_leave_approval, sms_on_attendance_mark,
            in_app_on_leave_approval, in_app_on_payroll_ready,
            push_notifications_enabled,
            created_at, updated_at
     FROM communication_preferences
     WHERE employee_id = ?
     LIMIT 1`,
    [emp.id]
  );

  if (!rows.length) {
    return res.json({
      success: true,
      data: {
        employee_id: emp.id,
        email_on_leave_approval: true,
        email_on_leave_rejection: true,
        email_on_attendance_mark: false,
        email_on_payroll_ready: true,
        email_on_performance_review: true,
        email_on_promotion: true,
        sms_on_leave_approval: false,
        sms_on_attendance_mark: false,
        in_app_on_leave_approval: true,
        in_app_on_payroll_ready: true,
        push_notifications_enabled: true,
      },
    });
  }

  return res.json({ success: true, data: rows[0] });
}));

// PATCH /api/communication/preferences — update notification preferences
router.patch("/preferences", h(async (req: any, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser?.id);
  if (!emp) return res.status(404).json({ success: false, error: "No employee record" });

  const updates = req.body;
  const allowedFields = [
    "email_on_leave_approval",
    "email_on_leave_rejection",
    "email_on_attendance_mark",
    "email_on_payroll_ready",
    "email_on_performance_review",
    "email_on_promotion",
    "sms_on_leave_approval",
    "sms_on_attendance_mark",
    "in_app_on_leave_approval",
    "in_app_on_payroll_ready",
    "push_notifications_enabled",
  ];

  const fields = Object.keys(updates).filter((k) => allowedFields.includes(k));
  if (!fields.length) {
    return res.status(400).json({ success: false, error: "No valid fields provided" });
  }

  const sets = fields.map((f) => `${f} = ?`).join(", ");
  const vals = fields.map((f) => (updates[f] !== null ? Boolean(updates[f]) : null));

  await db.execute(
    `INSERT INTO communication_preferences (id, employee_id, ${fields.join(", ")})
     VALUES (UUID(), ?, ${fields.map(() => "?").join(", ")})
     ON DUPLICATE KEY UPDATE ${sets}`,
    [emp.id, ...vals, ...vals]
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM communication_preferences WHERE employee_id = ? LIMIT 1`,
    [emp.id]
  );

  return res.json({ success: true, data: rows[0] });
}));

// ─── Templates ──────────────────────────────────────────────────────────────

// GET /api/communication/templates
router.get("/templates", requireRole("admin", "hr", "super_admin", "process_manager", "manager"), h(async (req: any, res: Response) => {
  const filters = {
    category: req.query.category as string | undefined,
    channel: req.query.channel as string | undefined,
    active: req.query.active === undefined ? true : req.query.active === "true",
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
