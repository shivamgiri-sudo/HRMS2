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
import { notifyQualifiedLead, recordVoiceCallback, recordWalkInConfirmation } from './lead-outreach.service.js';
import { leadVerifyToken, isMetaConfigured } from './meta-api.client.js';
import { parseVapiCallback, isVapiConfigured } from './vapi-voicebot.provider.js';
import type { VapiCallbackPayload } from './vapi-voicebot.provider.js';
import {
  isWassengerConfigured,
  parseWassengerWebhook,
  sendConfirmationAck,
  sendShortlistMessage,
} from './wassenger.provider.js';
import type { WassengerWebhookPayload } from './wassenger.provider.js';
import {
  saveMessage,
  getThread,
  getInbox,
  getTotalUnread,
  markThreadRead,
  notifyBranchHrOfInboundMessage,
} from './meta-messages.service.js';
import type { MetaCampaignStatus, MetaWebhookLeadPayload } from './meta-campaign.types.js';

export const metaCampaignRouter = Router();

/** Read access mirrors the requisition read roles — a campaign is a view onto a requisition. */
const CAMPAIGN_READ_ROLES = [
  'super_admin', 'admin', 'hr', 'recruitment_hr', 'branch_head', 'operations_manager',
  'process_manager', 'management', 'manager', 'assistant_manager', 'recruiter',
] as const;

/** Roles that see ALL branches (no auto-scoping). */
const ALL_BRANCH_ROLES = ['super_admin', 'admin', 'hr', 'management', 'manager'];

/**
 * Resolve the effective branchName filter for a request.
 * - ALL_BRANCH_ROLES: return whatever branchName the caller passed (may be undefined = show all)
 * - branch-scoped roles: look up the user's branch from their employee record and force it.
 */
async function resolvebranchScope(
  userId: string,
  role: string,
  callerBranch?: string
): Promise<string | undefined> {
  if (ALL_BRANCH_ROLES.includes(role)) return callerBranch;
  // Branch-scoped role: derive branch_name from employee → branch_master
  const { db } = await import('../../db/mysql.js');
  const [rows] = await db.execute<import('mysql2').RowDataPacket[]>(
    `SELECT bm.name AS branch_name
       FROM employees e
       JOIN branch_master bm ON bm.id = e.branch_id
      WHERE e.user_id = ? AND e.active_status = 1
      LIMIT 1`,
    [userId]
  );
  return (rows[0]?.branch_name as string | null) ?? callerBranch;
}

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

// ─────────────────────────── Vapi.ai voice bot callback ───────────────────────────

/**
 * Vapi.ai sends webhooks when calls complete. This endpoint:
 *   - Parses the call outcome (interested, not_interested, no_answer, etc.)
 *   - Updates the lead's voice_call_status and voice_call_outcome
 *   - Stores the transcript for review
 *
 * Vapi signs requests with HMAC, but for simplicity we also support a bearer token.
 */
metaCampaignRouter.post('/vapi-callback', (req: Request, res: Response) => {
  // Vapi can authenticate via HMAC or a simple secret header
  const expectedSecret = process.env.VAPI_CALLBACK_SECRET ?? process.env.VAPI_API_KEY ?? '';
  const suppliedSecret = String(
    req.header('x-vapi-secret') ?? req.header('authorization')?.replace('Bearer ', '') ?? ''
  );

  // If a secret is configured, verify it
  if (expectedSecret && suppliedSecret) {
    const a = Buffer.from(suppliedSecret);
    const b = Buffer.from(expectedSecret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('[vapi-callback] invalid secret');
      return res.status(403).json({ success: false, message: 'invalid callback secret' });
    }
  }

  const payload = req.body as VapiCallbackPayload;
  const parsed = parseVapiCallback(payload);

  if (!parsed.referenceId) {
    console.warn('[vapi-callback] no reference_id in payload', payload);
    return res.status(200).json({ success: true, message: 'no reference_id, ignored' });
  }

  // Map Vapi outcome to our status format
  const statusMap: Record<string, string> = {
    interested: 'completed_interested',
    not_interested: 'completed_not_interested',
    no_answer: 'no_answer',
    busy: 'busy',
    unknown: 'completed',
  };

  const outcomeText = parsed.summary
    ? `${parsed.outcome}: ${parsed.summary}`
    : `${parsed.outcome}${parsed.duration ? ` (${parsed.duration}s)` : ''}`;

  void recordVoiceCallback(
    parsed.referenceId,
    statusMap[parsed.outcome] ?? 'completed',
    outcomeText
  )
    .then((matched) => {
      if (!matched) {
        console.warn('[vapi-callback] no lead matched reference_id', parsed.referenceId);
      } else {
        console.log('[vapi-callback] recorded outcome', {
          referenceId: parsed.referenceId,
          outcome: parsed.outcome,
          duration: parsed.duration,
        });
      }
    })
    .catch((e: unknown) => console.error('[vapi-callback] failed', e));

  return res.status(200).json({ success: true });
});

// ─────────────────────────── Wassenger WhatsApp webhook ───────────────────────────

