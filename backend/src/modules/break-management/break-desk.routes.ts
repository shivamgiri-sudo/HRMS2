import { Router } from "express";
import { z } from "zod";
import { breakManagementService } from "./break-management.service.js";

export const breakDeskRouter = Router();

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const kioskQuerySchema = z.object({
  kiosk: z.string().min(1),
  token: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

breakDeskRouter.get("/bootstrap", h(async (req, res) => {
  const query = kioskQuerySchema.parse(req.query);
  const data = await breakManagementService.getDeskBootstrap(query.kiosk, query.token, req, query.date);
  return res.json({ success: true, data });
}));

breakDeskRouter.get("/employees", h(async (req, res) => {
  const base = kioskQuerySchema.extend({
    search: z.string().optional(),
    branch_id: z.string().optional(),
    process_id: z.string().optional(),
    department_id: z.string().optional(),
    manager_id: z.string().optional(),
    shift: z.string().optional(),
    status: z.string().optional(),
    limit: z.coerce.number().optional(),
  }).parse(req.query);
  const data = await breakManagementService.listDeskEmployees(base.kiosk, base.token, req, base);
  return res.json({ success: true, data });
}));

breakDeskRouter.get("/live-status", h(async (req, res) => {
  const base = kioskQuerySchema.extend({
    search: z.string().optional(),
    branch_id: z.string().optional(),
    process_id: z.string().optional(),
    department_id: z.string().optional(),
    manager_id: z.string().optional(),
    shift: z.string().optional(),
    status: z.string().optional(),
    limit: z.coerce.number().optional(),
  }).parse(req.query);
  const data = await breakManagementService.getLiveStatus(base.kiosk, base.token, req, base);
  return res.json({ success: true, data });
}));

breakDeskRouter.post("/start-break", h(async (req, res) => {
  const body = z.object({
    kiosk: z.string().min(1),
    token: z.string().min(1),
    employee_id: z.string().min(1),
    break_reason: z.string().min(1),
    exception_reason: z.string().optional().nullable(),
    manager_approval_required: z.boolean().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(req.body);
  const data = await breakManagementService.startBreak(body.kiosk, body.token, req, body);
  return res.status(201).json({ success: true, data, message: "Break started" });
}));

breakDeskRouter.post("/punch-in", h(async (req, res) => {
  const body = z.object({
    kiosk: z.string().min(1),
    token: z.string().min(1),
    employee_id: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(req.body);
  const data = await breakManagementService.punchIn(body.kiosk, body.token, req, body);
  return res.status(201).json({ success: true, data, message: "Punch in captured" });
}));

breakDeskRouter.post("/punch-out", h(async (req, res) => {
  const body = z.object({
    kiosk: z.string().min(1),
    token: z.string().min(1),
    employee_id: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(req.body);
  const data = await breakManagementService.punchOut(body.kiosk, body.token, req, body);
  return res.json({ success: true, data, message: "Punch out captured" });
}));

breakDeskRouter.post("/end-break", h(async (req, res) => {
  const body = z.object({
    kiosk: z.string().min(1),
    token: z.string().min(1),
    break_session_id: z.string().optional().nullable(),
    employee_id: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(req.body);
  const data = await breakManagementService.endBreak(body.kiosk, body.token, req, body);
  return res.json({ success: true, data, message: "Break ended" });
}));
