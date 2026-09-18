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
}

function buildWhatsAppBody(ctx: LeadContext): string {
  const role = ctx.designation ?? 'a position';
  const place = ctx.branch ? ` (${ctx.branch})` : '';
  const assessment = ctx.bmiUrl ? `\n\nAssessment / मूल्यांकन: ${ctx.bmiUrl}` : '';
  return (
    `नमस्ते ${ctx.name},\n\n` +
    `MAS में *${role}*${place} के लिए आपकी रुचि के लिए धन्यवाद। आपका आवेदन शॉर्टलिस्ट कर लिया गया है।\n` +
    `हमारी टीम जल्द ही आपसे संपर्क करेगी। कृपया अपना आधार, पैन और शिक्षा प्रमाण तैयार रखें।\n\n` +
    `— — —\n\n` +
    `Hello ${ctx.name},\n\n` +
    `Thank you for your interest in *${role}*${place} at MAS. Your application has been shortlisted.\n` +
    `Our team will contact you shortly. Please keep your Aadhaar, PAN and education proof ready.` +
    assessment +
    `\n\nRef: ${ctx.requisitionCode ?? ctx.id}`
  );
}

function buildEmailHtml(ctx: LeadContext): string {
  const esc = (v: string | null) =>
    (v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const role = esc(ctx.designation) || 'a position';
  return `<html><body style="font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.6">
<h2 style="color:#1e40af">You have been shortlisted</h2>
<p>Hello ${esc(ctx.name)},</p>
<p>Thank you for your interest in <strong>${role}</strong>${ctx.branch ? ` at <strong>${esc(ctx.branch)}</strong>` : ''} with MAS. Your application has been shortlisted for the next step.</p>
<p>Our recruitment team will contact you shortly. Please keep your Aadhaar, PAN and education proof ready.</p>
${ctx.bmiUrl ? `<p><a href="${esc(ctx.bmiUrl)}" style="background:#1e40af;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px;display:inline-block">Start your assessment</a></p>` : ''}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:22px 0">
<p style="direction:ltr">नमस्ते ${esc(ctx.name)}, MAS में <strong>${role}</strong> के लिए आपका आवेदन शॉर्टलिस्ट कर लिया गया है। हमारी टीम जल्द ही आपसे संपर्क करेगी।</p>
<p style="font-size:12px;color:#999;margin-top:24px">Reference: ${esc(ctx.requisitionCode ?? ctx.id)}</p>
</body></html>`;
}

async function loadLeadContext(leadId: string): Promise<{ ctx: LeadContext; qualified: boolean; alreadySent: boolean } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ml.id, ml.parsed_name, ml.parsed_phone, ml.parsed_email,
            ml.screening_result, ml.notification_sent_at,
            jr.designation_name, jr.branch_name, jr.requisition_code, jr.bmi_assessment_url
       FROM meta_lead_raw ml
       LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
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
    },
    qualified: row.screening_result === 'qualified',
    alreadySent: Boolean(row.notification_sent_at),
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
  // Re-notifying is a real recruiter need, but it must be explicit. Without this guard a webhook
  // redelivery or a page refresh could message the same candidate repeatedly.
  if (loaded.alreadySent && !options.force) {
    outcome.skipped.push({ channel: 'all', reason: 'Already notified; pass force=true to re-send' });
    return outcome;
  }

  const { ctx } = loaded;

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
        const res = await provider.send(ctx.phone, 'Shortlisted', buildWhatsAppBody(ctx));
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
        subject: `You have been shortlisted${ctx.designation ? ` — ${ctx.designation}` : ''} | MAS`,
        html: buildEmailHtml(ctx),
      });
      outcome.succeeded.push('email');
    } catch (err) {
      outcome.failed.push({ channel: 'email', error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Voice bot ──
  // Fires AFTER the text channels on purpose: a candidate who gets a call with no prior written
  // context is far more likely to treat it as a spam call.
  if (!ctx.phone) {
    outcome.skipped.push({ channel: 'voice', reason: 'Lead has no phone number' });
  } else if (!isVoicebotConfigured()) {
    outcome.skipped.push({ channel: 'voice', reason: 'VOICEBOT_TRIGGER_URL is not configured' });
  } else {
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
