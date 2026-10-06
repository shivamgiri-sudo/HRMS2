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
import { buildParams, getTemplate, renderBody, type Lang, type TemplateKey } from "./he-template-catalog.js";
import type { LeadStatus } from "./he-state.js";
import { cleanName, displayFirstName } from "./he-name.js";

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

export async function sendTemplateToLead(o: SendOpts): Promise<SendResult> {
  const [lr] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.mobile10, l.full_name, l.status, l.meta_lead_id, i.language_pref FROM he_lead l LEFT JOIN he_lead_insight i ON i.lead_id = l.id WHERE l.id = ? LIMIT 1`, [o.leadId]);
  const lead = lr[0];
  if (!lead) return { status: "blocked", reason: "lead_not_found" };

  // The Meta campaign flow (lead-outreach.service) already sends its own interview invite to qualified Meta leads.
  // Never send a second first-contact invite to the same person within 3 days of that one.
  if (lead.meta_lead_id && FIRST_CONTACT.has(o.key)) {
    const [mn] = await db.execute<RowDataPacket[]>(
      "SELECT 1 FROM meta_lead_raw WHERE id = ? AND notification_sent_at IS NOT NULL AND notification_sent_at > DATE_SUB(NOW(), INTERVAL 3 DAY) LIMIT 1", [lead.meta_lead_id]);
    if (mn.length) return { status: "blocked", reason: "meta_flow_already_notified" };
  }

  let m: RowDataPacket | undefined;
  if (o.matchId) {
    const [mr] = await db.execute<RowDataPacket[]>(
      `SELECT m.id, m.requisition_id, m.slot_at, m.token, m.state, d.id AS drive_id, d.drive_date, d.status AS drive_status,
              jr.designation_name, jr.branch_name, jr.bmi_assessment_url, jr.approval_status, jr.active_status, jr.requested_headcount, jr.fulfilled_headcount,
              bm.address, bm.latitude, bm.longitude
         FROM he_match m LEFT JOIN he_drive d ON d.id = m.drive_id JOIN job_requisition jr ON jr.id = m.requisition_id
         LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
        WHERE m.id = ? LIMIT 1`, [o.matchId]);
    m = mr[0];
  }
  const requisitionOpen = m ? m.approval_status === "approved" && Boolean(m.active_status) && Number(m.fulfilled_headcount) < Number(m.requested_headcount) : true;

  const [sent] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS today, MAX(created_at) AS last_at FROM he_message
      WHERE lead_id = ? AND direction = 'out' AND channel = 'whatsapp' AND created_at >= CURDATE()`, [o.leadId]);
  const [lastAny] = await db.execute<RowDataPacket[]>("SELECT MAX(created_at) AS last_at FROM he_message WHERE lead_id = ? AND direction = 'out'", [o.leadId]);

  const consent = await hasConsent(o.leadId, "whatsapp_contact");
  const verdict = checkSendAllowed({
    now: new Date(), consent, optedOut: lead.status === "opted_out", paused: sendsPaused() || m?.drive_status === "paused",
    sentToday: o.transactional ? 0 : Number(sent[0].today), lastSentAt: !o.transactional && lastAny[0].last_at ? new Date(String(lastAny[0].last_at).replace(" ", "T") + "+05:30") : null,
    requisitionOpen, ...(o.minGapMinutes ? { minGapMinutes: o.minGapMinutes } : {}),
    ...(o.transactional ? { quietStartHour: 24, quietEndHour: 0 } : {}),
  });
  if (!verdict.ok) return { status: "blocked", reason: verdict.reason };

  // Preferred language first; English is the approved fallback (Hinglish versions are not approved at Meta yet).
  const pref = langFor(lead.language_pref as string | null);
  const [trs] = await db.execute<RowDataPacket[]>(
    "SELECT template_key, pinbot_name, language, approval_state FROM he_template WHERE template_key IN (?, ?) AND approval_state = 'approved' AND pinbot_name IS NOT NULL",
    [`${o.key}:${pref}`, `${o.key}:en`]);
  const tr = [trs.find((t) => t.template_key === `${o.key}:${pref}`) ?? trs.find((t) => t.template_key === `${o.key}:en`)].filter(Boolean) as RowDataPacket[];
  if (!tr[0]) return { status: "blocked", reason: "template_not_approved" };
  const lang: Lang = tr[0].template_key === `${o.key}:${pref}` ? pref : "en";

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
    contact_name: env("HE_HR_CONTACT_NAME", ""), contact_phone: env("HE_HR_CONTACT_PHONE", ""),
    location_token: m?.token, ...o.extra,
  };
  let params: string[];
  try { params = buildParams(o.key, lang, ctx); }
  catch (e) { return { status: "blocked", reason: (e as Error).message }; }
  const body = renderBody(o.key, lang, ctx);

  if (o.dryRun) return { status: "dry_run", body, lang, params };
  if (!pinbot.isConfigured()) return { status: "blocked", reason: "whatsapp_not_configured" };

  const hasUrlButton = getTemplate(o.key).buttons[lang].some((b) => b.startsWith("URL:"));
  const res = await pinbot.sendTemplate(String(lead.mobile10), String(tr[0].pinbot_name), params, String(tr[0].language), hasUrlButton ? String(ctx.location_token ?? "") : undefined);
  const [idr] = await db.execute<RowDataPacket[]>("SELECT UUID() AS id");
  const messageId = idr[0].id as string;
  await db.execute(
    "INSERT INTO he_message (id, lead_id, mobile10, direction, channel, template_key, body, provider_message_id, delivery_status, error_message, requisition_id, drive_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [messageId, o.leadId, lead.mobile10, "out", "whatsapp", `${o.key}:${lang}`, body.slice(0, 2000), res.success ? res.message_id ?? null : null, res.success ? "sent" : "failed", res.success ? null : String(res.error ?? "").slice(0, 500), m?.requisition_id ?? null, m?.drive_id ?? null]);
  if (!res.success) {
    await addEvent(o.leadId, "send_failed", { channel: "whatsapp", detail: `${o.key}: ${res.error}`, driveId: m?.drive_id });
    logger.warn({ leadId: o.leadId, key: o.key, error: res.error }, "[he-send] failed");
    return { status: "failed", error: String(res.error ?? "unknown") };
  }
  await addEvent(o.leadId, `sent_${o.key}`, { channel: "whatsapp", driveId: m?.drive_id, detail: `${lang}` });
  await db.execute("UPDATE he_lead SET last_contact_at = NOW() WHERE id = ?", [o.leadId]);
  const after = LEAD_STATUS_AFTER[o.key];
  if (after && ["new", "contacted", "interested", "declined", "no_show"].includes(String(lead.status))) await setLeadStatus(o.leadId, after);
  return { status: "sent", messageId, providerMessageId: res.message_id ?? "" };
}
