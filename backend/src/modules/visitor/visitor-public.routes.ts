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
