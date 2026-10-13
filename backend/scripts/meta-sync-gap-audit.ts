/**
 * Where do Meta form fills go? Compares form fills per day with what reached the Hiring Engine (he_lead) and the live follow-up
 * (qualified_followup), and splits the fills that did not by reason. STRICTLY READ-ONLY.
 *   npx tsx scripts/meta-sync-gap-audit.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const q = async (label: string, sql: string, params: unknown[] = []) => {
  try {
    const [r] = await db.execute<RowDataPacket[]>(sql, params as never[]);
    console.log(`\n== ${label} (${r.length})`);
    for (const row of r.slice(0, 60)) console.log(JSON.stringify(row));
  } catch (e) { console.log(`\n== ${label}: FAILED ${(e as Error).message.slice(0, 200)}`); }
};
const P = "RIGHT(REGEXP_REPLACE(m.parsed_phone,'[^0-9]',''),10)";

(async () => {
  await q("meta_live cutoff / switches", "SELECT `key`, value FROM he_setting WHERE `key` LIKE '%live%' OR `key` LIKE '%followup%' OR `key` LIKE '%cutoff%' LIMIT 30");
  await q("form fills per IST day, last 10 days", `SELECT DATE(DATE_ADD(m.created_at, INTERVAL 330 MINUTE)) d, COUNT(*) fills, COUNT(DISTINCT ${P}) people,
      SUM(m.screening_result = 'qualified') qualified, SUM(m.requisition_id IS NOT NULL) has_req
      FROM meta_lead_raw m WHERE m.created_at >= DATE_SUB(NOW(), INTERVAL 10 DAY) GROUP BY d ORDER BY d DESC`);
  await q("screening_result values, last 10 days", `SELECT COALESCE(m.screening_result,'(null)') sr, COUNT(*) n FROM meta_lead_raw m WHERE m.created_at >= DATE_SUB(NOW(), INTERVAL 10 DAY) GROUP BY sr ORDER BY n DESC`);
  await q("fills last 10 days: reached he_lead / follow-up", `SELECT DATE(DATE_ADD(m.created_at, INTERVAL 330 MINUTE)) d, COUNT(*) fills,
      SUM(EXISTS (SELECT 1 FROM he_lead l WHERE l.mobile10 = ${P} COLLATE utf8mb4_unicode_ci)) in_he_lead,
      SUM(EXISTS (SELECT 1 FROM qualified_followup f WHERE f.mobile10 = ${P} COLLATE utf8mb4_unicode_ci)) in_followup,
      SUM(EXISTS (SELECT 1 FROM qualified_followup f WHERE f.mobile10 = ${P} COLLATE utf8mb4_unicode_ci AND f.source_type = 'meta_live')) in_followup_live
      FROM meta_lead_raw m WHERE m.created_at >= DATE_SUB(NOW(), INTERVAL 10 DAY) GROUP BY d ORDER BY d DESC`);
  await q("fills NOT in follow-up, by campaign / screening / has requisition (last 10 days)", `SELECT COALESCE(mc.campaign_name,'(no campaign)') campaign, COALESCE(m.screening_result,'(null)') sr,
      m.requisition_id IS NOT NULL has_req, COUNT(*) n
      FROM meta_lead_raw m LEFT JOIN meta_campaign mc ON mc.id = m.campaign_id
      WHERE m.created_at >= DATE_SUB(NOW(), INTERVAL 10 DAY)
        AND NOT EXISTS (SELECT 1 FROM qualified_followup f WHERE f.mobile10 = ${P} COLLATE utf8mb4_unicode_ci)
      GROUP BY campaign, sr, has_req ORDER BY n DESC`);
  await q("follow-up rows by source and journey state", "SELECT source_type, journey_state, COUNT(*) n FROM qualified_followup GROUP BY source_type, journey_state ORDER BY source_type, n DESC");
  await q("follow-up stopped reasons (top 25)", "SELECT source_type, stopped_reason, COUNT(*) n FROM qualified_followup WHERE stopped_reason IS NOT NULL GROUP BY source_type, stopped_reason ORDER BY n DESC LIMIT 25");
  await q("follow-up rows created per IST day by source (last 10 days)", `SELECT DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) d, source_type, COUNT(*) n FROM qualified_followup
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 10 DAY) GROUP BY d, source_type ORDER BY d DESC, source_type`);
  await q("campaigns: leads vs follow-up rows", `SELECT mc.campaign_name, mc.status, (SELECT COUNT(*) FROM meta_lead_raw m WHERE m.campaign_id = mc.id) fills,
      (SELECT COUNT(*) FROM qualified_followup f WHERE f.campaign_id = mc.id) followup_rows FROM meta_campaign mc ORDER BY fills DESC LIMIT 15`);
  await db.end?.();
})();
