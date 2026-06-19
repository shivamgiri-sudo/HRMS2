import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { communicationController as c } from './communication.controller.js';
import { providerConfigService } from './provider-config.service.js';
import { providerFactory } from './providers/provider.factory.js';
import { ChannelParamSchema, SaveEmailConfigSchema, SaveSMSConfigSchema, SaveWAConfigSchema } from './communication.validation.js';
import type { TestResult, Channel } from './communication.types.js';
import { notificationEventService, NOTIFICATION_EVENT_CATALOG } from './notification-event.service.js';

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// Templates — HR/Admin only for write, all authenticated for read
router.get('/templates',           h(c.listTemplates));
router.post('/templates/render',   h(c.renderTemplate));
router.get('/templates/:id',       h(c.getTemplate));
router.post('/templates',          requireRole('admin', 'hr'), h(c.createTemplate));
router.patch('/templates/:id',     requireRole('admin', 'hr'), h(c.updateTemplate));
router.delete('/templates/:id',    requireRole('admin', 'hr'), h(c.deleteTemplate));

// Dispatch
router.get('/events/catalog', h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: notificationEventService.listCatalog() });
}));
router.post('/events/dispatch', requireRole('admin', 'hr', 'process_manager', 'assistant_manager', 'team_leader'), h(async (req: AuthenticatedRequest, res: Response) => {
  const eventCode = String(req.body?.event_code ?? '');
  const recipientEmployeeIds: string[] = Array.isArray(req.body?.recipient_employee_ids)
    ? req.body.recipient_employee_ids.map(String)
    : [];
  const channels = Array.isArray(req.body?.channels) ? req.body.channels as Channel[] : undefined;
  if (!(eventCode in NOTIFICATION_EVENT_CATALOG)) {
    return res.status(400).json({ success: false, error: 'Unknown event_code' });
  }
  if (!recipientEmployeeIds.length || recipientEmployeeIds.some(id => !/^[0-9a-f-]{36}$/i.test(id))) {
    return res.status(400).json({ success: false, error: 'Valid recipient_employee_ids are required' });
  }
  if (channels?.some(channel => !['email', 'sms', 'whatsapp'].includes(channel))) {
    return res.status(400).json({ success: false, error: 'Invalid channel' });
  }
  const result = await notificationEventService.dispatch({
    eventCode: eventCode as keyof typeof NOTIFICATION_EVENT_CATALOG,
    recipientEmployeeIds,
    data: req.body?.data ?? {},
    channels,
  });
  res.json({ success: true, data: result });
}));
router.post('/dispatch/send',      requireRole('admin', 'hr', 'process_manager', 'assistant_manager', 'team_leader'), h(c.send));
router.post('/dispatch/bulk',      requireRole('admin', 'hr'), h(c.bulkSend));
router.post('/dispatch/retry/:id', requireRole('admin', 'hr'), h(c.retryDispatch));
router.get('/dispatch/logs',       requireRole('admin', 'hr'), h(c.getLogs));
router.get('/dispatch/stats',      requireRole('admin', 'hr'), h(c.getStats));

// Preferences — any authenticated user
router.get('/preferences',         h(c.getPreferences));
router.patch('/preferences',       h(c.updatePreference));

// ── Provider Config Routes (admin only) ──────────────────────────────────

// GET /api/communication/config
router.get('/config', requireRole('admin'), h(async (_req: AuthenticatedRequest, res: Response) => {
  const configs = await providerConfigService.listAll();
  res.json({ success: true, data: configs });
}));

// GET /api/communication/config/:channel
router.get('/config/:channel', requireRole('admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const parsed = ChannelParamSchema.safeParse(req.params.channel);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid channel. Must be email, sms, or whatsapp' });
  const result = await providerConfigService.getWithSecrets(parsed.data);
  const maskedSecrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.secrets)) {
    maskedSecrets[k] = v ? '••••••••' : '';
  }
  res.json({ success: true, data: { ...result.config, secrets: maskedSecrets } });
}));

