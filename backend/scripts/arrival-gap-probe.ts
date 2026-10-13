/** Do people who were invited and confirmed show up as arrived? Journey states against bookings and ATS walk-in registrations. STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
const run = async (label: string, sql: string) => { try { const [r] = await db.execute<RowDataPacket[]>(sql); console.log(`== ${label} (${r.length})`); r.slice(0, 40).forEach((x) => console.log(JSON.stringify(x))); } catch (e) { console.log(`== ${label} FAILED ${(e as Error).message.slice(0, 220)}`); } };
const M = "RIGHT(REGEXP_REPLACE(ac.mobile,'[^0-9]',''),10)";
(async () => {
  await run("journey states by source (live rows)", `SELECT source_type, journey_state, COUNT(*) n FROM qualified_followup WHERE mode_at_enqueue='live' GROUP BY source_type, journey_state ORDER BY source_type, n DESC`);
  await run("he_match states for follow-up people, by source", `SELECT q.source_type, m.state, COUNT(DISTINCT q.mobile10) people FROM qualified_followup q JOIN he_lead l ON l.mobile10 = q.mobile10 COLLATE utf8mb4_unicode_ci
      JOIN he_match m ON m.lead_id = l.id WHERE q.mode_at_enqueue='live' GROUP BY q.source_type, m.state ORDER BY q.source_type, people DESC`);
  await run("slots by IST day for confirmed bookings of follow-up people (past days)", `SELECT DATE(m.slot_at) d, m.state, COUNT(DISTINCT l.mobile10) people FROM qualified_followup q JOIN he_lead l ON l.mobile10 = q.mobile10 COLLATE utf8mb4_unicode_ci
      JOIN he_match m ON m.lead_id = l.id WHERE q.mode_at_enqueue='live' AND m.slot_at >= '2026-10-06' AND m.slot_at < DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)) + INTERVAL 1 DAY
      GROUP BY d, m.state ORDER BY d DESC, people DESC`);
  await run("ATS walk-in registrations of follow-up people since 2026-10-06 (by ATS stage)", `SELECT ac.current_stage, COUNT(DISTINCT q.mobile10) people FROM qualified_followup q
      JOIN ats_candidate ac ON ${M} = q.mobile10 COLLATE utf8mb4_unicode_ci WHERE q.mode_at_enqueue='live' AND ac.walk_in_date >= '2026-10-06' GROUP BY ac.current_stage ORDER BY people DESC`);
  await run("same people: journey state vs ATS walk-in on/after their enrolment", `SELECT q.source_type, q.journey_state, COUNT(DISTINCT q.mobile10) people FROM qualified_followup q
      JOIN ats_candidate ac ON ${M} = q.mobile10 COLLATE utf8mb4_unicode_ci WHERE q.mode_at_enqueue='live' AND ac.walk_in_date >= DATE(q.created_at) GROUP BY q.source_type, q.journey_state ORDER BY q.source_type, people DESC`);
  await run("walk-ins per IST day registered in ATS from Meta-origin people (reference)", `SELECT ac.walk_in_date d, COUNT(*) n FROM ats_candidate ac WHERE ac.walk_in_date >= '2026-10-06' GROUP BY d ORDER BY d DESC`);
  await db.end?.();
})();
