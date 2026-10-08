/**
 * Two more gaps from the unused-fields scan, both on GNC's already-built,
 * well-documented sources (GNC_ALLOCATION, GNC_SALES) -- unlike the
 * opening-success fields, these are plain structural counts/sums with no AI
 * scoring involved, so there is no data-quality trap to check for here.
 *
 * - GNC_ALLOCATION.same_day_connected existed with no definition: a real lead-
 *   responsiveness metric (leads connected the same day they were allocated).
 * - GNC_SALES.revenue_ex_gst existed with no definition: GST-exclusive revenue,
 *   distinct from the existing REVENUE metric (which reads gross_amount,
 *   GST-inclusive).
 *
 * Run with: npx tsx scripts/add-gnc-samedayconnect-and-revenue-exgst.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { saveDefinition, createMetric } from "../src/modules/kpi/kpi-studio.service.js";
import type { RowDataPacket } from "mysql2";

const GNC_PROCESS_ID = "05073ef4-67ba-11f1-adb1-00155d0ab410";
const GNC_ALLOCATION_SOURCE_ID = "1ebb1fd8-e9c0-4767-9b41-0fcd9be9ea67";
const GNC_SALES_SOURCE_ID = "93ed3cad-c342-4950-901e-40c354bab9e8";
const CREATED_BY = "demo-super-admin-id";

async function ensureMetric(code: string, name: string, unit: string, direction: "higher_is_better" | "lower_is_better") {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`, [code]);
  if (rows.length) return String(rows[0].id);
  const created = await createMetric({ metric_code: code, metric_name: name, unit, direction } as never);
  return String((created as { id: string }).id);
}

async function main() {
  const sameDayId = await ensureMetric("SAME_DAY_CONNECT_PCT", "Same-day connect rate", "pct", "higher_is_better");
  await saveDefinition({
    metric_id: sameDayId, grain: "process", process_id: GNC_PROCESS_ID,
    data_source_id: GNC_ALLOCATION_SOURCE_ID, formula_expression: "PCT(same_day_connected, allocated)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  console.log("SAME_DAY_CONNECT_PCT wired for GNC");

  const revenueExGstId = await ensureMetric("REVENUE_EX_GST", "Revenue excluding GST", "currency", "higher_is_better");
  await saveDefinition({
    metric_id: revenueExGstId, grain: "process", process_id: GNC_PROCESS_ID,
    data_source_id: GNC_SALES_SOURCE_ID, formula_expression: "revenue_ex_gst",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  console.log("REVENUE_EX_GST wired for GNC");

  process.exit(0);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
