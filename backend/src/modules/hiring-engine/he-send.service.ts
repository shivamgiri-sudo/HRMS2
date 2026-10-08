/**
 * The only path by which the engine sends a WhatsApp template. Every send goes through the same gates:
 * kill switch -> consent/opt-out -> quiet hours / caps / min gap -> requisition still open -> template
 * approved -> all variables present. A dry run returns what WOULD be sent and writes nothing.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { PinbotWhatsAppProvider } from "../communication/providers/whatsapp/pinbot.provider.js";
import { addEvent, hasConsent, setLeadStatus } from "./he-lead.service.js";
import { checkSendAllowed } from "./he-guardrails.js";
import { channelAllowed } from "./he-campaign-config.service.js";
import { buildParams, getTemplate, renderBody, type Lang, type TemplateKey } from "./he-template-catalog.js";
import type { LeadStatus } from "./he-state.js";
import { cleanName, displayFirstName } from "./he-name.js";
import { whatsappRequiresOptIn } from "./he-policy.service.js";
import { requisitionOpenReason } from "./followup-guards.js";

const pinbot = new PinbotWhatsAppProvider();

export type SendResult =
  | { status: "sent"; messageId: string; providerMessageId: string }
  | { status: "dry_run"; body: string; lang: Lang; params: string[] }
  | { status: "blocked"; reason: string }
  | { status: "failed"; error: string };

/** Global kill switch: HE_SENDS_PAUSED=true stops every send immediately without a deploy-free code path. */
export const sendsPaused = () => process.env.HE_SENDS_PAUSED === "true";

const env = (k: string, d: string) => (process.env[k] && process.env[k]!.trim() ? process.env[k]!.trim() : d);

export interface SendOpts {
  leadId: string;
  key: TemplateKey;
  matchId?: string | null;
  extra?: Record<string, string | number | null | undefined>;
  dryRun?: boolean;
  /** Skip quiet-hours/cap/gap (never consent, opt-out, pause or closed-requisition) - e.g. opt-out acknowledgement. */
  transactional?: boolean;
  /** Cadence follow-ups run an hour after the previous touch, below the 120 min default between unrelated sends. */
  minGapMinutes?: number;
  /** Requisition context for a send with no match (the follow-up pipeline): he_message.requisition_id and the same open-requisition rule as a match. */
  requisitionId?: string | null;
  /** Follow-up pipeline step: consent is assumed unless a revoked whatsapp_contact consent exists; daily cap and min gap do not apply.
   *  Quiet hours, pause, opt-out and a closed requisition still block. */
  followupStep?: boolean;
  /** Test mode: a 10-digit number that receives the message instead of the lead. Nothing is recorded (no he_message, event, contact time or status). */
  redirectTo?: string | null;
  /** The unified follow-up worker's sends are tagged (he_message.sent_by) so reports can tell mechanisms apart. */
  sentBy?: "followup";
}

const FIRST_CONTACT = new Set<TemplateKey>(["he_walkin_invite", "he_winback", "he_other_role_offer"]);
const LEAD_STATUS_AFTER: Partial<Record<TemplateKey, LeadStatus>> = { he_walkin_invite: "invited", he_winback: "contacted", he_other_role_offer: "contacted" };

export function langFor(pref: string | null | undefined): Lang {
  return pref === "en" ? "en" : "hi"; // Roman Hinglish template is the default; English only when the candidate writes English
}