// PUT /api/communication/config/:channel
router.put('/config/:channel', requireRole('admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const parsed = ChannelParamSchema.safeParse(req.params.channel);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid channel' });
  const schema = parsed.data === 'email' ? SaveEmailConfigSchema : parsed.data === 'sms' ? SaveSMSConfigSchema : SaveWAConfigSchema;
  const dto = schema.safeParse(req.body);
  if (!dto.success) return res.status(400).json({ error: 'Validation failed', details: dto.error.errors });
  await providerConfigService.save(parsed.data, { provider_type: dto.data.provider_type as any, config: dto.data.config as any, secrets: dto.data.secrets as any }, req.authUser!.id);
  providerFactory.clearCache();
  res.json({ success: true, message: `${parsed.data} configuration saved` });
}));

// POST /api/communication/config/:channel/enable
router.post('/config/:channel/enable', requireRole('admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const parsed = ChannelParamSchema.safeParse(req.params.channel);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid channel' });
  await providerConfigService.setEnabled(parsed.data, true, req.authUser!.id);
  providerFactory.clearCache();
  res.json({ success: true, message: `${parsed.data} channel enabled` });
}));

// POST /api/communication/config/:channel/disable
router.post('/config/:channel/disable', requireRole('admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const parsed = ChannelParamSchema.safeParse(req.params.channel);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid channel' });
  await providerConfigService.setEnabled(parsed.data, false, req.authUser!.id);
  providerFactory.clearCache();
  res.json({ success: true, message: `${parsed.data} channel disabled` });
}));

// POST /api/communication/config/:channel/test
router.post('/config/:channel/test', requireRole('admin'), h(async (req: AuthenticatedRequest, res: Response) => {
  const parsed = ChannelParamSchema.safeParse(req.params.channel);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid channel' });
  const { test_recipient } = req.body as { test_recipient?: string };
  if (!test_recipient) return res.status(400).json({ error: 'test_recipient required' });

  // Use saved config even if currently disabled (allow testing before enabling)
  let dbConfig = await providerConfigService.loadActiveConfig(parsed.data);
  if (!dbConfig) {
    try {
      const r = await providerConfigService.getWithSecrets(parsed.data);
      dbConfig = { provider_type: r.config.provider_type, config: r.config.config_json as Record<string, unknown>, secrets: r.secrets };
    } catch {
      return res.status(400).json({ success: false, error: 'No configuration saved yet. Save configuration first.' });
    }
  }

  providerFactory.clearCache();
  let provider;
  try {
    provider = await providerFactory.getProviderAsync(parsed.data, dbConfig);
  } catch (e: any) {
    await providerConfigService.saveTestResult(parsed.data, false, e.message, req.authUser!.id);
    return res.status(400).json({ success: false, error: e.message, provider: 'unknown', channel: parsed.data } as TestResult);
  }

  if (!provider.validateRecipient(test_recipient)) {
    const err = `Invalid ${parsed.data} recipient format: ${test_recipient}`;
    await providerConfigService.saveTestResult(parsed.data, false, err, req.authUser!.id);
    return res.status(400).json({ success: false, error: err, provider: provider.getName(), channel: parsed.data } as TestResult);
  }

  const result = await provider.send(
    test_recipient,
    'MAS Callnet HRMS — Test Notification',
    parsed.data === 'email'
      ? '<h2>Test email from MAS Callnet HRMS</h2><p>If you received this, your email configuration is working correctly.</p>'
      : 'Test message from MAS Callnet HRMS. Your communication channel is configured correctly.',
  );

  await providerConfigService.saveTestResult(parsed.data, result.success, result.error ?? null, req.authUser!.id);
  providerFactory.clearCache();

  const response: TestResult = { success: result.success, error: result.error, provider: provider.getName(), channel: parsed.data };
  res.status(result.success ? 200 : 502).json(response);
}));

export { router as communicationRouter };
