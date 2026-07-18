import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getDomains, getDomainDetail, updateDomain, getDomainHistory } from "./policy-engine.service.js";

export const policyEngineRouter = Router();

policyEngineRouter.use(requireAuth);
policyEngineRouter.use(requireRole("super_admin"));

const domainKeySchema = z.string().regex(/^[a-z0-9_]+$/);

const updatePayloadSchema = z.object({
  reason:  z.string().min(3, "Reason is required"),
  updates: z.array(z.object({
    section_key: z.string().min(1),
    config_key:  z.string().min(1),
    new_value:   z.string(),
  })).min(1),
});

policyEngineRouter.get("/domains", async (_req, res) => {
  const data = await getDomains();
  res.json({ success: true, data });
});

policyEngineRouter.get("/domains/:domainKey", async (req, res) => {
  const parse = domainKeySchema.safeParse(req.params.domainKey);
  if (!parse.success) return res.status(400).json({ success: false, message: "Invalid domain key" });

  const domain = await getDomainDetail(parse.data);
  if (!domain) return res.status(404).json({ success: false, message: "Domain not found" });

  res.json({ success: true, data: domain });
});

policyEngineRouter.put("/domains/:domainKey", async (req, res) => {
  const parse = domainKeySchema.safeParse(req.params.domainKey);
  if (!parse.success) return res.status(400).json({ success: false, message: "Invalid domain key" });

  const body = updatePayloadSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ success: false, errors: body.error.flatten() });

  const actorId = (req as any).user?.id ?? "unknown";
  await updateDomain(parse.data, body.data.updates, body.data.reason, actorId, req);

  res.json({ success: true, message: "Policy updated" });
});

policyEngineRouter.get("/domains/:domainKey/history", async (req, res) => {
  const parse = domainKeySchema.safeParse(req.params.domainKey);
  if (!parse.success) return res.status(400).json({ success: false, message: "Invalid domain key" });

  const data = await getDomainHistory(parse.data);
  res.json({ success: true, data });
});
