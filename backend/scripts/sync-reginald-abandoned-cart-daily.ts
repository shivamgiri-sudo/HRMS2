/**
 * Runs the live dialer_db -> mas_hrms sync for
 * reginald_abandoned_cart_daily_actual (sql/1726). See
 * reginald-abandoned-cart-sync.service.ts for what this reads and why.
 *
 * Run with: npx tsx scripts/sync-reginald-abandoned-cart-daily.ts
 */
import "dotenv/config";
import { syncReginaldAbandonedCartDaily } from "../src/modules/reporting/reginald-abandoned-cart-sync.service.js";

async function main() {
  const result = await syncReginaldAbandonedCartDaily("demo-super-admin-id", 30);
  console.log("[SYNC] reginald_abandoned_cart_daily_actual:", JSON.stringify(result, null, 2));
  if (result.error) process.exit(1);
  process.exit(0);
}
main().catch((e) => { console.error("[SYNC] FAILED", e); process.exit(1); });
