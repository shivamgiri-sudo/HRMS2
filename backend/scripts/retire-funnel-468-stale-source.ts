/**
 * FUNNEL_468 ("Conversation funnel — Clovia") had 5 source fields (calls,
 * offered, opened, scored, sold) with no definition ever using any of them --
 * found by scanning for source fields no active definition references
 * (checked both primary and multi-source kpi_studio_definition_source links,
 * so this was not a false positive from that join).
 *
 * Investigated rather than just wired up, because the fields also had NO
 * client_id filter at all -- unlike GNC_SCRIPT_AI/NEEMANS_SCRIPT_AI/
 * HOUSING_PREMIUM_SCRIPT_AI, which all filter db_masmis.magical_script_cache
 * by their own client_id. Confirmed client_id=468 in that table IS Clovia
 * (agent MAS56096 appears in both client_id=468's rows and
 * dialer_db.cdr_in_250, Clovia's live CDR table) -- so the missing filter
 * alone would have been a one-line fix.
 *
 * But client_id=468's data itself is dead: MAX(call_date) = 2025-06-03,
 * 15 months stale, against 11,370 total rows that stopped growing. Fixing the
 * filter and wiring it up would have shipped a frozen "Clovia funnel" metric
 * that silently never updates -- worse than the gap it would have filled.
 * Retired the source instead of completing it (deleteDataSource refuses when
 * an active definition depends on the source; none did here, since nothing
 * ever used these fields).
 *
 * Run with: npx tsx scripts/retire-funnel-468-stale-source.ts
 */
import "dotenv/config";
import { deleteDataSource } from "../src/modules/kpi/kpi-studio.service.js";

const FUNNEL_468_SOURCE_ID = "d6c63ac9-ab56-11f1-8f5c-00155d0ab410";

async function main() {
  const result = await deleteDataSource(FUNNEL_468_SOURCE_ID);
  console.log("retired:", JSON.stringify(result));
  process.exit(0);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
