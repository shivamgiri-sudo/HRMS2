import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { visitorService } from "./visitor.service.js";
import { consentSchema, publicRegistrationSchema, trackingTokenSchema } from "./visitor.validation.js";

export const visitorPublicRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const registrationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many registration attempts; please wait and try again" },
});

visitorPublicRouter.use(rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many visitor requests; please wait and try again" },
}));

visitorPublicRouter.get("/branches", h(async (_req, res) => {
  const data = await visitorService.listPublicBranches();
  return res.json({ success: true, data });
}));

// Public host search — returns name/code/designation only (no PII)
visitorPublicRouter.get("/hosts", h(async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const branchId = String(req.query.branch_id ?? "").trim();
  if (q.length < 2) return res.json({ success: true, data: [] });
  const data = await visitorService.searchPublicHosts(q, branchId || undefined);
  return res.json({ success: true, data });
}));

visitorPublicRouter.post("/register", registrationLimiter, h(async (req, res) => {
  const input = publicRegistrationSchema.parse(req.body);
  const data = await visitorService.registerPublic(input, req);
  return res.status(201).json({ success: true, data });
}));

visitorPublicRouter.get("/status/:trackingToken", h(async (req, res) => {
  const token = trackingTokenSchema.parse(req.params.trackingToken);
  const data = await visitorService.getPublicStatus(token);
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, data });
}));

visitorPublicRouter.post("/consent", h(async (req, res) => {
  const input = consentSchema.parse(req.body);
  const data = await visitorService.recordPublicConsent(input, req);
  return res.json({ success: true, data });
}));

visitorPublicRouter.post("/checkout-request", h(async (req, res) => {
  const input = z.object({ tracking_token: trackingTokenSchema }).parse(req.body);
  const data = await visitorService.requestPublicCheckout(input.tracking_token, req);
  return res.json({ success: true, data });
}));

// ── Public Gate Console (no auth — guards access without HRMS login) ──────────

const gateVisitsSchema = z.object({
  branch_id: z.string().uuid("branch_id must be a valid UUID"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

const gateEventSchema = z.object({
  visit_id: z.string().uuid("visit_id must be a valid UUID"),
  gate_code: z.string().min(2, "gate_code required (min 2 chars)").max(50),
  badge_number: z.string().max(50).optional(),
});

visitorPublicRouter.get("/gate/visits", h(async (req, res) => {
  const { branch_id, date } = gateVisitsSchema.parse({
    branch_id: req.query.branch_id,
    date: req.query.date ?? new Date().toISOString().slice(0, 10),
  });
  const data = await visitorService.listGateVisits(branch_id, date);
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, data });
}));

visitorPublicRouter.post("/gate/check-in", h(async (req, res) => {
  const { visit_id, gate_code, badge_number } = gateEventSchema.parse(req.body);
  const data = await visitorService.publicGateCheckEvent(visit_id, "checked_in", gate_code, badge_number);
  return res.json({ success: true, data });
}));

visitorPublicRouter.post("/gate/check-out", h(async (req, res) => {
  const { visit_id, gate_code } = gateEventSchema.parse(req.body);
  const data = await visitorService.publicGateCheckEvent(visit_id, "checked_out", gate_code);
  return res.json({ success: true, data });
}));
