/**
 * Housing Premium's HOUSING_PREMIUM_SCRIPT_AI source (built by another session)
 * already carried opening_success/opening_scored fields but no definition ever
 * used them -- OFFER_SUCCESS_PCT existed, OPENING_SUCCESS_PCT (a metric already
 * shared with Housing Owner) did not. This wires that up.
 *
 * DATA QUALITY FLAG, not a bug in this script: verified live 2026-09-08 that
 * db_masmis.magical_script_cache.op_success for client_id=419 (Housing Premium)
 * has NEVER recorded a 0 across 904 scored calls -- only 1 or NULL. Every other
 * client_id in the same table (375, 409, 468, 471, 475, 477...) shows a normal
 * mix of 0s and 1s. This metric will read a suspicious 100% until whatever AI
 * scoring pipeline populates op_success for this client is checked -- it is
 * wired here because it computes honestly from real rows, not because the
 * number is trustworthy yet.
 *
 * Run with: npx tsx scripts/add-housing-premium-opening-success-definition.ts
 */
import "dotenv/config";
import { saveDefinition } from "../src/modules/kpi/kpi-studio.service.js";

const OPENING_SUCCESS_PCT_METRIC_ID = "dbf09fd6-ac4d-4013-9f54-9994fb405cb5";
const HOUSING_PREMIUM_PROCESS_ID = "01d7f81e-eed0-4bfc-af19-7abeee288ecd";
const HOUSING_PREMIUM_SCRIPT_AI_SOURCE_ID = "1ae3291f-c0b9-448a-a762-1e3c6c8473df";

async function main() {
  const def = await saveDefinition({
    metric_id: OPENING_SUCCESS_PCT_METRIC_ID,
    grain: "process",
    process_id: HOUSING_PREMIUM_PROCESS_ID,
    data_source_id: HOUSING_PREMIUM_SCRIPT_AI_SOURCE_ID,
    formula_expression: "PCT(opening_success, opening_scored)",
    aggregation_method: "average",
    scoring_type: "raw",
    target_source: "none",
    created_by: "demo-super-admin-id",
  } as never, "demo-super-admin-id");
  console.log("created:", JSON.stringify(def));
  process.exit(0);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
