/**
 * Takes people off a walk-in when the records already say they live somewhere else. For every open live journey it reads where the person
 * lives (locality, ATS addresses, Meta form location, profile, recruiter-call locations: never the job's own branch) and applies the same
 * rule the line-up and enrolment use (locationVerdict). Only "elsewhere" stops a journey; no place on file is left alone. Bounded per pass
 * and rotating through the open journeys, so a large list is covered over a few passes. Never throws.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { locationVerdict, RESIDENCE_SQL } from "./he-location-match.js";
import { markLocationElsewhere } from "./location-elsewhere.service.js";

const PAGE = 1500;
let cursor = "";

export interface LocationSweepReport { checked: number; stopped: number; wrapped: boolean }

export async function sweepLocationElsewhere(): Promise<LocationSweepReport> {
  const rep: LocationSweepReport = { checked: 0, stopped: 0, wrapped: false };
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT qf.id, qf.mobile10, bm.branch_name AS branch, bm.city AS city, bm.state AS state, ${RESIDENCE_SQL} AS residence
         FROM qualified_followup qf
         JOIN job_requisition jr ON jr.id = qf.requisition_id
         LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
         JOIN he_lead l ON l.mobile10 = qf.mobile10 COLLATE utf8mb4_unicode_ci
         LEFT JOIN ats_candidate ac ON ac.id = l.ats_candidate_id
         LEFT JOIN meta_lead_raw mr ON mr.id = l.meta_lead_id
         LEFT JOIN he_lead_profile lp ON lp.lead_id = l.id
        WHERE qf.mode_at_enqueue = 'live' AND qf.stopped_reason IS NULL AND qf.journey_state NOT IN ('arrived','confirmed','reminded') AND qf.id > ?
        ORDER BY qf.id LIMIT ${PAGE}`, [cursor]);
    if (!rows.length) { cursor = ""; rep.wrapped = true; return rep; }
    cursor = String(rows[rows.length - 1].id);
    const stop = new Map<string, string>();
    for (const r of rows) {
      rep.checked++;
      const text = String(r.residence ?? "").trim();
      if (!text) continue;
      const v = locationVerdict(text, r.branch ? String(r.branch) : null, r.city ? String(r.city) : null, r.state ? String(r.state) : null);
      if (v === "elsewhere") stop.set(String(r.mobile10), text.slice(0, 40));
    }
    for (const [mobile, text] of stop) {
      const o = await markLocationElsewhere(mobile, { city: text, actor: "location-sweep" });
      if (o.journeysStopped) rep.stopped++;
    }
    if (rep.stopped) logger.info({ ...rep }, "[location-sweep] people taken off walk-ins in another city");
  } catch (err) {
    logger.warn({ err: (err as Error).message.slice(0, 140) }, "[location-sweep] failed");
  }
  return rep;
}