export function dateLabel(d: string): string {
  const dt = new Date(String(d).slice(0, 10) + "T00:00:00Z");
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(",", "");
}
export function timeLabel(slot: string): string {
  const [h, m] = String(slot).slice(11, 16).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** The old Meta flow already messaged this person in the last 3 days (any channel: the Hiring Engine does not send a second first touch). */
export async function metaFlowNotifiedRecently(metaLeadId: string | null | undefined): Promise<boolean> {
  if (!metaLeadId) return false;
  const [mn] = await db.execute<RowDataPacket[]>(
    "SELECT 1 FROM meta_lead_raw WHERE id = ? AND notification_sent_at IS NOT NULL AND notification_sent_at > DATE_SUB(NOW(), INTERVAL 3 DAY) LIMIT 1", [metaLeadId]);
  return mn.length > 0;
}

export async function sendTemplateToLead(o: SendOpts): Promise<SendResult> {
  const [lr] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.mobile10, l.full_name, l.status, l.meta_lead_id, i.language_pref FROM he_lead l LEFT JOIN he_lead_insight i ON i.lead_id = l.id WHERE l.id = ? LIMIT 1`, [o.leadId]);
  const lead = lr[0];
  if (!lead) return { status: "blocked", reason: "lead_not_found" };

  // The Meta campaign flow (lead-outreach.service) already sends its own interview invite to qualified Meta leads.
  // Never send a second first-contact invite to the same person within 3 days of that one.
  // The unified follow-up worker owns the person (its own first step stamps notification_sent_at): the guard is for the other senders.
  if (FIRST_CONTACT.has(o.key) && o.sentBy !== "followup" && (await metaFlowNotifiedRecently(lead.meta_lead_id))) return { status: "blocked", reason: "meta_flow_already_notified" };
  // Per-campaign channel switch (Master tab): WhatsApp off for the campaign this person came from. The STOP acknowledgement always goes.
  if (o.key !== "he_optout_ack" && !(await channelAllowed(o.leadId, "whatsapp"))) return { status: "blocked", reason: "whatsapp_off_for_campaign" };

  let m: RowDataPacket | undefined;
  if (o.matchId) {
    const [mr] = await db.execute<RowDataPacket[]>(
      `SELECT m.id, m.requisition_id, m.slot_at, m.token, m.state, d.id AS drive_id, d.drive_date, d.status AS drive_status, d.reinvite,
              jr.designation_name, jr.branch_name, jr.bmi_assessment_url, jr.approval_status, jr.active_status, jr.requested_headcount, jr.fulfilled_headcount, jr.closed_at,
              bm.address, bm.latitude, bm.longitude, bm.hr_contact
         FROM he_match m LEFT JOIN he_drive d ON d.id = m.drive_id JOIN job_requisition jr ON jr.id = m.requisition_id
         LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
        WHERE m.id = ? LIMIT 1`, [o.matchId]);
    m = mr[0];
  }
  // D8, the one requisition-open rule (approved, active, not closed, seats left), shared with the follow-up guards.
  const isOpen = (r: RowDataPacket) => requisitionOpenReason({ approvalStatus: r.approval_status ?? null, activeStatus: r.active_status == null ? null : Number(r.active_status), closedAt: r.closed_at ?? null,
    requestedHeadcount: r.requested_headcount == null ? null : Number(r.requested_headcount), fulfilledHeadcount: r.fulfilled_headcount == null ? null : Number(r.fulfilled_headcount) }) === null;
  let requisitionOpen = m ? isOpen(m) : true;
  if (!m && o.requisitionId) {
    const [rr] = await db.execute<RowDataPacket[]>(
      "SELECT approval_status, active_status, requested_headcount, fulfilled_headcount, closed_at FROM job_requisition WHERE id = ? LIMIT 1", [o.requisitionId]);
    requisitionOpen = rr[0] ? isOpen(rr[0]) : false;
  }

  const [sent] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS today, MAX(created_at) AS last_at FROM he_message
      WHERE lead_id = ? AND direction = 'out' AND channel = 'whatsapp' AND created_at >= CURDATE()`, [o.leadId]);
  const [lastAny] = await db.execute<RowDataPacket[]>("SELECT MAX(created_at) AS last_at FROM he_message WHERE lead_id = ? AND direction = 'out'", [o.leadId]);

  // Owner policy: qualified candidates are messaged about their own application without a WhatsApp opt-in unless that setting is turned back
  // on. Opt-out and a revoked consent (a STOP) always win. Live location is separate: it always needs the candidate's own tap.
  let consent = await hasConsent(o.leadId, "whatsapp_contact");
  let basis: "consent" | "applicant" = "consent";
  if (!consent && (o.followupStep || !(await whatsappRequiresOptIn()))) {
    const [refused] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_consent WHERE lead_id = ? AND consent_type = 'whatsapp_contact' AND revoked_at IS NOT NULL LIMIT 1", [o.leadId]);
    if (!refused.length) { consent = true; basis = "applicant"; }
  }
  const noCaps = o.transactional || o.followupStep;
  const verdict = checkSendAllowed({
    now: new Date(), consent, optedOut: lead.status === "opted_out", paused: sendsPaused() || m?.drive_status === "paused",
    sentToday: noCaps ? 0 : Number(sent[0].today), lastSentAt: !noCaps && lastAny[0].last_at ? new Date(String(lastAny[0].last_at).replace(" ", "T") + "+05:30") : null,
    requisitionOpen, ...(o.minGapMinutes ? { minGapMinutes: o.minGapMinutes } : {}),
    ...(o.transactional ? { quietStartHour: 24, quietEndHour: 0 } : {}),
  });
  if (!verdict.ok) return { status: "blocked", reason: verdict.reason };

  // Preferred language first; English is the approved fallback (Hinglish versions are not approved at Meta yet).
  const pref = langFor(lead.language_pref as string | null);
  // A re-run drive (people who never booked, or missed an earlier date) uses the re-invite wording once Meta has approved it (T12); until then
  // the normal invite goes out. The message is still logged as the invite so the cadence (email -> WhatsApp -> call) treats it as one.
  let tplKey: TemplateKey = o.key;
  const findTpl = async (k: TemplateKey) => {
    const [trs] = await db.execute<RowDataPacket[]>(
      "SELECT template_key, pinbot_name, language, approval_state FROM he_template WHERE template_key IN (?, ?) AND approval_state = 'approved' AND pinbot_name IS NOT NULL",
      [`${k}:${pref}`, `${k}:en`]);
    return trs.find((t) => t.template_key === `${k}:${pref}`) ?? trs.find((t) => t.template_key === `${k}:en`);
  };
  let found: RowDataPacket | undefined;
  if (o.key === "he_walkin_invite" && Number(m?.reinvite) === 1) { found = await findTpl("he_reinvite"); if (found) tplKey = "he_reinvite"; }
  if (!found) found = await findTpl(o.key);
  const tr = found ? [found] : [];
  if (!tr[0]) return { status: "blocked", reason: "template_not_approved" };
  const lang: Lang = tr[0].template_key === `${tplKey}:${pref}` ? pref : "en";

  const domain = env("HE_PUBLIC_BASE_URL", "");
  const slot = m?.slot_at ? String(m.slot_at) : null;
  const lat = m?.latitude, lng = m?.longitude;
  const ctx: Record<string, string | number | null | undefined> = {
    // Approved bodies read "Candidate: {{1}}" / "Name: {{1}}", so the full cleaned name, not just the first word.
    candidate_name: cleanName(lead.full_name) || displayFirstName(lead.full_name),
    role: m?.designation_name, company: env("HE_COMPANY_NAME", "MAS Callnet"),
    branch_name: m?.branch_name, branch_address: m?.address,
    drive_date: m?.drive_date ? dateLabel(String(m.drive_date)) : null, slot_time: slot ? timeLabel(slot) : null,
    maps_link: lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : m?.address ? `https://maps.google.com/?q=${encodeURIComponent(String(m.address))}` : null,
    assessment_link: m?.bmi_assessment_url || env("HE_ASSESSMENT_TEXT", "Given at the branch on arrival"), docs_list: env("HE_DOCS_LIST", "Aadhaar, PAN, 12th marksheet"),
    reference_id: m ? `HE-${String(m.id).replace(/-/g, "").slice(0, 6).toUpperCase()}` : null,
    // T2 needs both. Unset on prod, they blocked every T2 ("missing contact_name", R0 2026-10-09); the branch's HR contact, then the
    // reception, keep the transactional confirmation going.
    contact_name: env("HE_HR_CONTACT_NAME", "our HR team"),
    contact_phone: env("HE_HR_CONTACT_PHONE", "") || String(m?.hr_contact ?? "").trim() || "the branch reception",
    location_token: m?.token, ...o.extra,
  };
  let params: string[];
  try { params = buildParams(tplKey, lang, ctx); }
  catch (e) { return { status: "blocked", reason: (e as Error).message }; }
  const previewBody = renderBody(tplKey, lang, ctx);

  // Fail closed: any provided value (even "" or null) means redirected, and must be a valid number.
  const redirected = o.redirectTo !== undefined;
  if (redirected && !/^\d{10}$/.test(String(o.redirectTo))) return { status: "blocked", reason: "invalid_redirect" };
  const recipient = redirected ? String(o.redirectTo) : String(lead.mobile10);

  if (o.dryRun) return { status: "dry_run", body: previewBody, lang, params };
  if (!pinbot.isConfigured()) return { status: "blocked", reason: "whatsapp_not_configured" };

  const hasUrlButton = getTemplate(tplKey).buttons[lang].some((b) => b.startsWith("URL:"));
  let res = await pinbot.sendTemplate(recipient, String(tr[0].pinbot_name), params, String(tr[0].language), hasUrlButton ? String(ctx.location_token ?? "") : undefined);
  let body = renderBody(tplKey, lang, ctx);
  let fellBack = false;
  // The invite (T1) can be rejected at Meta while its approved wording differs from ours (#132000 / #132001 / #132018). The approved
  // "interview appointment pending confirmation" (T9) carries the same role, date, time and branch with the same Yes / Reschedule /
  // Can't come buttons, so the first WhatsApp touch falls back to it instead of failing for every candidate.
  if (!res.success && o.key === "he_walkin_invite" && /132000|132001|132018|does not exist|parameters/i.test(String(res.error ?? ""))) {
    const [fb] = await db.execute<RowDataPacket[]>("SELECT pinbot_name, language FROM he_template WHERE template_key = 'he_missed_call:en' AND approval_state = 'approved' AND pinbot_name IS NOT NULL LIMIT 1");
    if (fb[0]) {
      try {
        const r2 = await pinbot.sendTemplate(recipient, String(fb[0].pinbot_name), buildParams("he_missed_call", "en", ctx), String(fb[0].language));
        if (r2.success) { res = r2; body = renderBody("he_missed_call", "en", ctx); fellBack = true; }
      } catch { /* keep the original failure */ }
    }
  }
  if (redirected) {
    logger.info({ leadId: o.leadId, key: o.key, ok: res.success }, "[he-send] test redirect, nothing recorded");
    return res.success ? { status: "sent", messageId: "", providerMessageId: res.message_id ?? "" } : { status: "failed", error: String(res.error ?? "unknown") };
  }
  const [idr] = await db.execute<RowDataPacket[]>("SELECT UUID() AS id");
  const messageId = idr[0].id as string;
  await db.execute(
    `INSERT INTO he_message (id, lead_id, mobile10, direction, channel, template_key, body, provider_message_id, delivery_status, error_message, requisition_id, drive_id${o.sentBy ? ", sent_by" : ""}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?${o.sentBy ? ",?" : ""})`,
    [messageId, o.leadId, lead.mobile10, "out", "whatsapp", `${o.key}:${lang}`, body.slice(0, 2000), res.success ? res.message_id ?? null : null, res.success ? "sent" : "failed", res.success ? null : String(res.error ?? "").slice(0, 500), m?.requisition_id ?? o.requisitionId ?? null, m?.drive_id ?? null, ...(o.sentBy ? [o.sentBy] : [])]);
  if (!res.success) {
    await addEvent(o.leadId, "send_failed", { channel: "whatsapp", detail: `${o.key}: ${res.error}`, driveId: m?.drive_id });
    logger.warn({ leadId: o.leadId, key: o.key, error: res.error }, "[he-send] failed");
    return { status: "failed", error: String(res.error ?? "unknown") };
  }
  await addEvent(o.leadId, `sent_${o.key}`, { channel: "whatsapp", driveId: m?.drive_id, detail: `${lang}${basis === "applicant" ? " (no opt-in needed by policy)" : ""}${fellBack ? " (sent as the appointment-confirmation template)" : ""}` });
  await db.execute("UPDATE he_lead SET last_contact_at = NOW() WHERE id = ?", [o.leadId]);
  const after = LEAD_STATUS_AFTER[o.key];
  if (after && ["new", "contacted", "interested", "declined", "no_show"].includes(String(lead.status))) await setLeadStatus(o.leadId, after);
  return { status: "sent", messageId, providerMessageId: res.message_id ?? "" };
}
