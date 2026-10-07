/**
 * "Email me a sample of every stage": one test email per outreach stage so HR can see exactly what candidates get.
 * Safety: the only recipient is the signed-in user's own address (passed in by the route from the login, never from the request
 * body), nothing is written to the message log, and every email is stamped TEST so it cannot be mistaken for a real invite.
 */
import { emailService } from "../communication/email.service.js";
import { buildInviteEmail } from "./he-email.service.js";
import { HE_TEMPLATES, renderBody, type TemplateDef } from "./he-template-catalog.js";
import { DEMO_TOKEN } from "./he-location.service.js";
import { buildFollowUpEmail, type FollowKind } from "./he-followup-email.service.js";
import { VOICE_FIRST_MESSAGE, buildVoiceSystemPrompt, type VoiceCtx } from "./he-voice.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const env = (k: string, d: string) => (process.env[k]?.trim() ? process.env[k]!.trim() : d);

export interface SampleResult { stage: string; subject: string; ok: boolean; error?: string }

/** When each template is used, in the order a candidate meets them. */
const ORDER: Array<[TemplateDef["key"], string, string]> = [
  ["he_walkin_invite", "Stage 2", "WhatsApp invite, 60 minutes after the email, only to people who opted in to WhatsApp"],
  ["he_walkin_confirmed", "Follow-up", "Right after the candidate confirms (button, email tap or bot call)"],
  ["he_reminder_1d", "Follow-up", "The day before the interview, to confirmed candidates"],
  ["he_reminder_2h_location", "Follow-up", "About 2 hours before, with the optional share-my-location button"],
  ["he_reschedule_offer", "Follow-up", "After the candidate asks for another time; the new slot is a real free slot"],
  ["he_no_show_recovery", "Follow-up", "After a missed interview, once"],
  ["he_other_role_offer", "Follow-up", "After a rejection, for a different opening the candidate fits"],
  ["he_winback", "Follow-up", "For a lead we have not spoken to in 30+ days, when a new drive is announced"],
  ["he_missed_call", "Follow-up", "After two unanswered bot calls, asking to confirm on WhatsApp"],
  ["he_optout_ack", "Follow-up", "When a candidate sends STOP"],
  ["he_hr_arrival_alert", "Branch HR", "About 30 minutes before candidates are due, to the branch HR (not to candidates)"],
];

const SUBJECT: Record<string, string> = {
  "he_walkin_invite": "Stage 2 of 3 - WhatsApp invite (60 minutes after the email)",
  "he_walkin_confirmed": "Follow-up - Confirmation after the candidate says Yes",
  "he_reminder_1d": "Follow-up - Day-before reminder",
  "he_reminder_2h_location": "Follow-up - 2-hour reminder with the share-location button",
  "he_reschedule_offer": "Follow-up - New slot offered after Reschedule",
  "he_no_show_recovery": "Follow-up - After a missed interview",
  "he_other_role_offer": "Follow-up - Another opening after a rejection",
  "he_winback": "Follow-up - Win-back for an older lead",
  "he_missed_call": "Follow-up - Confirm on WhatsApp after unanswered calls",
  "he_optout_ack": "Follow-up - Opt-out acknowledgement (candidate sent STOP)",
  "he_hr_arrival_alert": "Branch HR alert - candidates arriving within 30 minutes"
};

function banner(stage: string): string {
  return `<div style="background:#fef3c7;color:#92400e;font:600 13px Arial,sans-serif;padding:10px 16px;text-align:center">TEST SAMPLE &middot; ${esc(stage)} &middot; nothing was sent to a candidate and the buttons here do nothing</div>`;
}