/**
 * Wassenger sends a POST here for every incoming WhatsApp message on the connected device.
 * We use it to capture walk-in confirmation replies (1 = confirm, 2 = reschedule, 3 = decline).
 *
 * Security: Wassenger supports a webhook secret header (X-Wassenger-Secret). If
 *   WASSENGER_WEBHOOK_SECRET is set we verify it; otherwise we accept all (suitable for private
 *   server without public exposure, but set the secret in production).
 */
metaCampaignRouter.post('/wassenger-webhook', (req: Request, res: Response) => {
  // Optional webhook secret check
  const webhookSecret = process.env.WASSENGER_WEBHOOK_SECRET ?? '';
  if (webhookSecret) {
    const supplied = String(req.header('x-wassenger-secret') ?? req.header('x-api-key') ?? '');
    const a = Buffer.from(supplied);
    const b = Buffer.from(webhookSecret);
    if (a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ success: false, message: 'invalid webhook secret' });
    }
  }

  if (!isWassengerConfigured()) {
    return res.status(503).json({ success: false, message: 'Wassenger not configured' });
  }

  const payload = req.body as WassengerWebhookPayload;
  const { isIncoming, phone, reply, rawBody } = parseWassengerWebhook(payload);

  if (!isIncoming || !phone) {
    // Not an incoming candidate message — ack and ignore
    return res.status(200).json({ success: true, action: 'ignored' });
  }

  // Fire-and-forget — must return 200 fast for Wassenger
  void (async () => {
    try {
      const messageText = rawBody ?? (reply === 'confirmed' ? '1' : reply === 'reschedule' ? '2' : reply === 'not_interested' ? '3' : '');
      if (!messageText) return;

      // Always find the lead first (needed for both unknown questions and walk-in replies)
      const result = await recordWalkInConfirmation(phone, reply);
      if (!result.found || !result.leadId) {
        console.warn('[wassenger-webhook] no matching lead for phone', phone);
        return;
      }

      // Persist the inbound message in the thread
      await saveMessage({
        leadId: result.leadId,
        direction: 'inbound',
        messageText,
        senderType: 'candidate',
        wassengerMessageId: payload.data?.id ?? null,
      });

      if (reply === 'unknown') {
        // Freeform message / question — notify Branch HR to respond
        await notifyBranchHrOfInboundMessage(result.leadId, result.name, messageText);
      } else if (result.name) {
        // Walk-in reply — send auto-ack to candidate
        await sendConfirmationAck(phone, reply, result.name);
      }

      console.log('[wassenger-webhook] processed', { phone, reply, leadId: result.leadId });
    } catch (e: unknown) {
      console.error('[wassenger-webhook] failed', e instanceof Error ? e.message : e);
    }
  })();

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
        wassengerConfigured: isWassengerConfigured(),
        whatsappWebConfigured: Boolean(process.env.ENABLE_WHATSAPP_WEB),
        voicebotConfigured: Boolean(process.env.VOICEBOT_TRIGGER_URL),
        vapiConfigured: isVapiConfigured(),
      },
    })
  )
);

metaCampaignRouter.get(
  '/filter-options',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (_req, res) => {
    const data = await metaCampaignService.getFilterOptions();
    return res.json({ success: true, data });
  })
);

