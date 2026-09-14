/**
 * Runs the live dialer_db -> mas_hrms sync for
 * bla_bli_blu_cdr_daily_actual (sql/1728). See bla-bli-blu-cdr-sync.service.ts
 * for what this reads and why.
 *
 * Run with: npx tsx scripts/sync-bla-bli-blu-cdr-daily.ts
 */
import "dotenv/config";
import { syncBlaBliBluCdrDaily } from "../src/modules/reporting/bla-bli-blu-cdr-sync.service.js";

async function main() {
  const result = await syncBlaBliBluCdrDaily("demo-super-admin-id", 30);
  console.log("[SYNC] bla_bli_blu_cdr_daily_actual:", JSON.stringify(result, null, 2));
  if (result.error) process.exit(1);
  process.exit(0);
}
main().catch((e) => { console.error("[SYNC] FAILED", e); process.exit(1); });
