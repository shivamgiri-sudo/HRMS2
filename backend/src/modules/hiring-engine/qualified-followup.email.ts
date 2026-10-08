/**
 * Follow-up pipeline, email step: any time of day, after bridging the lead into the Hiring Engine, deduped against
 * earlier invite emails. The WhatsApp step follows one gap (inside the send window) after the attempt.
 */
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emailService } from "../communication/email.service.js";
import { normaliseEmail } from "../../shared/email-domains.js";
import { buildInviteEmail, INVITE_EMAIL_KEY } from "./he-email.service.js";
import { displayFirstName } from "./he-name.js";
import { dateLabel, timeLabel } from "./he-send.service.js";
import { emptyCounts, ensureHeLead, loadSendContext, ROW_COLUMNS, toFollowupRow, type FollowupRow, type StepCounts } from "./qualified-followup.context.js";
import { rowTag, type FollowupSwitches, type RowTag } from "./qualified-followup.policy.js";
import { afterFailure, followupRef, nextStepDue } from "./qualified-followup.rules.js";
import { bestOfferSkipSql } from "./he-best-offer.js";
import { notInIdsSql, selectWithOfferHolds } from "./he-best-offer.service.js";
import { valueAddOn } from "./he-valueadd-switches.js";
import { EMAIL_BUTTONS_OFF, replyToFor, type EmailButtonSwitches } from "./email-buttons.policy.js";
import { answerUrlFor, DEMO_TOKEN } from "./he-email-parts.js";
import { inviteLinkFor, newInviteToken, type InviteLink, type InviteLinkInput } from "./walkin-invite.service.js";

