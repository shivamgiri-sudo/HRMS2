import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { templateService } from "./template.service.js";
import { dispatchService } from "./dispatch.service.js";
import { notificationPreferencesService } from "./notification-preferences.service.js";
import { providerConfigService } from "./provider-config.service.js";
import { providerFactory } from "./providers/provider.factory.js";
import type {
  Channel,
  DispatchLogFilters,
  DispatchStatus,
  SaveProviderConfigDTO,
  TemplateCategory,
  TemplateFilters,
} from "./communication.types.js";

const router = Router();
router.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req as AuthenticatedRequest, res).catch(next);
  };

function parseChannel(value: unknown): Channel | null {
  return value === "email" || value === "sms" || value === "whatsapp" ? value : null;
}

function buildTestPayload(channel: Channel) {
  const stamp = new Date().toISOString();
  if (channel === "email") {
    return {
      subject: "MAS HRMS communication provider test",
      body: `<p>This is a test email from MAS HRMS.</p><p>Generated at ${stamp}.</p>`,
    };
  }
  if (channel === "sms") {
    return { subject: "", body: `MAS HRMS SMS test at ${stamp}` };
  }
  return { subject: "", body: `MAS HRMS WhatsApp test at ${stamp}` };
}

router.get("/config", requireRole("admin", "super_admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const data = await providerConfigService.listAll();
  return res.json({ success: true, data });
}));

router.get("/config/:channel", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = parseChannel(req.params.channel);
  if (!channel) return res.status(400).json({ success: false, error: "Invalid channel" });
  const { config } = await providerConfigService.getWithSecrets(channel);
  return res.json({ success: true, data: config });
}));

router.put("/config/:channel", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = parseChannel(req.params.channel);
  const userId = req.authUser?.id;
  if (!channel) return res.status(400).json({ success: false, error: "Invalid channel" });
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  await providerConfigService.save(channel, req.body as SaveProviderConfigDTO, userId);
  providerFactory.clearCache();
  return res.json({ success: true, message: `${channel} configuration saved` });
}));

router.post("/config/:channel/enable", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = parseChannel(req.params.channel);
  const userId = req.authUser?.id;
  if (!channel) return res.status(400).json({ success: false, error: "Invalid channel" });
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  await providerConfigService.setEnabled(channel, true, userId);
  providerFactory.clearCache();
  return res.json({ success: true, message: `${channel} enabled` });
}));

router.post("/config/:channel/disable", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = parseChannel(req.params.channel);
  const userId = req.authUser?.id;
  if (!channel) return res.status(400).json({ success: false, error: "Invalid channel" });
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  await providerConfigService.setEnabled(channel, false, userId);
  providerFactory.clearCache();
  return res.json({ success: true, message: `${channel} disabled` });
}));

// The genuine kill switch (send_blocked) — distinct from enable/disable above, which only
// chooses DB-stored vs env-var credentials and does not stop sending. See send-block.ts.
router.post("/config/:channel/block", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = parseChannel(req.params.channel);
  const userId = req.authUser?.id;
  if (!channel) return res.status(400).json({ success: false, error: "Invalid channel" });
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  const reason = String(req.body?.reason ?? "").trim() || null;
  await providerConfigService.setSendBlocked(channel, true, reason, userId);
  return res.json({ success: true, message: `${channel} sending paused` });
}));

router.post("/config/:channel/unblock", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = parseChannel(req.params.channel);
  const userId = req.authUser?.id;
  if (!channel) return res.status(400).json({ success: false, error: "Invalid channel" });
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  await providerConfigService.setSendBlocked(channel, false, null, userId);
  return res.json({ success: true, message: `${channel} sending resumed` });
}));

