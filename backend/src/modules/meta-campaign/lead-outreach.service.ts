/**
 * Multi-channel outreach for a QUALIFIED META lead — WhatsApp, email, then voice bot.
 *
 * Three rules govern this file.
 *
 * 1. Only qualified leads are contacted. The screening gate is re-checked here against the stored
 *    row rather than trusted from the caller, because this is also reachable from a manual
 *    "notify" action in the UI and an accidental blast to disqualified leads is not recallable.
 *
 * 2. Every channel is independently optional and independently reported. WhatsApp goes through the
 *    existing provider factory (`LocalWhatsAppProvider`, the self-hosted `/wa` bridge) which now
 *    reports isConfigured(), so an unconfigured channel is SKIPPED, not attempted-and-failed. Per
 *    communication/providers/provider.interface.ts, uncredentialed attempts are how WhatsApp
 *    accumulated ~903 failures and 0 successes on production; this refuses to add to that.
 *
 * 3. notification_channels records what actually succeeded, not what was intended. A recruiter
 *    looking at a lead needs to know the candidate was genuinely reached, and
 *    notification_sent_at is only stamped when at least one channel succeeded — otherwise the
 *    funnel's "Notified" count would silently overstate contact.
 *
 * Messages are bilingual (Hindi + English in one body). A single bilingual message is deliberate
 * rather than a language-detection branch: we have no reliable language signal from a Lead Gen
 * form, and guessing wrong is worse than sending both.
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { providerFactory } from '../communication/providers/provider.factory.js';
import { providerConfigService } from '../communication/provider-config.service.js';
import { PinbotWhatsAppProvider } from '../communication/providers/whatsapp/pinbot.provider.js';
import { emailService } from '../communication/email.service.js';
import { triggerVoiceCall, isVoicebotConfigured } from './voicebot.provider.js';
import { triggerVapiCallWithInlineScript, isVapiConfigured } from './vapi-voicebot.provider.js';
import { sendWhatsAppNotification, isWhatsAppWebConfigured } from './whatsapp-web.provider.js';
import { sendShortlistMessage, isWassengerConfigured } from './wassenger.provider.js';
import { saveMessage as saveLeadMessage } from './meta-messages.service.js';
import { locationVerdict } from '../hiring-engine/he-location-match.js';
import { metaOutreachBlockedByEngine } from '../hiring-engine/he-campaign-config.service.js';
import { assignInterviewSlot } from './interview-slot.service.js';
import type { InterviewSlot } from './interview-slot.service.js';
import { requisitionClosedReason } from './lead-screener.service.js';
import { followupEnrolled, personOptedOut } from '../hiring-engine/qualified-followup.service.js';
import { pipelineOwnsSends } from '../hiring-engine/qualified-followup.policy.js';
import { normaliseMobile10 } from '../hiring-engine/qualified-followup.schedule.js';
import { buildLegacyInviteEmail, buildMapsLink, buildSalaryString, type LeadContext } from './lead-outreach-email.js';
import { legacyButtonsOn, loadEmailButtonSwitches, replyToFor } from '../hiring-engine/email-buttons.policy.js';
import { inviteLinkFor, newInviteToken, type InviteLink, type InviteSourcePath } from '../hiring-engine/walkin-invite.service.js';

export interface OutreachOutcome {
  leadId: string;
  attempted: string[];
  succeeded: string[];
  skipped: Array<{ channel: string; reason: string }>;
  failed: Array<{ channel: string; error: string }>;
}

// Pinbot (WABA) is the sole WhatsApp channel for candidate outreach when configured: a candidate we have
// never messaged can only be reached with an approved template, so no free-text fallback is attempted.
const pinbotInvite = new PinbotWhatsAppProvider();


function buildWhatsAppBody(ctx: LeadContext, slot?: InterviewSlot): string {
  const role = ctx.designation ?? 'a position';
  const firstName = ctx.name.split(' ')[0];
  const mapsLink = buildMapsLink(ctx);
  const salary = buildSalaryString(ctx);

  let body = `Hi ${firstName}! 🎉\n\n`;
  body += `Congratulations! Your profile has been shortlisted for the *${role}* position at *Mas Callnet India Pvt. Ltd.*\n\n`;

  if (ctx.bmiUrl) {
    body += `To proceed, please complete your assessment and confirm your interview slot:\n👉 ${ctx.bmiUrl}\n\n`;
  }

  if (slot) {
    body += `📅 Date: ${slot.dateLabel}\n`;
    body += `🕒 Time: ${slot.timeLabel}\n`;
  }

  if (ctx.branchCity || ctx.branch) {
    body += `📍 Location: ${ctx.branchCity ?? ctx.branch}\n`;
  }

  if (ctx.branchAddress) {
    body += `🏢 Full Address: ${ctx.branchAddress.replace(/\n/g, ', ')}\n`;
  }

  if (mapsLink) {
    body += `🗺️ Google Maps: ${mapsLink}\n`;
  }

  body += `💼 Role: ${role}\n`;

  if (salary) {
    body += `💰 Salary: ${salary}\n`;
  }

  body += `\nWe recommend completing the process at the earliest to avoid missing your opportunity.\n`;
  body += `Looking forward to speaking with you!\n\n— Mas Callnet HR Team\nhttps://www.mascallnet.ai`;

  return body;
}

async function loadLeadContext(
  leadId: string
): Promise<{ ctx: LeadContext; qualified: boolean; alreadySent: boolean; closedReason: string | null; locationText: string; branchState: string | null } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ml.id, ml.parsed_name, ml.parsed_phone, ml.parsed_email,
            ml.screening_result, ml.notification_sent_at, ml.requisition_id, ml.campaign_id,
            jr.designation_name, jr.branch_name, jr.requisition_code, jr.bmi_assessment_url,
            jr.salary_min, jr.salary_max,
            jr.approval_status, jr.active_status, jr.closed_at,
            jr.requested_headcount, jr.fulfilled_headcount,
            ml.parsed_location, ac.current_address, ac.permanent_address, bm.state AS branch_state,
            bm.address AS branch_address, bm.city AS branch_city,
            bm.latitude AS branch_lat, bm.longitude AS branch_lng
       FROM meta_lead_raw ml
       LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
       LEFT JOIN ats_candidate ac ON ac.id = ml.ats_candidate_id
      WHERE ml.id = ? LIMIT 1`,
    [leadId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ctx: {
      id: String(row.id),
      name: (row.parsed_name as string | null) ?? 'Candidate',
      phone: (row.parsed_phone as string | null) ?? null,
      email: (row.parsed_email as string | null) ?? null,
      designation: (row.designation_name as string | null) ?? null,
      branch: (row.branch_name as string | null) ?? null,
      requisitionCode: (row.requisition_code as string | null) ?? null,
      bmiUrl: (row.bmi_assessment_url as string | null) ?? null,
      branchAddress: (row.branch_address as string | null) ?? null,
      branchCity: (row.branch_city as string | null) ?? null,
      branchLat: row.branch_lat !== null ? Number(row.branch_lat) : null,
      branchLng: row.branch_lng !== null ? Number(row.branch_lng) : null,
      salaryMin: row.salary_min !== null ? Number(row.salary_min) : null,
      salaryMax: row.salary_max !== null ? Number(row.salary_max) : null,
      requisitionId: (row.requisition_id as string | null) ?? null,
      campaignId: (row.campaign_id as string | null) ?? null,
    },
    qualified: row.screening_result === 'qualified',
    locationText: [row.parsed_location, row.current_address, row.permanent_address].filter(Boolean).join(' '),
    branchState: (row.branch_state as string | null) ?? null,
    alreadySent: Boolean(row.notification_sent_at),
    closedReason: requisitionClosedReason({
      approvalStatus: (row.approval_status as string | null) ?? null,
      activeStatus: (row.active_status as number | null) ?? null,
      closedAt: (row.closed_at as string | null) ?? null,
      requestedHeadcount: row.requested_headcount !== null ? Number(row.requested_headcount) : null,
      fulfilledHeadcount: row.fulfilled_headcount !== null ? Number(row.fulfilled_headcount) : null,
    }),
  };
}

/**
 * Build the WhatsApp message preview for a lead without sending.
 * Returns the rendered message body + key context fields for the HR preview dialog.
 */