const env = (k: string, d: string) => (process.env[k]?.trim() ? process.env[k]!.trim() : d);
/** SMTP errors echo the recipient; never log or store an address. */
const scrub = (m: string) => m.replace(/[^\s@<>"',;:()]+@[^\s@<>"',;()]+/g, "[email]");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Same table layout and footer as buildInviteEmail, but no slot block and no answer buttons: the candidate is asked to reply or call to book. */
export function buildSlotlessInviteEmail(c: { name: string; role: string; company: string; branch: string; address: string | null; contact: string }): { subject: string; html: string; text: string } {
  const subject = `Walk-in interview: ${c.role}, ${c.company}`;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;width:110px;color:#64748b;font-size:13px;vertical-align:top">${label}</td><td style="padding:10px 0;border-top:1px solid #e2e8f0;font-size:15px;color:#0f172a">${value}</td></tr>`;
  const book = c.contact ? `Please reply to this email or call ${esc(c.contact)} to book a time that suits you.` : "Please reply to this email to book a time that suits you.";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<tr><td style="background:#1e3a8a;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.3px">${esc(c.company)} <span style="font-weight:normal;font-size:13px;color:#c7d2fe">&nbsp;|&nbsp; Careers</span></td></tr>
<tr><td style="padding:26px 28px 6px">
<p style="margin:0 0 6px;font-size:16px">Hi ${esc(c.name)},</p>
<p style="margin:0;font-size:15px;line-height:1.55;color:#334155">Thank you for your interest. Your profile matches our <b>${esc(c.role)}</b> opening and we would like to invite you for a walk-in interview.</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:#334155">${book}</p>
</td></tr>
<tr><td style="padding:14px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row("Venue", `<b>${esc(c.branch)}</b>${c.address ? `<br/><span style="font-size:14px;color:#334155">${esc(c.address)}</span>` : ""}`)}
${c.contact ? row("Questions", esc(c.contact)) : ""}
</table></td></tr>
<tr><td style="padding:22px 28px 26px;font-size:14px;color:#334155">All the best,<br/><b>${esc(c.company)} Hiring Team</b></td></tr>
<tr><td style="background:#f8fafc;padding:14px 28px;font-size:11px;color:#94a3b8;line-height:1.5">You are receiving this because you applied for a job with ${esc(c.company)} or shared your profile with us. The interview is free of charge; we never ask for money.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Hi ${c.name},`, "", `Your profile matches our ${c.role} opening and we would like to invite you for a walk-in interview.`,
    c.contact ? `Please reply to this email or call ${c.contact} to book a time that suits you.` : "Please reply to this email to book a time that suits you.",
    `Venue: ${c.branch}${c.address ? `, ${c.address}` : ""}`, "", "All the best,", `${c.company} Hiring Team`].join("\n");
  return { subject, html, text };
}

type Outcome = "sent" | "test_sent" | "skipped" | "failed" | "blocked" | "dry_run";

// The WhatsApp step follows one gap after the email attempt; a skip for missing address/config leaves it as enqueued.
async function finish(row: FollowupRow, status: Outcome, error: string | null, now: Date, o: { advanceWa: boolean; sent: boolean }): Promise<void> {
  await db.execute(
    `UPDATE qualified_followup SET email_status = ?, email_error = ?${o.sent ? ", email_sent_at = NOW()" : ""}${o.advanceWa ? ", wa_due_at = ?" : ""}, step_claimed_at = NULL WHERE id = ?`,
    [status, error, ...(o.advanceWa ? [nextStepDue(now)] : []), row.id]);
}

/** `buttons` is read once per tick by the worker; callers that pass nothing get today's email (and no extra query). */
export async function runEmailStep(s: FollowupSwitches, tag: RowTag, now: Date, limit = 200, buttons: EmailButtonSwitches = EMAIL_BUTTONS_OFF): Promise<StepCounts> {
  const counts = emptyCounts();
  if (rowTag(s) !== tag) return counts;
  if (tag !== "dry_run" && s.sendsPaused) return counts;
  if (tag === "test" && (s.testMisconfigured || !s.testEmail)) return counts;
  const paused = [...s.pausedSources];
  const bestOffer = valueAddOn("best_offer");
  const select = async (ids: string[], lim: number) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${ROW_COLUMNS} FROM qualified_followup qf
      WHERE qf.mode_at_enqueue = ? AND qf.email_status IS NULL AND qf.stopped_reason IS NULL AND qf.email_due_at IS NOT NULL AND qf.email_due_at <= ?
        AND qf.owner = 'pipeline'${bestOfferSkipSql(bestOffer)}
        ${paused.length ? `AND qf.source_type NOT IN (${paused.map(() => "?").join(",")})` : ""}${ids.length ? notInIdsSql(ids) : ""}
      ORDER BY qf.email_due_at LIMIT ${lim}`,
      [tag, now, ...paused, ...ids]);
    return rows.map(toFollowupRow);
  };
  let list = await select([], Math.max(1, Math.floor(limit)));
  let held: Set<string> | null = null;
  if (bestOffer) ({ rows: list, held } = await selectWithOfferHolds(list, tag, paused, select));
  for (const row of list) {
    if (held?.has(row.id)) { counts.held++; continue; }
    try {
      await processRow(s, tag, now, row, counts, buttons);
    } catch (err) {
      logger.warn({ rowId: row.id, err: (err as Error).message }, "[qualified-followup] email step failed for row");
    }
  }
  return counts;
}

