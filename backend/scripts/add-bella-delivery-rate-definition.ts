/**
 * BELLA_SALES.delivered existed with no definition using it -- found by the
 * unused-fields scan. current_status distribution confirms real, varied data
 * (18,214 DELIVERED of 23,391 total, ~78%, plus RTD/RTO/LOST/DAMAGED etc. --
 * a genuine operational split, not a stuck flag). No competing metric exists.
 *
 * Run with: npx tsx scripts/add-bella-delivery-rate-definition.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { saveDefinition, createMetric } from "../src/modules/kpi/kpi-studio.service.js";
import type { RowDataPacket } from "mysql2";

const BELLA_VITA_PROCESS_ID = "050b7ba8-67ba-11f1-adb1-00155d0ab410";
const BELLA_SALES_SOURCE_ID = "38f5462b-baa1-4bfb-924b-1d97a3166f8c";
const CREATED_BY = "demo-super-admin-id";

async function ensureMetric(code: string, name: string, unit: string, direction: "higher_is_better" | "lower_is_better") {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`, [code]);
  if (rows.length) return String(rows[0].id);
  const created = await createMetric({ metric_code: code, metric_name: name, unit, direction } as never);
  return String((created as { id: string }).id);
}

async function main() {
  const metricId = await ensureMetric("DELIVERY_RATE_PCT", "Order delivery rate", "pct", "higher_is_better");
  const def = await saveDefinition({
    metric_id: metricId, grain: "process", process_id: BELLA_VITA_PROCESS_ID,
    data_source_id: BELLA_SALES_SOURCE_ID, formula_expression: "PCT(delivered, sales)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  console.log("created:", JSON.stringify(def));
  process.exit(0);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
