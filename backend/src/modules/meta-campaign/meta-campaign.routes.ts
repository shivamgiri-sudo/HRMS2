/**
 * META Campaign Automation routes.
 *
 * Two distinct security zones live in this file, and the split matters:
 *
 *   /webhooks       UNAUTHENTICATED by necessity. META's servers call it and cannot present a
 *                   session. It is protected instead by (a) the GET handshake requiring
 *                   hub.verify_token to equal META_LEAD_VERIFY_TOKEN, and (b) the POST handler
 *                   verifying the X-Hub-Signature-256 HMAC against META_APP_SECRET. Without a
 *                   configured secret the route refuses the request rather than trusting it —
 *                   an unauthenticated endpoint that writes to the ATS must not accept anonymous
 *                   bodies.
 *   /voice-callback UNAUTHENTICATED for the same reason (the voice bot posts to it), gated on a
 *                   shared secret in the VOICEBOT_CALLBACK_TOKEN header. It can only ever update
 *                   call-outcome columns on a lead it already knows the UUID of.
 *   everything else requireAuth + requireRole.
 */

import { Router } from 'express';
import type { Response, NextFunction, Request } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { metaCampaignService } from './meta-campaign.service.js';
import { notifyQualifiedLead, recordVoiceCallback } from './lead-outreach.service.js';
import { leadVerifyToken, isMetaConfigured } from './meta-api.client.js';
import type { MetaCampaignStatus, MetaWebhookLeadPayload } from './meta-campaign.types.js';

export const metaCampaignRouter = Router();

/** Read access mirrors the requisition read roles — a campaign is a view onto a requisition. */
const CAMPAIGN_READ_ROLES = [
  'super_admin', 'admin', 'hr', 'recruitment_hr', 'branch_head', 'operations_manager',
  'process_manager', 'management', 'manager', 'assistant_manager', 'recruiter',
] as const;

/** Writes are narrower: linking a form ID wrongly misroutes candidates, so keep it with HR. */
const CAMPAIGN_WRITE_ROLES = ['super_admin', 'admin', 'hr', 'recruitment_hr'] as const;

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// ─────────────────────────── webhook: verification handshake ───────────────────────────

/**
 * META calls this once when the webhook is subscribed, echoing hub.challenge back.
 *
 * Compared with timingSafeEqual rather than `===`. The comparison is against a static secret that
 * an attacker can probe repeatedly, which is precisely the condition where a short-circuiting
 * string compare leaks length and prefix information.
 */
metaCampaignRouter.get('/webhooks', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = String(req.query['hub.verify_token'] ?? '');
  const challenge = req.query['hub.challenge'];
  const expected = leadVerifyToken();

  if (!expected) {
    console.warn('[meta webhook] verification attempted but META_LEAD_VERIFY_TOKEN is not set');
    return res.status(503).send('verify token not configured');
  }

  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  const ok = mode === 'subscribe' && a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) return res.status(403).send('verification failed');
  return res.status(200).send(String(challenge ?? ''));
});

// ─────────────────────────── webhook: lead delivery ───────────────────────────

/**
 * Verify META's HMAC over the RAW request body.
 *
 * Requires `req.rawBody` to have been captured by the JSON body parser — a re-serialised
 * `JSON.stringify(req.body)` will not reproduce META's byte sequence (key order and unicode
 * escaping both differ), so signature checks against it fail intermittently and inexplicably.
 */
function verifySignature(req: Request): { ok: boolean; reason: string | null } {
  const secret = process.env.META_APP_SECRET ?? '';
  if (!secret) {
    return { ok: false, reason: 'META_APP_SECRET is not configured; refusing unverified webhook' };
  }

  const header = req.header('x-hub-signature-256') ?? '';
  if (!header.startsWith('sha256=')) {
    return { ok: false, reason: 'missing or malformed X-Hub-Signature-256' };
  }

  const raw = (req as Request & { rawBody?: Buffer | string }).rawBody;
  if (!raw) {
    return { ok: false, reason: 'raw body unavailable; cannot verify signature' };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw)
    .digest('hex');

  const got = header.slice('sha256='.length);
  const a = Buffer.from(got, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true, reason: null };
}

metaCampaignRouter.post('/webhooks', (req: Request, res: Response) => {
  const payload = req.body as MetaWebhookLeadPayload;

  const sig = verifySignature(req);

  // Log the body FIRST and unconditionally — including rejected ones, which are the interesting
  // ones when debugging a misconfigured app secret.
  void metaCampaignService
    .logWebhook(sig.ok ? 'leadgen' : 'leadgen_rejected', payload)
    .then(async (logId) => {
      if (!sig.ok) {
        await metaCampaignService.markWebhookProcessed(logId, sig.reason ?? 'signature rejected');
        return;
      }
      // Processed after the response has already been sent. META retries any non-2xx, so a slow
      // Graph API call here would otherwise turn one form fill into a retry storm.
      const result = await metaCampaignService.processWebhookPayload(payload, logId);
      if (result.errors.length) {
        console.warn('[meta webhook] processed with errors', result.errors);
      }
    })
    .catch((e: unknown) => console.error('[meta webhook] logging failed', e));

  if (!sig.ok) {
    console.warn('[meta webhook] rejected:', sig.reason);
    return res.status(403).json({ success: false, message: sig.reason });
  }

  // ACK immediately. The raw body is durably logged, so nothing is lost by answering before work.
  return res.status(200).json({ success: true });
});

