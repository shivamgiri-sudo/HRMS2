/** Who are the people who registered at a branch today, and do any of them match an invitee by e-mail or name? STRICTLY READ-ONLY. Names are never printed. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
const run = async (label: string, sql: string) => { try { const [r] = await db.execute<RowDataPacket[]>(sql); console.log(`== ${label} (${r.length})`); r.slice(0, 40).forEach((x) => console.log(JSON.stringify(x))); } catch (e) { console.log(`== ${label} FAILED ${(e as Error).message.slice(0, 220)}`); } };
const M = "RIGHT(REGEXP_REPLACE(ac.mobile,'[^0-9]',''),10)";
const NAME = (c: string) => `LOWER(REGEXP_REPLACE(${c}, '[^a-zA-Z]', ''))`;
(async () => {
  await run("walk-ins since 10-08 by source column", `SELECT ac.walk_in_date d, COALESCE(NULLIF(ac.source,''),'(blank)') source, COUNT(*) n FROM ats_candidate ac WHERE ac.walk_in_date >= '2026-10-08' GROUP BY d, source ORDER BY d DESC, n DESC`);
  await run("walk-ins since 10-08 matched to an invitee by e-mail (he_lead or meta fill), mobile not matched", `SELECT ac.walk_in_date d, COUNT(*) n FROM ats_candidate ac
      WHERE ac.walk_in_date >= '2026-10-08' AND ac.email IS NOT NULL AND ac.email <> ''
        AND NOT EXISTS (SELECT 1 FROM he_lead l WHERE l.mobile10 = ${M} COLLATE utf8mb4_unicode_ci)
        AND (EXISTS (SELECT 1 FROM he_lead l WHERE LOWER(l.email) = LOWER(ac.email)) OR EXISTS (SELECT 1 FROM meta_lead_raw r WHERE LOWER(r.parsed_email) = LOWER(ac.email)))
      GROUP BY d ORDER BY d DESC`);
  await run("walk-ins since 10-08 matched to an invitee by full name only (mobile and e-mail not matched)", `SELECT ac.walk_in_date d, COUNT(*) n FROM ats_candidate ac
      WHERE ac.walk_in_date >= '2026-10-08' AND ${NAME("ac.full_name")} <> ''
        AND NOT EXISTS (SELECT 1 FROM he_lead l WHERE l.mobile10 = ${M} COLLATE utf8mb4_unicode_ci)
        AND (SELECT COUNT(*) FROM he_lead l WHERE ${NAME("l.full_name")} = ${NAME("ac.full_name")}) = 1
      GROUP BY d ORDER BY d DESC`);
  await run("invitees with a booking on a past day (since 10-08) by match state: how many have ANY ATS record after the slot day", `SELECT m.state, COUNT(DISTINCT l.id) people,
      SUM(EXISTS (SELECT 1 FROM ats_candidate ac WHERE ${M} = l.mobile10 COLLATE utf8mb4_unicode_ci AND ac.walk_in_date >= DATE(m.slot_at))) with_ats_after
      FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.slot_at >= '2026-10-08' AND m.slot_at < DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)) GROUP BY m.state`);
  await db.end?.();
})();
