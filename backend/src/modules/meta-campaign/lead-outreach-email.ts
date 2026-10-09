/**
 * The legacy Meta invitation email (Notify / Notify All / sync), moved out of lead-outreach.service.ts. Without an answer link it is
 * byte-identical to the email sent before; with one, the same Yes / Another time / Cannot come buttons as every other invitation email
 * (he-email-parts) and a small Stop messages link sit above the assessment button, and a plain-text part is added.
 */
import type { InterviewSlot } from './interview-slot.service.js';
import { answerButtonsHtml, answerButtonsText, stopLinkHtml, stopLinkText } from '../hiring-engine/he-email-parts.js';
import type { InviteLink } from '../hiring-engine/walkin-invite.service.js';

export interface LeadContext {
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
  /** For the answer link (walkin_invite) only; not shown in the email. */
  requisitionId?: string | null;
  campaignId?: string | null;
}

export function buildMapsLink(ctx: LeadContext): string {
  if (ctx.branchLat && ctx.branchLng) {
    return `https://maps.google.com/?q=${ctx.branchLat},${ctx.branchLng}`;
  }
  if (ctx.branchAddress) {
    return `https://maps.google.com/?q=${encodeURIComponent(ctx.branchAddress)}`;
  }
  return '';
}

export function buildSalaryString(ctx: LeadContext): string {
  if (ctx.salaryMin && ctx.salaryMax) {
    return `₹${ctx.salaryMin.toLocaleString('en-IN')} – ₹${ctx.salaryMax.toLocaleString('en-IN')} per month`;
  }
  if (ctx.salaryMin) return `₹${ctx.salaryMin.toLocaleString('en-IN')} per month`;
  return '';
}

function buildEmailHtml(ctx: LeadContext, slot?: InterviewSlot, answers = ''): string {
  const esc = (v: string | null) =>
    (v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const role = esc(ctx.designation) || 'a position';
  const firstName = esc(ctx.name.split(' ')[0]);
  const mapsLink = buildMapsLink(ctx);
  const salary = buildSalaryString(ctx);
  const address = ctx.branchAddress ? esc(ctx.branchAddress).replace(/\n/g, '<br>') : null;

  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.6;max-width:600px;margin:0 auto">
<div style="background:#1e40af;padding:20px 24px;border-radius:8px 8px 0 0">
  <h1 style="color:#fff;margin:0;font-size:20px">🎉 Congratulations ${firstName}! Shortlisted for ${role} at Mas Callnet</h1>
</div>
<div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
  <p>Dear ${firstName},</p>
  <p><strong>Congratulations! 🎉</strong></p>
  <p>Your profile has been shortlisted for the <strong>${role}</strong> position at <strong>Mas Callnet India Pvt. Ltd.</strong></p>

  <p>To proceed with the recruitment process, please complete your assessment and confirm your interview slot through the link below.</p>
${answers}
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


// A header value: CR / LF never reach it (header injection); normal values are unchanged.
export const legacySubject = (ctx: LeadContext) => `Congratulations ${ctx.name.split(' ')[0]}! Shortlisted for ${ctx.designation ?? 'a position'} at Mas Callnet`.replace(/[\r\n]+/g, ' ');

/** link null → today's email (subject + html only). Buttons only with a slot: the answer page needs a time to confirm. */
export function buildLegacyInviteEmail(ctx: LeadContext, slot: InterviewSlot | undefined, link: InviteLink | null, o: { stopLink: boolean }): { subject: string; html: string; text?: string } {
  if (!link || !slot) return { subject: legacySubject(ctx), html: buildEmailHtml(ctx, slot) };
  const u = link.answerUrl;
  const block = `  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px">${answerButtonsHtml(u)}${o.stopLink ? stopLinkHtml(u) : ''}</table>`;
  const first = ctx.name.split(' ')[0];
  const text = [`Dear ${first},`, '', `Your profile has been shortlisted for the ${ctx.designation ?? 'a position'} position at Mas Callnet India Pvt. Ltd.`,
    `Walk-in interview: ${slot.dateLabel}, ${slot.timeLabel}${ctx.branchCity || ctx.branch ? ` at ${ctx.branchCity ?? ctx.branch}` : ''}`,
    ...(ctx.branchAddress ? [`Address: ${ctx.branchAddress}`] : []), answerButtonsText(u).trim(), ...(ctx.bmiUrl ? [`Assessment: ${ctx.bmiUrl}`] : []),
    ...(o.stopLink ? [stopLinkText(u)] : []), '', 'Mas Callnet HR Team'].join('\n');
  return { subject: legacySubject(ctx), html: buildEmailHtml(ctx, slot, block), text };
}