metaCampaignRouter.get(
  '/campaigns',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const ar = req as AuthenticatedRequest;
    const branchName = await resolvebranchScope(
      ar.authUser.id,
      ar.authUser.role ?? '',
      req.query.branchName as string | undefined
    );
    const data = await metaCampaignService.listCampaigns({
      requisitionId: req.query.requisitionId as string | undefined,
      status: req.query.status as MetaCampaignStatus | undefined,
      search: req.query.search as string | undefined,
      branchName,
      processName: req.query.processName as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
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

/**
 * All leads across every campaign, paginated — backs the standalone All Leads page.
 *
 * Kept separate from /leads (which the campaign drawer uses, capped at 500) because this one
 * returns a { rows, total } envelope for the pager and joins requisition/campaign so each row can
 * name its source. Read roles, same as every other campaign read.
 */
metaCampaignRouter.get(
  '/leads-all',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const ar = req as AuthenticatedRequest;
    const branchName = await resolvebranchScope(
      ar.authUser.id,
      ar.authUser.role ?? '',
      req.query.branchName as string | undefined
    );
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const data = await metaCampaignService.listAllLeads({
      search: req.query.search as string | undefined,
      screening: req.query.screening as string | undefined,
      requisitionId: req.query.requisitionId as string | undefined,
      branchName,
      processName: req.query.processName as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return res.json({ success: true, data: data.rows, total: data.total });
  })
);

/** One lead with its full raw form answers — backs the All Leads drill-down drawer. */
metaCampaignRouter.get(
  '/leads/:id',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const data = await metaCampaignService.getLeadDetail(req.params.id!);
    if (!data) return res.status(404).json({ success: false, message: 'Lead not found' });
    return res.json({ success: true, data });
  })
);

/** Lead Gen forms on a Page, for discovery when linking a form to a requisition. */
metaCampaignRouter.get(
  '/page-forms/:pageId',
  requireAuth,
  requireRole(...CAMPAIGN_WRITE_ROLES),
  h(async (req, res) => {
    if (!isMetaConfigured()) {
      return res.status(503).json({ success: false, message: 'META Graph API token is not configured' });
    }
    const data = await metaCampaignService.listPageForms(req.params.pageId!);
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

/**
 * Import a campaign's historical leads from META (leads submitted before the webhook existed).
 *
 * Outreach is suppressed inside backfillFormLeads — this can pull months of leads and must never
 * message anyone retroactively. Idempotent: re-running only imports leads not already stored.
 */
metaCampaignRouter.post(
  '/campaigns/:id/backfill',
  requireAuth,
  requireRole(...CAMPAIGN_WRITE_ROLES),
  h(async (req, res) => {
    if (!isMetaConfigured()) {
      return res.status(503).json({ success: false, message: 'META Graph API token is not configured' });
    }
    const campaign = await metaCampaignService.getCampaign(req.params.id!);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    if (!campaign.metaFormId) {
      return res.status(422).json({ success: false, message: 'This campaign has no Lead Gen Form ID linked, so there is nothing to import.' });
    }
    const result = await metaCampaignService.backfillFormLeads(campaign.metaFormId);
    return res.json({ success: true, data: result });
  })
);

/** Import historical leads for every linked form at once. Super admin / HR only. */
metaCampaignRouter.post(
  '/backfill-all',
  requireAuth,
  requireRole(...CAMPAIGN_WRITE_ROLES),
  h(async (_req, res) => {
    if (!isMetaConfigured()) {
      return res.status(503).json({ success: false, message: 'META Graph API token is not configured' });
    }
    const result = await metaCampaignService.backfillAllLinkedForms();
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

// ─────────────────────────── WhatsApp Inbox ───────────────────────────

/** Conversation list — branch-scoped for Branch HR, all branches for admin/hr. */
metaCampaignRouter.get(
  '/inbox',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const data = await getInbox({
      userId: req.authUser!.id,
      userRole: req.authUser!.role ?? '',
      search: req.query.search as string | undefined,
    });
    return res.json({ success: true, data });
  })
);

/** Unread count badge for the nav. */
metaCampaignRouter.get(
  '/inbox/unread-count',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const count = await getTotalUnread({
      userId: req.authUser!.id,
      userRole: req.authUser!.role ?? '',
    });
    return res.json({ success: true, data: { count } });
  })
);

/** Full message thread for one lead. */
metaCampaignRouter.get(
  '/leads/:id/messages',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const messages = await getThread(req.params.id!);
    return res.json({ success: true, data: messages });
  })
);

/** Mark all inbound messages in a thread as read. */
metaCampaignRouter.patch(
  '/leads/:id/messages/read',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    await markThreadRead(req.params.id!);
    return res.json({ success: true });
  })
);

/**
 * Branch HR replies to a candidate from the HRMS inbox.
 * Sends via Wassenger and persists as an outbound message.
 */
metaCampaignRouter.post(
  '/leads/:id/reply',
  requireAuth,
  requireRole(...CAMPAIGN_READ_ROLES),
  h(async (req, res) => {
    const text = String(req.body?.message ?? '').trim();
    if (!text) {
      return res.status(400).json({ success: false, message: 'message is required' });
    }
    if (!isWassengerConfigured()) {
      return res.status(503).json({ success: false, message: 'Wassenger is not configured' });
    }

    // Load the lead to get phone + name
    const lead = await metaCampaignService.getLeadDetail(req.params.id!);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (!lead.parsedPhone) {
      return res.status(422).json({ success: false, message: 'Lead has no phone number' });
    }

    // Send the custom reply text directly via Wassenger REST (not the template)
    const axios = (await import('axios')).default;
    let wassengerMsgId: string | null = null;
    try {
      const { data } = await axios.post(
        'https://api.wassenger.com/v1/messages',
        {
          phone: lead.parsedPhone.replace(/\D/g, '').replace(/^(.{10})$/, '91$1'),
          message: text,
          device: process.env.WASSENGER_DEVICE_ID,
        },
        {
          headers: { 'Content-Type': 'application/json', Token: process.env.WASSENGER_API_TOKEN ?? '' },
          timeout: 15000,
        }
      );
      wassengerMsgId = data?.id ?? null;
    } catch (err) {
      const errMsg = (err instanceof Error) ? err.message : String(err);
      return res.status(502).json({ success: false, message: `Wassenger send failed: ${errMsg}` });
    }

    // Persist as outbound message from HR
    const msgId = await saveMessage({
      leadId: req.params.id!,
      direction: 'outbound',
      messageText: text,
      senderType: 'hr',
      senderId: req.authUser!.id,
      senderName: req.authUser!.email ?? null,
      wassengerMessageId: wassengerMsgId,
    });

    return res.json({ success: true, data: { messageId: msgId } });
  })
);
