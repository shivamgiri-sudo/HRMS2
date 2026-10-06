/**
 * WhatsApp bot: when a candidate asks something the reply parser does not treat as confirm / reschedule / decline /
 * opt-out, answer common questions (address, documents, timing, salary, job, HR contact) from their own invitation.
 * The candidate just wrote, so the 24h WhatsApp session is open and free text is allowed. Anything we cannot answer
 * from stored facts is handed to a human. HE_BOT_ENABLED=false or the global pause switch turns answers off.
 */
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { PinbotWhatsAppProvider } from "../communication/providers/whatsapp/pinbot.provider.js";
import { addEvent } from "./he-lead.service.js";
import { detectFaq, faqAnswer, salaryText } from "./he-faq.js";
import { dateLabel, langFor, sendsPaused, timeLabel } from "./he-send.service.js";
import { displayFirstName } from "./he-name.js";

const pinbot = new PinbotWhatsAppProvider();
const env = (k: string, d: string) => (process.env[k]?.trim() ? process.env[k]!.trim() : d);

export type BotOutcome = { action: "answered"; kind: string } | { action: "handoff"; reason: string } | { action: "skipped"; reason: string };

export async function answerCandidateQuestion(leadId: string, text: string, o: { dryRun?: boolean } = {}): Promise<BotOutcome> {
  const kind = detectFaq(text);
  const handoff = async (reason: string): Promise<BotOutcome> => {
    await addEvent(leadId, "needs_human_followup", { channel: "whatsapp", detail: `candidate asked: ${text.slice(0, 200)}` });
    return { action: "handoff", reason };
  };
  if (!kind) return handoff("not_a_known_question");
  if (process.env.HE_BOT_ENABLED === "false" || sendsPaused()) return { action: "skipped", reason: "bot_off" };
  const [lr] = await db.execute<RowDataPacket[]>(
    `SELECT l.mobile10, l.full_name, l.status, i.language_pref FROM he_lead l LEFT JOIN he_lead_insight i ON i.lead_id = l.id WHERE l.id = ? LIMIT 1`, [leadId]);
  const lead = lr[0];
  if (!lead || lead.status === "opted_out") return { action: "skipped", reason: "opted_out" };
  const [recent] = await db.execute<RowDataPacket[]>(
    "SELECT 1 FROM he_message WHERE lead_id = ? AND direction = 'out' AND template_key = ? AND created_at > DATE_SUB(NOW(), INTERVAL 6 HOUR) LIMIT 1", [leadId, `faq:${kind}`]);
  if (recent.length) return handoff("same_question_again");
  const [mr] = await db.execute<RowDataPacket[]>(
    `SELECT m.slot_at, d.drive_date, jr.designation_name, jr.branch_name, jr.salary_min, jr.salary_max, bm.address, bm.latitude, bm.longitude
       FROM he_match m JOIN job_requisition jr ON jr.id = m.requisition_id LEFT JOIN he_drive d ON d.id = m.drive_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE m.lead_id = ? ORDER BY (m.state IN ('invited','confirmed')) DESC, m.updated_at DESC LIMIT 1`, [leadId]);
  const m = mr[0];
  const slot = m?.slot_at ? String(m.slot_at) : null;
  const answer = faqAnswer(kind, {
    firstName: displayFirstName(lead.full_name), role: m?.designation_name ?? null, company: env("HE_COMPANY_NAME", "MAS Callnet"),
    branch: m?.branch_name ?? null, address: m?.address ?? null,
    maps: m?.latitude != null && m?.longitude != null ? `https://maps.google.com/?q=${m.latitude},${m.longitude}` : m?.address ? `https://maps.google.com/?q=${encodeURIComponent(String(m.address))}` : null,
    dateLabel: m?.drive_date ? dateLabel(String(m.drive_date)) : slot ? dateLabel(slot) : null, timeLabel: slot ? timeLabel(slot) : null,
    docs: env("HE_DOCS_LIST", "Aadhaar, PAN, 12th marksheet"), salaryText: salaryText(m?.salary_min ? Number(m.salary_min) : null, m?.salary_max ? Number(m.salary_max) : null),
    contact: [env("HE_HR_CONTACT_NAME", ""), env("HE_HR_CONTACT_PHONE", "")].filter(Boolean).join(" ") || null, lang: langFor(lead.language_pref as string | null),
  });
  if (!answer) return handoff(`no_${kind}_on_record`);
  if (o.dryRun) return { action: "answered", kind };
  if (!pinbot.isConfigured()) return { action: "skipped", reason: "whatsapp_not_configured" };
  const res = await pinbot.send(String(lead.mobile10), "", answer);
  await db.execute(
    "INSERT INTO he_message (id, lead_id, mobile10, direction, channel, template_key, body, provider_message_id, delivery_status, error_message) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [randomUUID(), leadId, lead.mobile10, "out", "whatsapp", `faq:${kind}`, answer.slice(0, 2000), res.success ? res.message_id ?? null : null, res.success ? "sent" : "failed", res.success ? null : String(res.error ?? "").slice(0, 480)]);
  if (!res.success) { logger.warn({ leadId, error: res.error }, "[he-bot] reply failed"); return handoff("send_failed"); }
  await addEvent(leadId, "bot_answered", { channel: "whatsapp", detail: kind });
  return { action: "answered", kind };
}
