/**
 * ROSTER_ONFIDO had 3 source fields (acknowledged, published, scheduled_minutes_sum)
 * and zero active definitions -- found by the unused-fields scan.
 *
 * Investigated rather than wired up: ROSTER_ACK_PCT and SHIFT_MINUTES_AVG
 * (the metrics these fields obviously exist for) already work, org-wide,
 * against a DIFFERENT source -- ROSTER_SHARED -- which reads the exact same
 * table (wfm_roster_assignment), the exact same employee key column
 * (employee_id) and the exact same date column (roster_date). ROSTER_ONFIDO
 * is a pre-existing, byte-for-byte duplicate that never got used once
 * ROSTER_SHARED shipped -- exactly the "two competing sources of truth"
 * pattern this project's CLAUDE.md forbids. Retired rather than completed.
 *
 * Run with: npx tsx scripts/retire-roster-onfido-duplicate-source.ts
 */
import "dotenv/config";
import { deleteDataSource } from "../src/modules/kpi/kpi-studio.service.js";

const ROSTER_ONFIDO_SOURCE_ID = "2ac8e0ee-ab32-11f1-8f5c-00155d0ab410";

async function main() {
  const result = await deleteDataSource(ROSTER_ONFIDO_SOURCE_ID);
  console.log("retired:", JSON.stringify(result));
  process.exit(0);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
