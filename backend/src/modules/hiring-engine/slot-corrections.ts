/**
 * Slot corrections: a person who was emailed an invitation for one drive day and whose booking was later moved to another drive (the
 * nearest working day, a requisition end date, a holiday) is sent the new slot: the invitation email for the new drive (the email core
 * keeps one invite per drive) and, once, the approved "new appointment slot" WhatsApp (he_reschedule_offer, transactional: STOP and
 * opt-out still win). Derived from the data, so no flag has to be kept and a later move corrects itself the same way.
 * Runs inside the follow-up worker for live rows only, 09:00-20:00 IST, a few at a time. Never throws.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { sendInviteEmail } from "./he-email.service.js";
import { sendTemplateToLead } from "./he-send.service.js";

const IST_MS = 5.5 * 3600_000;
const PER_TICK = 40;
const INVITE_KEY = "he_walkin_invite_email";

/** Matches that were emailed for another drive and not yet for the one they now hold. */
export const DUE_SQL = `
  SELECT m.id AS match_id, m.lead_id, m.requisition_id, m.drive_id FROM he_match m JOIN he_lead l ON l.id = m.lead_id
   WHERE m.state = 'invited' AND m.slot_at > ? AND m.drive_id IS NOT NULL AND l.status <> 'opted_out'
     AND EXISTS (SELECT 1 FROM he_message x WHERE x.lead_id = m.lead_id AND x.requisition_id = m.requisition_id AND x.template_key = '${INVITE_KEY}'
                   AND x.direction = 'out' AND x.delivery_status <> 'failed' AND NOT (x.drive_id <=> m.drive_id))
     AND NOT EXISTS (SELECT 1 FROM he_message y WHERE y.lead_id = m.lead_id AND y.requisition_id = m.requisition_id AND y.template_key = '${INVITE_KEY}'
                   AND y.direction = 'out' AND y.delivery_status <> 'failed' AND y.drive_id <=> m.drive_id)
   ORDER BY m.slot_at, m.id LIMIT ${PER_TICK}`;

export const inCorrectionWindow = (now: Date): boolean => {
  const h = new Date(now.getTime() + IST_MS).getUTCHours();
  return h >= 9 && h < 20;
};

export async function runSlotCorrections(now: Date, deps: { email?: typeof sendInviteEmail; wa?: typeof sendTemplateToLead } = {}): Promise<{ due: number; emailed: number; whatsapp: number }> {
  const out = { due: 0, emailed: 0, whatsapp: 0 };
  if (!inCorrectionWindow(now)) return out;
  const email = deps.email ?? sendInviteEmail, wa = deps.wa ?? sendTemplateToLead;
  try {
    const stamp = new Date(now.getTime() + IST_MS).toISOString().slice(0, 19).replace("T", " ");
    const [rows] = await db.execute<RowDataPacket[]>(DUE_SQL, [stamp]);
    out.due = rows.length;
    for (const r of rows) {
      try {
        const e = await email(String(r.match_id));
        if (e.status === "sent") out.emailed++;
        const [dup] = await db.execute<RowDataPacket[]>(
          "SELECT 1 FROM he_message WHERE lead_id = ? AND requisition_id = ? AND drive_id <=> ? AND template_key LIKE 'he_reschedule_offer:%' AND direction = 'out' AND delivery_status <> 'failed' LIMIT 1",
          [r.lead_id, r.requisition_id, r.drive_id]);
        if (!dup.length) {
          const w = await wa({ leadId: String(r.lead_id), key: "he_reschedule_offer", matchId: String(r.match_id), transactional: true });
          if (w.status === "sent") out.whatsapp++;
        }
      } catch (err) {
        logger.warn({ matchId: r.match_id, err: (err as Error).message.slice(0, 160) }, "[slot-corrections] one correction failed");
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message.slice(0, 160) }, "[slot-corrections] pass failed");
  }
  if (out.emailed || out.whatsapp) logger.info(out, "[slot-corrections] sent");
  return out;
}
