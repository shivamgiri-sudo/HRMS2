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
import { emailService } from '../communication/email.service.js';
import { triggerVoiceCall, isVoicebotConfigured } from './voicebot.provider.js';
import { triggerVapiCallWithInlineScript, isVapiConfigured } from './vapi-voicebot.provider.js';
import { sendWhatsAppNotification, isWhatsAppWebConfigured } from './whatsapp-web.provider.js';
import { sendShortlistMessage, isWassengerConfigured } from './wassenger.provider.js';
import { saveMessage as saveLeadMessage } from './meta-messages.service.js';
import { assignInterviewSlot } from './interview-slot.service.js';
import type { InterviewSlot } from './interview-slot.service.js';
import { requisitionClosedReason } from './lead-screener.service.js';

export interface OutreachOutcome {
  leadId: string;
  attempted: string[];
  succeeded: string[];
  skipped: Array<{ channel: string; reason: string }>;
  failed: Array<{ channel: string; error: string }>;
}

interface LeadContext {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  designation: string | null;
  branch: string | null;
  requisitionCode: string | null;
  bmiUrl: string | null;
  // Branch details loaded from branch_master
  branchAddress: string | null;
  branchCity: string | null;
  branchLat: number | null;
  branchLng: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
}

function buildMapsLink(ctx: LeadContext): string {
  if (ctx.branchLat && ctx.branchLng) {
    return `https://maps.google.com/?q=${ctx.branchLat},${ctx.branchLng}`;
  }
  if (ctx.branchAddress) {
    return `https://maps.google.com/?q=${encodeURIComponent(ctx.branchAddress)}`;
  }
  return '';
}

function buildSalaryString(ctx: LeadContext): string {
  if (ctx.salaryMin && ctx.salaryMax) {
    return `₹${ctx.salaryMin.toLocaleString('en-IN')} – ₹${ctx.salaryMax.toLocaleString('en-IN')} per month`;
  }
  if (ctx.salaryMin) return `₹${ctx.salaryMin.toLocaleString('en-IN')} per month`;
  return '';
}

