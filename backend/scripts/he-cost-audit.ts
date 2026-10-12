/** What cost data exists: calls with duration, Meta spend per campaign/branch, configured rates. STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
const q = async (label: string, sql: string) => {
  try { const [r] = await db.execute<RowDataPacket[]>(sql); console.log(`\n== ${label} (${r.length})`); for (const row of r.slice(0, 40)) console.log(JSON.stringify(row)); }
  catch (e) { console.log(`\n== ${label}: FAILED ${(e as Error).message.slice(0, 200)}`); }
};
(async () => {
  await q("cost rates", "SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'cost.%'");
  await q("he_call per IST day (14d): calls, with duration, with requisition, minutes", `SELECT DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) d, COUNT(*) calls, SUM(duration_s > 0) with_dur,
      SUM(requisition_id IS NOT NULL) with_req, SUM(CEIL(COALESCE(duration_s,0)/60)) minutes, ROUND(SUM(COALESCE(duration_s,0))/60,1) exact_min
      FROM he_call WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) GROUP BY d ORDER BY d DESC`);
  await q("he_call columns", "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_call'");
  await q("qualified_followup called (all time) vs he_call rows", `SELECT (SELECT COUNT(*) FROM qualified_followup WHERE call_state = 'called') followup_called,
      (SELECT COUNT(*) FROM he_call) he_calls, (SELECT COUNT(*) FROM he_call WHERE duration_s > 0) he_calls_with_dur`);
  await q("meta_campaign spend", `SELECT mc.id, mc.campaign_name, mc.requisition_id, jr.branch_name, mc.spend_inr, mc.impressions, mc.clicks, mc.last_synced_at FROM meta_campaign mc LEFT JOIN job_requisition jr ON jr.id = mc.requisition_id ORDER BY mc.spend_inr DESC`);
  await q("meta_campaign columns", "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meta_campaign'");
  console.log("\n== env (set or not, never the value)");
  for (const k of ["META_MARKETING_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "META_GRAPH_VERSION", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_CAMPAIGN_SYNC_ENABLED"]) console.log(k, process.env[k] ? "SET" : "unset");
  await q("meta ids / sync errors", "SELECT campaign_name, campaign_status, meta_campaign_id IS NOT NULL AND meta_campaign_id <> '' AS has_campaign_id, meta_adset_id <> '' AS has_adset, meta_form_id <> '' AS has_form, last_sync_error FROM meta_campaign");
  await db.end?.();
})();
