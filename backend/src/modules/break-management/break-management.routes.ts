import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { breakManagementService } from "./break-management.service.js";

export const breakManagementRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

breakManagementRouter.use(requireAuth);
breakManagementRouter.use(requireRole("admin", "hr", "wfm", "manager", "process_manager", "team_leader", "tl", "ceo"));

breakManagementRouter.get("/dashboard", h(async (req, res) => {
  const query = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    branch_id: z.string().optional(),
    process_id: z.string().optional(),
  }).parse(req.query);
  const data = await breakManagementService.getDashboard(query);
  return res.json({ success: true, data });
}));

breakManagementRouter.get("/reports", h(async (req, res) => {
  const query = z.object({
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    branch_id: z.string().optional(),
    process_id: z.string().optional(),
    department_id: z.string().optional(),
    manager_id: z.string().optional(),
    employee_id: z.string().optional(),
    break_type: z.string().optional(),
    exception_status: z.enum(["yes", "no"]).optional(),
    status: z.string().optional(),
    limit: z.coerce.number().optional(),
  }).parse(req.query);
  const data = await breakManagementService.getReports(query);
  return res.json({ success: true, data });
}));

breakManagementRouter.get("/settings", h(async (_req, res) => {
  const data = await breakManagementService.getSettingsView();
  return res.json({ success: true, data });
}));

breakManagementRouter.post("/settings", h(async (req: any, res) => {
  const body = z.object({
    id: z.string().optional(),
    branch_id: z.string().optional().nullable(),
    process_id: z.string().optional().nullable(),
    mini_break_max_minutes: z.coerce.number().min(1).max(120),
    long_break_min_minutes: z.coerce.number().min(1).max(120),
    active_break_alert_minutes: z.coerce.number().min(1).max(240),
    daily_total_allowed_minutes: z.coerce.number().min(1).max(480),
    max_long_break_count: z.coerce.number().min(1).max(20),
    escalation_after_minutes: z.coerce.number().min(1).max(240),
    auto_close_on_biometric_punch_out: z.boolean(),
    allow_break_without_biometric: z.boolean(),
    require_exception_reason: z.boolean(),
    alert_reporting_manager: z.boolean(),
    alert_hr: z.boolean(),
    alert_wfm: z.boolean(),
    alert_cc_list: z.array(z.string().email()).optional(),
  }).parse(req.body);
  const data = await breakManagementService.saveSettings(body, req.authUser.id, req);
  return res.json({ success: true, data, message: "Break settings saved" });
}));

breakManagementRouter.get("/exceptions", h(async (req, res) => {
  const query = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.coerce.number().optional(),
  }).parse(req.query);
  const data = await breakManagementService.getExceptions(query);
  return res.json({ success: true, data });
}));

breakManagementRouter.post("/sync-biometric-now", h(async (_req, res) => {
  const data = await breakManagementService.syncBiometricNow();
  return res.json({ success: true, data });
}));