// ─────────────────────────── voice bot callback ───────────────────────────

metaCampaignRouter.post('/voice-callback', (req: Request, res: Response) => {
  const expected = process.env.VOICEBOT_CALLBACK_TOKEN ?? '';
  if (!expected) {
    return res.status(503).json({ success: false, message: 'VOICEBOT_CALLBACK_TOKEN is not configured' });
  }
  const supplied = String(req.header('x-voicebot-token') ?? req.body?.token ?? '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ success: false, message: 'invalid callback token' });
  }

  const referenceId = String(req.body?.reference_id ?? '');
  const status = String(req.body?.status ?? 'unknown');
  const outcome = req.body?.outcome ? String(req.body.outcome) : null;
  if (!referenceId) {
    return res.status(400).json({ success: false, message: 'reference_id is required' });
  }

  void recordVoiceCallback(referenceId, status, outcome)
    .then((matched) => {
      if (!matched) console.warn('[meta voice-callback] no lead matched reference_id', referenceId);
    })
    .catch((e: unknown) => console.error('[meta voice-callback] failed', e));

  return res.status(200).json({ success: true });
});

// ─────────────────────────── authenticated API ───────────────────────────

metaCampaignRouter.get(
  '/overview',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (_req, res) => {
    const data = await metaCampaignService.getOverview();
    return res.json({ success: true, data });
  })
);

metaCampaignRouter.get(
  '/config-status',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (_req, res) =>
    res.json({
      success: true,
      data: {
        metaApiConfigured: isMetaConfigured(),
        webhookVerifyTokenConfigured: Boolean(process.env.META_LEAD_VERIFY_TOKEN),
        webhookSignatureConfigured: Boolean(process.env.META_APP_SECRET),
        whatsappConfigured: Boolean(process.env.LOCAL_WHATSAPP_API_URL),
        voicebotConfigured: Boolean(process.env.VOICEBOT_TRIGGER_URL),
      },
    })
  )
);

metaCampaignRouter.get(
  '/campaigns',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const data = await metaCampaignService.listCampaigns({
      requisitionId: req.query.requisitionId as string | undefined,
      status: req.query.status as MetaCampaignStatus | undefined,
      search: req.query.search as string | undefined,
    });
    return res.json({ success: true, data });
  })
);

metaCampaignRouter.get(
  '/campaigns/:id',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const data = await metaCampaignService.getCampaign(req.params.id!);
    if (!data) return res.status(404).json({ success: false, message: 'Campaign not found' });
    return res.json({ success: true, data });
  })
);

metaCampaignRouter.get(
  '/campaigns/:id/funnel',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const data = await metaCampaignService.getCampaignFunnel(req.params.id!);
    if (!data) return res.status(404).json({ success: false, message: 'Campaign not found' });
    return res.json({ success: true, data });
  })
);

metaCampaignRouter.get(
  '/leads',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const data = await metaCampaignService.listLeads({
      campaignId: req.query.campaignId as string | undefined,
      requisitionId: req.query.requisitionId as string | undefined,
      screening: req.query.screening as string | undefined,
    });
    return res.json({ success: true, data });
  })
);

metaCampaignRouter.post(
  '/campaigns',
  requireAuth,
  requireRole(...CAMPAIGN_WRITE_ROLES),
  h(async (req, res) => {
    const { requisitionId, campaignName } = req.body ?? {};
    if (!requisitionId || !campaignName) {
      return res.status(400).json({ success: false, message: 'requisitionId and campaignName are required' });
    }
    const data = await metaCampaignService.createCampaign(req.body, req.authUser?.id ?? null);
    return res.status(201).json({ success: true, data });
  })
);

metaCampaignRouter.patch(
  '/campaigns/:id',
  requireAuth,
  requireRole(...CAMPAIGN_WRITE_ROLES),
  h(async (req, res) => {
    const data = await metaCampaignService.updateCampaign(req.params.id!, req.body ?? {});
    return res.json({ success: true, data });
  })
);

metaCampaignRouter.post(
  '/campaigns/:id/sync',
  requireAuth,
  requireRole(...CAMPAIGN_WRITE_ROLES),
  h(async (_req, res) => {
    const result = await metaCampaignService.syncAllCampaignMetrics();
    return res.json({ success: true, data: result });
  })
);

metaCampaignRouter.post(
  '/leads/:id/rescreen',
  requireAuth,
  requireRole(...CAMPAIGN_WRITE_ROLES),
  h(async (req, res) => {
    const data = await metaCampaignService.rescreenLead(req.params.id!);
    if (!data) return res.status(404).json({ success: false, message: 'Lead not found' });
    return res.json({ success: true, data });
  })
);

metaCampaignRouter.post(
  '/leads/:id/notify',
  requireAuth,
  requireRole(...CAMPAIGN_WRITE_ROLES),
  h(async (req, res) => {
    const data = await notifyQualifiedLead(req.params.id!, { force: req.body?.force === true });
    return res.json({ success: true, data });
  })
);

metaCampaignRouter.post(
  '/leads/:id/create-candidate',
  requireAuth,
  requireRole(...CAMPAIGN_WRITE_ROLES),
  h(async (req, res) => {
    const candidateId = await metaCampaignService.createCandidateFromLead(req.params.id!);
    if (!candidateId) {
      return res
        .status(422)
        .json({ success: false, message: 'Lead has no usable name/phone, so no candidate could be created' });
    }
    return res.json({ success: true, data: { candidateId } });
  })
);
