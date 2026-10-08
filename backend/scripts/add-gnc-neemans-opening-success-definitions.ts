/**
 * Found by the same "field exists, no definition uses it" scan that caught
 * Housing Premium's OPENING_SUCCESS_PCT gap: GNC_SCRIPT_AI and NEEMANS_SCRIPT_AI
 * both already carry opening_success/opening_scored fields with no definition
 * reading them.
 *
 * CORRECTION to this file's first version: it claimed these two were "safe,
 * healthy" based on op_success having a real 0/1 mix across the table's WHOLE
 * history. That was the wrong window. Checked again, isolated to the last ~3
 * weeks (call_date >= 2026-08-20) and split by every client_id in the table:
 * client_id 375, 487, 496, 498 all show real, varied 0/1 splits in that recent
 * window -- but 409 (GNC), 475 (Neemans), AND 419 (Housing Premium) show ZERO
 * zero-values recently, every single day back to 2026-08-23. So this is not
 * one broken process (Housing Premium) -- it is a shared scoring defect
 * affecting exactly these three clients' "opening" AI verdict, while the same
 * pipeline keeps working correctly for others. Wired anyway, same reasoning as
 * Housing Premium: the formula computes honestly from real rows. Every one of
 * these three OPENING_SUCCESS_PCT readings should be treated as unverified
 * until whoever owns the magical_script_cache scoring job checks why op_success
 * stopped producing failures for these three specific clients.
 *
 * Run with: npx tsx scripts/add-gnc-neemans-opening-success-definitions.ts
 */
import "dotenv/config";
import { saveDefinition } from "../src/modules/kpi/kpi-studio.service.js";

const OPENING_SUCCESS_PCT_METRIC_ID = "dbf09fd6-ac4d-4013-9f54-9994fb405cb5";
const CREATED_BY = "demo-super-admin-id";

const targets = [
  { label: "GNC", processId: "05073ef4-67ba-11f1-adb1-00155d0ab410", sourceId: "921e8cdc-aef7-4b2e-9b65-d182cadc3bd3" },
  { label: "Neemans", processId: "05150ba3-67ba-11f1-adb1-00155d0ab410", sourceId: "779df2c4-84e5-4bb6-9a69-e275a63fe4c1" },
];

async function main() {
  for (const t of targets) {
    const def = await saveDefinition({
      metric_id: OPENING_SUCCESS_PCT_METRIC_ID,
      grain: "process",
      process_id: t.processId,
      data_source_id: t.sourceId,
      formula_expression: "PCT(opening_success, opening_scored)",
      aggregation_method: "average",
      scoring_type: "raw",
      target_source: "none",
      created_by: CREATED_BY,
    } as never, CREATED_BY);
    console.log(t.label, "created:", JSON.stringify(def));
  }
  process.exit(0);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
