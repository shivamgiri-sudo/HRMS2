/**
 * DU_KOREA_THAILAND_CDR's handle_seconds field (added in
 * seed-du-korea-and-lp-kpi-sources.ts) had no definition using it -- found by
 * the same unused-fields scan that caught the GNC/Neemans/Housing Premium
 * opening-success gaps.
 *
 * A separate metric, not the shared AHT: DU Digital already has AHT scoped to
 * DU_INBOUND_CDR (DU_Bangladesh_* only). saveDefinition upserts by
 * (metric_id, scope), so a second AHT definition for the same process+metric
 * would silently close the Bangladesh one instead of the two coexisting.
 *
 * Run with: npx tsx scripts/add-du-korea-thailand-aht-definition.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { saveDefinition, createMetric } from "../src/modules/kpi/kpi-studio.service.js";
import type { RowDataPacket } from "mysql2";

async function ensureMetric(code: string, name: string, unit: string, direction: "higher_is_better" | "lower_is_better") {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`, [code]);
  if (rows.length) return String(rows[0].id);
  const created = await createMetric({ metric_code: code, metric_name: name, unit, direction } as never);
  return String((created as { id: string }).id);
}

async function main() {
  const metricId = await ensureMetric(
    "DU_KOREA_THAILAND_AHT", "DU Korea/Thailand average handle time", "seconds", "lower_is_better",
  );
  const def = await saveDefinition({
    metric_id: metricId, grain: "process", process_id: "050cc297-67ba-11f1-adb1-00155d0ab410",
    data_source_id: "fa799157-abbb-11f1-8f5c-00155d0ab410", formula_expression: "SAFE_DIV(handle_seconds, answered)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: "demo-super-admin-id",
  } as never, "demo-super-admin-id");
  console.log("created:", JSON.stringify(def));
  process.exit(0);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