function whatsappHtml(t: TemplateDef, stage: string, when: string, body: string, buttons: string[]): string {
  const bubble = esc(body).replace(/\n/g, "<br/>");
  const pills = buttons.map((b) => `<span style="display:inline-block;margin:4px 6px 0 0;padding:8px 14px;border:1px solid #cbd5e1;border-radius:18px;background:#fff;color:#1d4ed8;font:600 13px Arial,sans-serif">${esc(b.replace(/^URL:\s*/, "").replace(/\s*->.*$/, ""))}</span>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9">${banner(stage)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" style="max-width:520px;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<tr><td style="padding-bottom:10px;font-size:13px;color:#475569"><b>${esc(stage)}</b> &middot; WhatsApp template <code>${esc(t.metaName.en ?? t.key)}</code> &middot; ${esc(t.category)}<br/>${esc(when)}</td></tr>
<tr><td style="background:#e7fbe0;border-radius:12px;padding:14px 16px;font-size:15px;line-height:1.5">${bubble}${pills ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #c7e8bf">${pills}</div>` : ""}</td></tr>
<tr><td style="padding-top:10px;font-size:12px;color:#64748b">This is how the message reads on the candidate's phone. Values like name, date and venue are sample values.</td></tr>
</table></td></tr></table></body></html>`;
}

/** Sample values shared by the email and WhatsApp samples. The location button points at the demo candidate page. */
export function sampleContext() {
  const base = env("HE_PUBLIC_BASE_URL", env("FRONTEND_URL", "https://mcnhrms.teammas.in")).replace(/\/$/, "");
  const company = env("HE_COMPANY_NAME", "MAS Callnet");
  const day = new Date(Date.now() + 86_400_000 + 5.5 * 3600_000);
  const date = day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(",", "");
  const ctx = {
    candidate_name: "Rahul Sharma", role: "Customer Success Executive", company, branch_name: "Noida Sector 62",
    branch_address: "Trapezoid IT Park, 1st Floor, C-27, Sector 62, Noida - 201309", drive_date: date, slot_time: "11:00 AM",
    maps_link: "https://maps.google.com/?q=Trapezoid+IT+Park+Sector+62+Noida", assessment_link: env("HE_ASSESSMENT_TEXT", "Given at the branch on arrival"),
    docs_list: env("HE_DOCS_LIST", "Aadhaar, PAN, 12th marksheet"), reference_id: "HE-SAMPLE", contact_name: env("HE_HR_CONTACT_NAME", "Priya Singh"),
    contact_phone: env("HE_HR_CONTACT_PHONE", "98765 43210"), location_token: DEMO_TOKEN, expected_count: 8, confirmed_count: 6, live_count: 4, board_link: `${base}/ats/hiring-engine`,
  };
  return { base, company, ctx };
}

export async function sendStageSamples(to: string): Promise<SampleResult[]> {
  const { base, company, ctx } = sampleContext();
  const out: SampleResult[] = [];
  const send = async (stage: string, subject: string, html: string, text: string) => {
    try { await emailService.send({ to, subject: `[TEST] ${subject}`, html, text }); out.push({ stage, subject, ok: true }); }
    catch (e) { out.push({ stage, subject, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }); }
  };

  // Stage 1: the real invite email with sample data.
  const invite = buildInviteEmail({ name: "Rahul", role: ctx.role, company, branch: ctx.branch_name, address: ctx.branch_address, date: ctx.drive_date, time: ctx.slot_time, maps: ctx.maps_link, docs: ctx.docs_list, reference: ctx.reference_id, contact: `${ctx.contact_name} ${ctx.contact_phone}`.trim(), answerUrl: `${base}/w/${"0".repeat(32)}`, optInUrl: `${base}/w/${"0".repeat(32)}` });
  await send("Stage 1", `Stage 1 of 3 - Email invite (sent first)`, invite.html.replace(/(<body[^>]*>)/i, `$1${banner("Stage 1 of 3: email invite")}`), invite.text);

  for (const [key, stage, when] of ORDER) {
    const t = HE_TEMPLATES.find((x) => x.key === key)!;
    const body = renderBody(key, "en", ctx);
    const label = SUBJECT[key];
    await send(stage, label, whatsappHtml(t, stage === "Stage 2" ? "Stage 2 of 3" : stage, when, body, t.buttons.en), `${stage}: ${t.metaName.en}\n${when}\n\n${body}\n\nButtons: ${t.buttons.en.join(" | ") || "none"}`);
    // The email twin of this follow-up, where there is one.
    const twin: Partial<Record<string, [FollowKind, string]>> = { he_walkin_confirmed: ["confirmed", "Confirmation after the candidate says Yes"], he_reminder_1d: ["reminder_1d", "Day-before reminder"], he_reschedule_offer: ["reschedule_offer", "New slot offered after Reschedule"], he_no_show_recovery: ["no_show", "After a missed interview"] };
    const tw = twin[key];
    if (tw) {
      const fm = buildFollowUpEmail({ kind: tw[0], name: "Rahul", role: ctx.role, company, branch: ctx.branch_name, address: ctx.branch_address, date: ctx.drive_date, time: ctx.slot_time, maps: ctx.maps_link, docs: ctx.docs_list, reference: ctx.reference_id, contact: `${ctx.contact_name} ${ctx.contact_phone}`.trim(), answerUrl: `${base}/w/${"0".repeat(32)}` });
      await send("Follow-up email", `Follow-up (email) - ${tw[1]}`, fm.html.replace(/(<body[^>]*>)/i, `$1${banner("Follow-up email: " + tw[1])}`), fm.text);
    }
    if (key === "he_walkin_invite") {
      // Stage 3 sits right after the WhatsApp invite in the cadence: the bot call.
      const vctx: VoiceCtx = { candidateName: "Rahul", role: ctx.role, driveDate: ctx.drive_date, slotTime: ctx.slot_time, branchAddress: ctx.branch_address, contactName: ctx.contact_name, contactPhone: ctx.contact_phone, referenceId: ctx.reference_id };
      const first = VOICE_FIRST_MESSAGE("Rahul"), script = buildVoiceSystemPrompt(vctx);
      const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9">${banner("Stage 3 of 3: bot call")}<table role="presentation" width="100%"><tr><td align="center" style="padding:20px 12px"><table role="presentation" width="100%" style="max-width:640px;font-family:Arial,sans-serif;color:#0f172a"><tr><td style="font-size:13px;color:#475569;padding-bottom:10px"><b>Stage 3 of 3</b> &middot; Bot call, 60 minutes after the WhatsApp step (or two steps after the email when WhatsApp was not possible). Calls only between 09:00 and 20:00 IST, one retry after 2 hours.</td></tr><tr><td style="background:#fff;border-radius:10px;padding:14px 16px;font-size:14px"><b>First thing the bot says</b><br/>${esc(first)}</td></tr><tr><td style="padding-top:12px"><div style="background:#0f172a;color:#e2e8f0;border-radius:10px;padding:14px 16px;font:12.5px/1.55 Consolas,monospace;white-space:pre-wrap">${esc(script)}</div></td></tr></table></td></tr></table></body></html>`;
      await send("Stage 3", `Stage 3 of 3 - Bot call script (what the voice bot says)`, html, `Stage 3: bot call\n${first}\n\n${script}`);
    }
  }
  return out;
}