router.post("/config/:channel/test", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const channel = parseChannel(req.params.channel);
  const userId = req.authUser?.id;
  if (!channel) return res.status(400).json({ success: false, error: "Invalid channel" });
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const testRecipient = String(req.body?.test_recipient ?? "").trim();
  if (!testRecipient) {
    return res.status(400).json({ success: false, error: "test_recipient is required" });
  }

  const { config, secrets } = await providerConfigService.getWithSecrets(channel);
  providerFactory.clearCache();
  const provider = await providerFactory.getProviderAsync(channel, {
    provider_type: config.provider_type,
    config: config.config_json as Record<string, unknown>,
    secrets,
  });

  if (!provider.validateRecipient(testRecipient)) {
    await providerConfigService.saveTestResult(channel, false, "Invalid test recipient format", userId);
    return res.status(400).json({ success: false, error: "Invalid test recipient format", provider: provider.getName() });
  }

  const payload = buildTestPayload(channel);
  const result = await provider.send(testRecipient, payload.subject, payload.body);
  await providerConfigService.saveTestResult(channel, result.success, result.error ?? null, userId);
  return res.json({ success: result.success, error: result.error, provider: provider.getName(), channel });
}));

// GET /api/communication/preferences — get employee notification preferences
router.get("/preferences", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  const emp = await getEmployeeForUser(userId);
  const data = emp
    ? await notificationPreferencesService.getPreferences(emp.id)
    : await notificationPreferencesService.getUserPreferences(userId);
  return res.json({ success: true, data });
}));

// PATCH /api/communication/preferences — update notification preferences
router.patch("/preferences", h(async (req: AuthenticatedRequest, res: Response) => {
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
router.get("/templates", requireRole("admin", "hr", "super_admin", "process_manager", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const filters: TemplateFilters = {
    category: req.query.category as TemplateCategory | undefined,
    channel: req.query.channel as Channel | undefined,
    is_active: req.query.active === undefined ? true : req.query.active === "true",
    search: req.query.search as string | undefined,
  };
  const templates = await templateService.getTemplates(filters);
  return res.json({ success: true, data: templates });
}));

// GET /api/communication/templates/:id
router.get("/templates/:id", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const tpl = await templateService.getTemplateById(req.params.id);
  if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
  return res.json({ success: true, data: tpl });
}));

// POST /api/communication/templates
router.post("/templates", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const tpl = await templateService.createTemplate(req.body);
  return res.status(201).json({ success: true, data: tpl });
}));

// PUT /api/communication/templates/:id
router.put("/templates/:id", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const tpl = await templateService.updateTemplate(req.params.id, req.body);
  return res.json({ success: true, data: tpl });
}));

// DELETE /api/communication/templates/:id
router.delete("/templates/:id", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  await templateService.deactivateTemplate(req.params.id);
  return res.json({ success: true });
}));

// GET /api/communication/templates/variable-schema/:category
router.get("/templates/variable-schema/:category", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const schema = await templateService.getVariableSchema(req.params.category);
  return res.json({ success: true, data: schema });
}));

// ─── Dispatch ────────────────────────────────────────────────────────────────

// POST /api/communication/dispatch/send
router.post("/dispatch/send", requireRole("admin", "hr", "super_admin", "process_manager", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const result = await dispatchService.send(req.body);
  return res.json({ success: true, data: result });
}));

// POST /api/communication/dispatch/bulk-send
router.post("/dispatch/bulk-send", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const result = await dispatchService.bulkSend(req.body);
  return res.json({ success: true, data: result });
}));

// POST /api/communication/dispatch/retry/:id
router.post("/dispatch/retry/:id", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  await dispatchService.retry(req.params.id);
  return res.json({ success: true });
}));

// GET /api/communication/dispatch/logs
router.get("/dispatch/logs", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const filters: DispatchLogFilters = {
    employee_id: req.query.employee_id as string | undefined,
    channel: req.query.channel as Channel | undefined,
    status: req.query.status as DispatchStatus | undefined,
    date_from: req.query.from_date as string | undefined,
    date_to: req.query.to_date as string | undefined,
    page: req.query.page ? Number(req.query.page) : 1,
    limit: req.query.limit ? Number(req.query.limit) : 25,
  };
  const result = await dispatchService.getLogs(filters);
  return res.json({ success: true, ...result });
}));

// GET /api/communication/dispatch/stats
router.get("/dispatch/stats", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const stats = await dispatchService.getStats();
  return res.json({ success: true, data: stats });
}));

export const communicationRouter = router;
