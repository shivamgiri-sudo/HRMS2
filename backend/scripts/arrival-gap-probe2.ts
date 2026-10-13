/** The people who registered at a branch (ATS walk-in) since 2026-10-08: are they linked to a follow-up row and a booking, and in what state? STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
const run = async (label: string, sql: string) => { try { const [r] = await db.execute<RowDataPacket[]>(sql); console.log(`== ${label} (${r.length})`); r.slice(0, 60).forEach((x) => console.log(JSON.stringify(x))); } catch (e) { console.log(`== ${label} FAILED ${(e as Error).message.slice(0, 220)}`); } };
const M = "RIGHT(REGEXP_REPLACE(ac.mobile,'[^0-9]',''),10)";
(async () => {
  await run("walk-ins per day: in he_lead / follow-up / any match / match state", `SELECT ac.walk_in_date d, COUNT(*) walkins,
      SUM(EXISTS (SELECT 1 FROM he_lead l WHERE l.mobile10 = ${M} COLLATE utf8mb4_unicode_ci)) in_he_lead,
      SUM(EXISTS (SELECT 1 FROM qualified_followup q WHERE q.mobile10 = ${M} COLLATE utf8mb4_unicode_ci)) in_followup,
      SUM(EXISTS (SELECT 1 FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE l.mobile10 = ${M} COLLATE utf8mb4_unicode_ci)) with_match,
      SUM(EXISTS (SELECT 1 FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE l.mobile10 = ${M} COLLATE utf8mb4_unicode_ci AND m.state IN ('arrived','selected'))) match_arrived,
      SUM(EXISTS (SELECT 1 FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE l.mobile10 = ${M} COLLATE utf8mb4_unicode_ci AND m.state = 'no_show')) match_no_show,
      SUM(EXISTS (SELECT 1 FROM meta_lead_raw r WHERE RIGHT(REGEXP_REPLACE(r.parsed_phone,'[^0-9]',''),10) = ${M} COLLATE utf8mb4_unicode_ci)) meta_fill
      FROM ats_candidate ac WHERE ac.walk_in_date >= '2026-10-08' GROUP BY d ORDER BY d DESC`);
  await run("today's walk-ins with a match: state of the match whose slot is today", `SELECT m.state, COUNT(*) n, SUM(m.slot_at IS NOT NULL) with_slot FROM ats_candidate ac JOIN he_lead l ON l.mobile10 = ${M} COLLATE utf8mb4_unicode_ci
      JOIN he_match m ON m.lead_id = l.id AND DATE(m.slot_at) = ac.walk_in_date WHERE ac.walk_in_date = DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)) GROUP BY m.state`);
  await run("arrival sync: when did he_match.state become arrived (last 5 days), by day", `SELECT DATE(DATE_ADD(updated_at, INTERVAL 330 MINUTE)) d, state, COUNT(*) n FROM he_match WHERE state IN ('arrived','selected') AND updated_at >= DATE_SUB(NOW(), INTERVAL 5 DAY) GROUP BY d, state ORDER BY d DESC`);
  await db.end?.();
})();