function buildWhatsAppBody(ctx: LeadContext, slot?: InterviewSlot): string {
  const role = ctx.designation ?? 'a position';
  const firstName = ctx.name.split(' ')[0];
  const mapsLink = buildMapsLink(ctx);
  const salary = buildSalaryString(ctx);

  let body = `Hi ${firstName}! 🎉\n\n`;
  body += `Congratulations! Your profile has been shortlisted for the *${role}* position at *Mas Callnet India Pvt. Ltd.*\n\n`;

  if (ctx.bmiUrl) {
    body += `👉 *Complete Assessment & Confirm Interview:*\n${ctx.bmiUrl}\n\n`;
  }

  if (slot) {
    body += `📅 Interview Date: ${slot.dateLabel}\n`;
    body += `🕒 Interview Time: ${slot.timeLabel}\n`;
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

function buildEmailHtml(ctx: LeadContext, slot?: InterviewSlot): string {
  const esc = (v: string | null) =>
    (v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const role = esc(ctx.designation) || 'a position';
  const firstName = esc(ctx.name.split(' ')[0]);
  const mapsLink = buildMapsLink(ctx);
  const salary = buildSalaryString(ctx);
  const address = ctx.branchAddress ? ctx.branchAddress.replace(/\n/g, '<br>') : null;

  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.6;max-width:600px;margin:0 auto">
<div style="background:#1e40af;padding:20px 24px;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:20px">🎉 Congratulations ${firstName}! Shortlisted for ${role} at Mas Callnet</h1>
</div>
<div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
  <p>Dear ${firstName},</p>
  <p><strong>Congratulations! 🎉</strong></p>
  <p>Your profile has been shortlisted for the <strong>${role}</strong> position at <strong>Mas Callnet India Pvt. Ltd.</strong></p>

  <p>To proceed with the recruitment process, please complete your assessment and confirm your interview slot through the link below.</p>

${ctx.bmiUrl ? `  <p style="margin:20px 0">
    <a href="${esc(ctx.bmiUrl)}" style="background:#1e40af;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">👉 Complete Assessment &amp; Confirm Interview</a>
  </p>
  <p style="color:#666;font-size:13px">Please note: completing the assessment is an important step in the selection process.</p>` : ''}

  <table style="width:100%;margin:20px 0;border-collapse:collapse">
${slot ? `    <tr><td style="padding:8px 12px;background:#f8fafc;border-radius:4px;width:130px"><strong>📅 Interview Date</strong></td><td style="padding:8px 12px"><strong>${esc(slot.dateLabel)}</strong></td></tr>
    <tr><td style="padding:8px 12px"><strong>🕒 Interview Time</strong></td><td style="padding:8px 12px"><strong>${esc(slot.timeLabel)}</strong></td></tr>` : ''}
${ctx.branchCity || ctx.branch ? `    <tr><td style="padding:8px 12px;background:#f8fafc;border-radius:4px"><strong>📍 Location</strong></td><td style="padding:8px 12px">${esc(ctx.branchCity ?? ctx.branch)}</td></tr>` : ''}
${address ? `    <tr><td style="padding:8px 12px"><strong>🏢 Full Address</strong></td><td style="padding:8px 12px">${address}</td></tr>` : ''}
${mapsLink ? `    <tr><td style="padding:8px 12px;background:#f8fafc;border-radius:4px"><strong>🗺️ Google Maps</strong></td><td style="padding:8px 12px"><a href="${mapsLink}" style="color:#1e40af">View on Google Maps</a></td></tr>` : ''}
    <tr><td style="padding:8px 12px"><strong>💼 Role</strong></td><td style="padding:8px 12px">${role}</td></tr>
${salary ? `    <tr><td style="padding:8px 12px;background:#f8fafc;border-radius:4px"><strong>💰 Salary</strong></td><td style="padding:8px 12px">${esc(salary)}</td></tr>` : ''}
  </table>

  <p>We recommend completing the process at the earliest to avoid missing your opportunity.</p>
  <p>We look forward to speaking with you!</p>

  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;color:#888;font-size:12px">
    <strong style="color:#333">Warm regards,</strong><br>
    Mas Callnet HR Team<br>
    Mas Callnet India Pvt. Ltd.<br>
    <a href="https://www.mascallnet.ai" style="color:#1e40af">www.mascallnet.ai</a>
  </div>

  <p style="font-size:11px;color:#bbb;margin-top:16px">Reference: ${esc(ctx.requisitionCode ?? ctx.id)}</p>
</div>
</body></html>`;
}

async function loadLeadContext(
  leadId: string
): Promise<{ ctx: LeadContext; qualified: boolean; alreadySent: boolean; closedReason: string | null } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ml.id, ml.parsed_name, ml.parsed_phone, ml.parsed_email,
            ml.screening_result, ml.notification_sent_at,
            jr.designation_name, jr.branch_name, jr.requisition_code, jr.bmi_assessment_url,
            jr.salary_min, jr.salary_max,
            jr.approval_status, jr.active_status, jr.closed_at,
            jr.requested_headcount, jr.fulfilled_headcount,
            bm.address AS branch_address, bm.city AS branch_city,
            bm.latitude AS branch_lat, bm.longitude AS branch_lng
       FROM meta_lead_raw ml
       LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
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
    },
    qualified: row.screening_result === 'qualified',
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

export async function notifyQualifiedLead(leadId: string, options: { force?: boolean } = {}): Promise<OutreachOutcome> {
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
  // Shortlisting is against the batch requisition: a closed or fully-staffed batch cannot take
  // more candidates, so refuse outreach outright (force does not override this).
  if (loaded.closedReason) {
    outcome.skipped.push({ channel: 'all', reason: `Outreach refused: ${loaded.closedReason}` });
    return outcome;
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
    try {
      await emailService.send({
        to: ctx.email,
        subject: `Congratulations ${ctx.name.split(' ')[0]}! Shortlisted for ${ctx.designation ?? 'a position'} at Mas Callnet`,
        html: buildEmailHtml(ctx, slot),
      });
      outcome.succeeded.push('email');
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
        const msgText = slot
          ? `[Shortlist + Interview ${slot.dateLabel} ${slot.timeLabel} sent to ${ctx.name}]`
          : `[Shortlist notification sent to ${ctx.name}]`;
        // Persist the outbound shortlist message so it appears in the inbox thread
        await saveLeadMessage({
          leadId: ctx.id,
          direction: 'outbound',
          messageText: msgText,
          senderType: 'system',
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
  if (!ctx.phone) {
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
