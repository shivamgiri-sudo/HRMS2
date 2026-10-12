/**
 * A person who is not in the branch's city: their journeys for it stop with the reason ineligible_location_elsewhere and any slot they hold
 * is released (state declined). Used when a candidate says so in a reply, and by an admin who knows (POST /qualified-followup/:id/not-my-city).
 * Nothing is sent from here. Never throws.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { addEvent } from "./he-lead.service.js";

export const ELSEWHERE_REASON = "ineligible_location_elsewhere";

export async function markLocationElsewhere(mobile10: string, o: { city?: string | null; actor: string }): Promise<{ journeysStopped: number; bookingsReleased: number }> {
  const out = { journeysStopped: 0, bookingsReleased: 0 };
  try {
    const [j] = await db.execute<any>(
      `UPDATE qualified_followup SET stopped_reason = ?, stopped_at = NOW(), journey_state = 'stopped'
        WHERE mobile10 = ? AND stopped_reason IS NULL AND mode_at_enqueue = 'live'`, [ELSEWHERE_REASON, mobile10]);
    out.journeysStopped = Number(j?.affectedRows ?? 0);
    const [m] = await db.execute<RowDataPacket[]>(
      `SELECT m.id, m.lead_id FROM he_match m JOIN he_lead l ON l.id = m.lead_id
        WHERE l.mobile10 = ? AND m.state IN ('invited','confirmed') AND (m.slot_at IS NULL OR m.slot_at > NOW())`, [mobile10]);
    for (const r of m) {
      const [u] = await db.execute<any>("UPDATE he_match SET state = 'declined' WHERE id = ? AND state IN ('invited','confirmed')", [r.id]);
      if (Number(u?.affectedRows ?? 0)) {
        out.bookingsReleased++;
        await addEvent(String(r.lead_id), "location_elsewhere", { channel: "email", detail: `lives in ${o.city ? o.city.slice(0, 60) : "another city"}: slot released`, actor: o.actor }).catch(() => undefined);
      }
    }
    logger.info({ ...out }, "[location-elsewhere] journeys stopped");
  } catch (err) {
    logger.warn({ err: (err as Error).message.slice(0, 120) }, "[location-elsewhere] failed");
  }
  return out;
}
