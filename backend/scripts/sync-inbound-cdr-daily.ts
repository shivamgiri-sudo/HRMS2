/**
 * Runs the live dialer_db -> mas_hrms sync for inbound_cdr_daily_actual
 * (sql/1712). See inbound-cdr-sync.service.ts for what this reads and why.
 *
 * Run with: npx tsx scripts/sync-inbound-cdr-daily.ts
 */
import "dotenv/config";
import { syncInboundCdrDaily } from "../src/modules/reporting/inbound-cdr-sync.service.js";

async function main() {
  const result = await syncInboundCdrDaily("demo-super-admin-id", 30);
  console.log("[SYNC] inbound_cdr_daily_actual:", JSON.stringify(result.clientResults, null, 2));
  const failed = Object.entries(result.clientResults).filter(([, r]) => r.error);
  if (failed.length) {
    console.error("[SYNC] Failures:", failed.map(([code]) => code).join(", "));
    process.exit(1);
  }
  process.exit(0);
}
main().catch((e) => { console.error("[SYNC] FAILED", e); process.exit(1); });