async function processRow(s: FollowupSwitches, tag: RowTag, now: Date, row: FollowupRow, counts: StepCounts, buttons: EmailButtonSwitches): Promise<void> {
  if (tag === "dry_run") {
    const [res] = await db.execute<any>(
      "UPDATE qualified_followup SET email_status = 'dry_run', wa_due_at = ? WHERE id = ? AND email_status IS NULL", [nextStepDue(now), row.id]);
    if (Number(res?.affectedRows ?? 0) === 0) return;
    counts.processed++; counts.dryRun++;
    return;
  }
  const to = normaliseEmail(row.email);
  if (!to || !emailService.isConfigured()) {
    const [res] = await db.execute<any>(
      "UPDATE qualified_followup SET email_status = 'skipped', email_error = ? WHERE id = ? AND email_status IS NULL", [to ? "email_not_configured" : "no_email", row.id]);
    if (Number(res?.affectedRows ?? 0) === 0) return;
    counts.processed++; counts.blocked++;
    return;
  }
  const [claim] = await db.execute<any>(
    "UPDATE qualified_followup SET email_status = 'sending', step_claimed_at = NOW() WHERE id = ? AND email_status IS NULL AND stopped_reason IS NULL AND owner = 'pipeline'", [row.id]);
  if (Number(claim?.affectedRows ?? 0) === 0) { counts.held++; return; }
  counts.processed++;

  const isTest = tag === "test";
  let heLeadId: string | null;
  let mail: { subject: string; html: string; text: string };
  let invite: { input: InviteLinkInput; link: InviteLink } | null = null;
  let answerToken: string | null = null;
  try {
    // Test mode must not write he_lead, so it never bridges.
    heLeadId = isTest ? row.heLeadId : await ensureHeLead(row);
    const ctx = await loadSendContext({ ...row, heLeadId }, { assignSlot: !isTest, now });
    if (ctx.leadStatus === "opted_out") { await finish(row, "blocked", "opted_out", now, { advanceWa: true, sent: false }); counts.blocked++; return; }
    if (!isTest && !heLeadId) { await finish(row, "blocked", "no_he_lead", now, { advanceWa: true, sent: false }); counts.blocked++; return; }
    if (!isTest && heLeadId) {
      const [dup] = await db.execute<RowDataPacket[]>(
        `SELECT 1 FROM he_message WHERE lead_id = ? AND requisition_id = ? AND template_key = ? AND direction = 'out' AND delivery_status <> 'failed' LIMIT 1`,
        [heLeadId, row.requisitionId, INVITE_EMAIL_KEY]);
      if (dup.length) { await finish(row, "skipped", "already_emailed", now, { advanceWa: true, sent: false }); counts.blocked++; return; }
    }
    const company = env("HE_COMPANY_NAME", "MAS Callnet");
    const contact = [env("HE_HR_CONTACT_NAME", ""), env("HE_HR_CONTACT_PHONE", "")].filter(Boolean).join(" ");
    const name = displayFirstName(row.fullName);
    const role = row.roleName ?? "the role";
    const branch = row.branchName ?? "";
    const base = env("HE_PUBLIC_BASE_URL", env("FRONTEND_URL", "https://mcnhrms.teammas.in")).replace(/\/$/, "");
    // A Meta row without a match gets the same answer buttons on an invite token (switch, default off). Test mode only reads
    // (demo token on the page); live writes the invite after a successful send with the token the email carried.
    if (ctx.slot && !ctx.matchToken && buttons.pipelineMeta) {
      const input: InviteLinkInput = { mobile10: row.mobile10, requisitionId: row.requisitionId, leadId: heLeadId ?? null, metaLeadId: row.metaLeadId, followupId: row.id,
        branchName: row.branchName, slotAt: `${ctx.slot.date} ${ctx.slot.time}`.slice(0, 19), sourcePath: "pipeline", driveType: row.sourceType, now };
      // Test mode never shows a real person's invite token to the tester: the demo page only.
      const link: InviteLink = isTest
        ? { kind: "invite", token: DEMO_TOKEN, answerUrl: answerUrlFor(DEMO_TOKEN), matchId: null, inviteId: null }
        : await inviteLinkFor(input, { simulate: true, token: newInviteToken() });
      invite = { input, link };
    }
    const answerUrl = ctx.matchToken ? `${base}/w/${ctx.matchToken}` : invite?.link.answerUrl ?? null;
    answerToken = isTest ? null : ctx.matchToken ?? invite?.link.token ?? null;
    mail = ctx.slot
      ? buildInviteEmail({
          name, role, company, branch, address: ctx.branchAddress ?? "", date: dateLabel(ctx.slot.date), time: timeLabel(`${ctx.slot.date}T${ctx.slot.time}`), maps: ctx.mapsLink,
          docs: env("HE_DOCS_LIST", "Aadhaar, PAN, 12th marksheet"), reference: followupRef(row.id), contact,
          answerUrl, ...(invite ? { stopUrl: invite.link.answerUrl } : {}),
        })
      : buildSlotlessInviteEmail({ name, role, company, branch, address: ctx.branchAddress, contact });
  } catch (err) {
    // Nothing has been sent yet: release the claim (attempts unchanged) so the next tick retries.
    logger.warn({ rowId: row.id, err: scrub((err as Error).message) }, "[qualified-followup] email step failed before sending; claim released");
    await db.execute("UPDATE qualified_followup SET email_status = NULL, step_claimed_at = NULL WHERE id = ? AND email_status = 'sending'", [row.id])
      .catch((e: unknown) => logger.warn({ rowId: row.id, err: scrub((e as Error).message) }, "[qualified-followup] could not release email claim"));
    counts.held++;
    return;
  }

  const target = isTest ? (s.testEmail as string) : to;
  let providerId: string | null = null;
  try {
    const replyTo = replyToFor(answerToken);
    const r = await emailService.send({ to: target, subject: isTest ? `[TEST] ${mail.subject}` : mail.subject, html: mail.html, text: mail.text, ...(replyTo ? { replyTo } : {}) });
    providerId = r?.messageId ?? null;
  } catch (err) {
    const msg = scrub(err instanceof Error ? err.message : String(err));
    logger.warn({ rowId: row.id, error: msg.slice(0, 200) }, "[qualified-followup] email send failed");
    const f = afterFailure(row.emailAttempts, msg, now);
    counts.failed++;
    if (f.status === null) {
      await db.execute(
        "UPDATE qualified_followup SET email_status = NULL, email_due_at = ?, email_attempts = ?, email_error = ?, step_claimed_at = NULL WHERE id = ?",
        [f.retryAt, f.attempts, msg.slice(0, 255), row.id]);
    } else {
      await db.execute(
        "UPDATE qualified_followup SET email_status = 'failed', email_attempts = ?, email_error = ?, wa_due_at = ?, step_claimed_at = NULL WHERE id = ?",
        [f.attempts, msg.slice(0, 255), nextStepDue(now), row.id]);
    }
    return;
  }

  // The mail is out: never retry or mark failed from here on. If recording fails the row stays 'sending' and the
  // stale-claim expiry marks it "outcome unknown".
  counts.sent++;
  if (invite && !isTest && invite.link.kind === "invite") {
    await inviteLinkFor(invite.input, { token: invite.link.token })
      .catch((err: unknown) => logger.warn({ rowId: row.id, err: scrub((err as Error).message) }, "[qualified-followup] invite record failed after send"));
  }
  try {
    if (!isTest) {
      await db.execute(
        "INSERT INTO he_message (id, lead_id, mobile10, direction, channel, template_key, body, provider_message_id, delivery_status, requisition_id, drive_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [randomUUID(), heLeadId, row.mobile10, "out", "email", INVITE_EMAIL_KEY, mail.subject.slice(0, 2000), providerId, "sent", row.requisitionId, row.driveId]);
    }
    await finish(row, isTest ? "test_sent" : "sent", null, now, { advanceWa: true, sent: true });
  } catch (err) {
    logger.warn({ rowId: row.id, err: scrub((err as Error).message) }, "[qualified-followup] email sent but recording failed");
    try { await finish(row, isTest ? "test_sent" : "sent", null, now, { advanceWa: true, sent: true }); }
    catch (e) { logger.warn({ rowId: row.id, err: scrub((e as Error).message) }, "[qualified-followup] email sent; row left in sending for expiry"); }
  }
}