export async function buildNotifyPreview(leadId: string): Promise<{
  found: boolean;
  qualified: boolean;
  alreadySent: boolean;
  candidateName: string | null;
  phone: string | null;
  designation: string | null;
  branch: string | null;
  branchCity: string | null;
  branchAddress: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  mapsLink: string;
  messageBody: string;
} | null> {
  const loaded = await loadLeadContext(leadId);
  if (!loaded) return null;
  const { ctx } = loaded;
  const mapsLink = buildMapsLink(ctx);
  const messageBody = buildWhatsAppBody(ctx);
  return {
    found: true,
    qualified: loaded.qualified,
    alreadySent: loaded.alreadySent,
    candidateName: ctx.name,
    phone: ctx.phone,
    designation: ctx.designation,
    branch: ctx.branch,
    branchCity: ctx.branchCity,
    branchAddress: ctx.branchAddress,
    salaryMin: ctx.salaryMin,
    salaryMax: ctx.salaryMax,
    mapsLink,
    messageBody,
  };
}

export async function notifyQualifiedLead(
  leadId: string,
  options: { force?: boolean; skipVoice?: boolean; sourcePath?: InviteSourcePath } = {}
): Promise<OutreachOutcome> {
  const outcome: OutreachOutcome = { leadId, attempted: [], succeeded: [], skipped: [], failed: [] };

  const loaded = await loadLeadContext(leadId);
  if (!loaded) {
    outcome.skipped.push({ channel: 'all', reason: 'Lead not found' });
    return outcome;
  }
  if (!loaded.qualified) {
    outcome.skipped.push({ channel: 'all', reason: 'Lead is not qualified; outreach refused' });
    return outcome;
  }
  // STOP is honoured in every mode and force does not override it. A lookup error fails open unless the pipeline owns sends (then it fails closed).
  const mobile10 = normaliseMobile10(loaded.ctx.phone);
  if (mobile10) {
    let stop = false;
    try { stop = await personOptedOut(mobile10); } catch (e) {
      if (pipelineOwnsSends()) {
        outcome.skipped.push({ channel: 'all', reason: 'Opt-out lookup failed; pipeline owns sends' });
        return outcome;
      }
      console.warn('[meta] opt-out lookup failed', e instanceof Error ? e.message : e);
    }
    if (stop) {
      outcome.skipped.push({ channel: 'all', reason: 'Candidate opted out (STOP)' });
      return outcome;
    }
  }
  // Live follow-up pipeline owns the sends for an enrolled lead (live and not test mode only). Fails closed: the sync retries next run
  // because notification_sent_at stays NULL.
  if (!options.force && pipelineOwnsSends()) {
    try {
      if (await followupEnrolled(leadId)) {
        outcome.skipped.push({ channel: 'all', reason: 'Handled by the follow-up pipeline' });
        return outcome;
      }
    } catch {
      outcome.skipped.push({ channel: 'all', reason: 'Follow-up lookup failed; pipeline owns sends' });
      return outcome;
    }
  }
  // One owner per lead: a campaign handed to the Hiring Engine, or a person the Hiring Engine already contacted, is not messaged from here
  // (the Hiring Engine does email, WhatsApp, bot call, reminders and no-show follow-up with its own guards). Fails open: a lookup error must not stop outreach.
  if (!options.force) {
    const blocked = await metaOutreachBlockedByEngine(leadId).catch(() => null);
    if (blocked) {
      outcome.skipped.push({ channel: 'all', reason: blocked });
      return outcome;
    }
  }
  // Shortlisting is against the batch requisition: a closed or fully-staffed batch cannot take
  // more candidates, so refuse outreach outright (force does not override this).
  if (loaded.closedReason) {
    outcome.skipped.push({ channel: 'all', reason: `Outreach refused: ${loaded.closedReason}` });
    return outcome;
  }
  // Location: a lead whose own answer says they are elsewhere ("Gujarat" for a Noida branch, "No Noida location") is not invited to walk in. An answer that
  // names no known place (a neighbourhood) or no answer at all passes: the Meta ad is already geo-targeted. A recruiter's explicit force overrides.
  if (!options.force && loaded.ctx.branch) {
    const v = locationVerdict(loaded.locationText, loaded.ctx.branch, loaded.ctx.branchCity, loaded.branchState);
    if (v === 'elsewhere') {
      outcome.skipped.push({ channel: 'all', reason: `Outreach refused: the lead's location ("${loaded.locationText.slice(0, 60)}") is outside the ${loaded.ctx.branch} area` });
      return outcome;
    }
  }
  // Re-notifying is a real recruiter need, but it must be explicit. Without this guard a webhook
  // redelivery or a page refresh could message the same candidate repeatedly.
  if (loaded.alreadySent && !options.force) {
    outcome.skipped.push({ channel: 'all', reason: 'Already notified; pass force=true to re-send' });
    return outcome;
  }

  const { ctx } = loaded;

  // ── Assign interview slot ──
  // Assign before outreach so slot is in both email and WhatsApp.
  let slot: InterviewSlot | undefined;
  if (ctx.branch) {
    slot = await assignInterviewSlot(ctx.id, ctx.branch).catch((e: unknown) => {
      console.warn('[meta] assignInterviewSlot failed', e instanceof Error ? e.message : e);
      return undefined;
    });
  }

  // ── WhatsApp ──
  if (!ctx.phone) {
    outcome.skipped.push({ channel: 'whatsapp', reason: 'Lead has no phone number' });
  } else if (pinbotInvite.isConfigured()) {
    if (!slot || !ctx.branchAddress || !ctx.bmiUrl) {
      outcome.skipped.push({
        channel: 'whatsapp',
        reason: 'Approved invite template needs interview slot, branch address and BookMyInterview link',
      });
    } else {
      outcome.attempted.push('whatsapp');
      const res = await pinbotInvite.sendTemplate(
        ctx.phone,
        process.env.PINBOT_INTERVIEW_TEMPLATE || 'interview_invitation',
        [ctx.name, slot.dateLabel, slot.timeLabel, ctx.branchAddress, ctx.bmiUrl],
      );
      if (res.success) outcome.succeeded.push('whatsapp');
      else outcome.failed.push({ channel: 'whatsapp', error: res.error ?? 'unknown error' });
    }
  } else {
    try {
      // DB config first, env second — same resolution order as dispatch.service.ts, so a provider
      // switched in the admin panel takes effect here too instead of this path quietly using env.
      const dbConfig = await providerConfigService.loadActiveConfig('whatsapp');
      const provider = await providerFactory.getProviderAsync('whatsapp', dbConfig);
      const configured = typeof provider.isConfigured === 'function' ? provider.isConfigured() : true;
      if (!configured) {
        outcome.skipped.push({ channel: 'whatsapp', reason: `${provider.getName()} has no credentials configured` });
      } else {
        outcome.attempted.push('whatsapp');
        const res = await provider.send(ctx.phone, 'Shortlisted', buildWhatsAppBody(ctx, slot));
        if (res.success) outcome.succeeded.push('whatsapp');
        else outcome.failed.push({ channel: 'whatsapp', error: res.error ?? 'unknown error' });
      }
    } catch (err) {
      outcome.failed.push({ channel: 'whatsapp', error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Email ──
  if (!ctx.email) {
    outcome.skipped.push({ channel: 'email', reason: 'Lead has no email address' });
  } else if (!emailService.isConfigured()) {
    outcome.skipped.push({ channel: 'email', reason: 'Email provider is not configured' });
  } else {
    outcome.attempted.push('email');
    // Answer buttons (switch per path, default off): the token is chosen before the send and the invite row is written only after a
    // successful send. A person who already has an he_match answers on that match's token (no invite row).
    const inviteInput = slot && mobile10 && ctx.requisitionId
      ? { mobile10, requisitionId: ctx.requisitionId, metaLeadId: ctx.id, campaignId: ctx.campaignId ?? null, branchName: ctx.branch,
          slotAt: `${slot.date} ${slot.time}`.slice(0, 19), sourcePath: options.sourcePath ?? 'legacy_meta' as InviteSourcePath, now: new Date() }
      : null;
    let link: InviteLink | null = null;
    const token = newInviteToken();
    if (inviteInput && legacyButtonsOn(await loadEmailButtonSwitches(), { campaignId: ctx.campaignId ?? null, metaLeadId: ctx.id })) {
      link = await inviteLinkFor(inviteInput, { simulate: true, token }).catch((e: unknown) => {
        console.warn('[meta] answer link failed, sending without buttons', e instanceof Error ? e.message : e);
        return null;
      });
    }
    try {
      const mail = buildLegacyInviteEmail(ctx, slot, link, { stopLink: true });
      const replyTo = replyToFor(link?.token ?? null);
      await emailService.send({
        to: ctx.email,
        subject: mail.subject,
        html: mail.html,
        ...(mail.text ? { text: mail.text } : {}),
        ...(replyTo ? { replyTo } : {}),
      });
      outcome.succeeded.push('email');
      if (link?.kind === 'invite' && inviteInput) {
        await inviteLinkFor(inviteInput, { token: link.token }).catch((e: unknown) =>
          console.warn('[meta] invite record failed after send', e instanceof Error ? e.message : e));
      }
    } catch (err) {
      outcome.failed.push({ channel: 'email', error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Wassenger WhatsApp fallback (hosted, preferred) ──
  // If the primary provider failed/unconfigured, use Wassenger hosted gateway.
  // Wassenger is preferred over self-hosted whatsapp-web.js — no puppeteer, no QR on server,
  // and it supports inbound message webhooks for walk-in confirmation replies.
  if (
    ctx.phone &&
    !pinbotInvite.isConfigured() &&
    !outcome.succeeded.includes('whatsapp') &&
    isWassengerConfigured()
  ) {
    outcome.attempted.push('whatsapp_wassenger');
    try {
      // Use the full interview message (with slot + address + maps) when we have it;
      // fall back to the legacy bilingual message when slot assignment failed.
      const waBody = slot || ctx.branchAddress
        ? buildWhatsAppBody(ctx, slot)
        : null;
      const res = waBody
        ? await (async () => {
            const { sendCustomMessage } = await import('./wassenger.provider.js');
            return sendCustomMessage(ctx.phone!, waBody);
          })()
        : await sendShortlistMessage(ctx.phone, ctx.name, ctx.designation, ctx.branch, ctx.id);

      if (res.success) {
        outcome.succeeded.push('whatsapp_wassenger');
        // Save the actual message text as an outbound HR message so it renders
        // as a green bubble in the inbox, not a system notification pill.
        const sentText = waBody ?? `Hi ${ctx.name.split(' ')[0]}! Your profile has been shortlisted for ${ctx.designation ?? 'a position'} at Mas Callnet India Pvt. Ltd. Please visit our office for interview. — Mas Callnet HR Team`;
        await saveLeadMessage({
          leadId: ctx.id,
          direction: 'outbound',
          messageText: sentText,
          senderType: 'hr',
          senderName: 'HR Team',
          wassengerMessageId: res.messageId ?? null,
        }).catch(() => { /* best-effort */ });
      } else {
        outcome.failed.push({ channel: 'whatsapp_wassenger', error: res.error ?? 'unknown error' });
      }
    } catch (err) {
      outcome.failed.push({ channel: 'whatsapp_wassenger', error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── WhatsApp Web fallback (self-hosted, last resort) ──
  // If neither primary nor Wassenger worked, try the self-hosted whatsapp-web.js session.
  if (
    ctx.phone &&
    !pinbotInvite.isConfigured() &&
    !outcome.succeeded.includes('whatsapp') &&
    !outcome.succeeded.includes('whatsapp_wassenger') &&
    isWhatsAppWebConfigured()
  ) {
    outcome.attempted.push('whatsapp_web');
    try {
      const res = await sendWhatsAppNotification(
        ctx.phone,
        ctx.name,
        ctx.designation,
        ctx.branch,
        ctx.id
      );
      if (res.success) {
        outcome.succeeded.push('whatsapp_web');
      } else {
        outcome.failed.push({ channel: 'whatsapp_web', error: res.error ?? 'unknown error' });
      }
    } catch (err) {
      outcome.failed.push({ channel: 'whatsapp_web', error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Voice bot ──
  // Fires AFTER the text channels: a candidate who gets a call with no prior written context
  // is far more likely to treat it as spam. Priority: Vapi.ai (AI conversation, Hindi/English)
  // → legacy VOICEBOT_TRIGGER_URL (simple HTTP trigger).
  if (options.skipVoice) {
    outcome.skipped.push({ channel: 'voice', reason: 'Voice call skipped by caller (bulk send)' });
  } else if (!ctx.phone) {
    outcome.skipped.push({ channel: 'voice', reason: 'Lead has no phone number' });
  } else if (isVapiConfigured()) {
    outcome.attempted.push('voice');
    const res = await triggerVapiCallWithInlineScript({
      phone: ctx.phone,
      name: ctx.name,
      designation: ctx.designation,
      branch: ctx.branch,
      referenceId: ctx.id,
    });
    if (res.status === 'triggered') {
      outcome.succeeded.push('voice');
      await db.execute(
        `UPDATE meta_lead_raw SET voice_call_status = 'triggered', voice_called_at = NOW() WHERE id = ?`,
        [ctx.id]
      );
    } else {
      outcome.failed.push({ channel: 'voice', error: res.detail ?? res.status });
      await db.execute(
        `UPDATE meta_lead_raw SET voice_call_status = ?, voice_call_outcome = ? WHERE id = ?`,
        [res.status, res.detail, ctx.id]
      );
    }
  } else if (isVoicebotConfigured()) {
    outcome.attempted.push('voice');
    const res = await triggerVoiceCall({ phone: ctx.phone, name: ctx.name, referenceId: ctx.id });
    if (res.status === 'triggered') {
      outcome.succeeded.push('voice');
      await db.execute(
        `UPDATE meta_lead_raw SET voice_call_status = 'triggered', voice_called_at = NOW() WHERE id = ?`,
        [ctx.id]
      );
    } else {
      outcome.failed.push({ channel: 'voice', error: res.detail ?? res.status });
      await db.execute(
        `UPDATE meta_lead_raw SET voice_call_status = ?, voice_call_outcome = ? WHERE id = ?`,
        [res.status, res.detail, ctx.id]
      );
    }
  } else {
    outcome.skipped.push({ channel: 'voice', reason: 'No voice provider configured (VAPI_API_KEY or VOICEBOT_TRIGGER_URL)' });
  }

  // Only stamp notification_sent_at when a channel genuinely landed. The dashboard's "Notified"
  // stage counts this column, so stamping on attempt would overstate contact.
  if (outcome.succeeded.length > 0) {
    await db.execute(
      `UPDATE meta_lead_raw SET notification_sent_at = NOW(), notification_channels = ? WHERE id = ?`,
      [JSON.stringify(outcome.succeeded), ctx.id]
    );
  }

  return outcome;
}

/**
 * Record a walk-in confirmation reply received via WhatsApp (Wassenger webhook).
 *
 * Looks up the lead by phone, updates walkin_confirmed column (or notes reschedule/not_interested).
 * Returns true if a lead was found and updated.
 */
export async function recordWalkInConfirmation(
  phone: string,
  reply: 'confirmed' | 'reschedule' | 'not_interested' | 'unknown'
): Promise<{ found: boolean; leadId: string | null; name: string | null }> {
  // Normalise phone: strip country code prefix and non-digits, keep 10-digit Indian mobile
  const digits = phone.replace(/\D/g, '');
  const mobile = digits.length > 10 ? digits.slice(-10) : digits;

  // A phone can appear on several leads (one per campaign). Route the reply to the conversation
  // that is actually live: shortlisted first, then the one we messaged most recently — not merely
  // the newest row, which split a candidate's thread across leads.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, parsed_name FROM meta_lead_raw
      WHERE RIGHT(REPLACE(parsed_phone, '+', ''), 10) = ?
      ORDER BY (screening_result = 'qualified') DESC,
               (notification_sent_at IS NOT NULL) DESC,
               COALESCE(notification_sent_at, created_at) DESC
      LIMIT 1`,
    [mobile]
  );

  const row = rows[0];
  if (!row) return { found: false, leadId: null, name: null };

  const statusCol =
    reply === 'confirmed' ? 'walkin_confirmed'
    : reply === 'reschedule' ? 'walkin_reschedule_requested'
    : reply === 'not_interested' ? 'walkin_declined'
    : null;

  if (statusCol) {
    await db.execute(
      `UPDATE meta_lead_raw SET ${statusCol} = 1, walkin_reply_at = NOW(), walkin_reply = ? WHERE id = ?`,
      [reply, row.id]
    );
  }

  return { found: true, leadId: String(row.id), name: (row.parsed_name as string | null) ?? 'Candidate' };
}

/** Record a voice-bot callback outcome against the lead it referenced. */
export async function recordVoiceCallback(referenceId: string, status: string, outcomeText: string | null): Promise<boolean> {
  const [res] = await db.execute(
    `UPDATE meta_lead_raw
        SET voice_call_status = ?, voice_call_outcome = ?, voice_called_at = COALESCE(voice_called_at, NOW())
      WHERE id = ?`,
    [status.slice(0, 50), outcomeText, referenceId]
  );
  return (res as { affectedRows?: number }).affectedRows === 1;
}
