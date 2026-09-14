/**
 * Bella Vita's "Repeat" LOB was flagged as blocked earlier tonight, based on
 * the confirmed-empty db_masmis.bvo_repeat_allocation/bvo_Repeat_allocation
 * tables. That conclusion was about the wrong table: BELLA_SALES's own
 * source_object (db_masmis.bb_sale) already carries a `lob` column whose
 * values include "Repeat" directly -- confirmed live 2026-09-09: 8,788 real
 * rows, same freshness as the rest of bb_sale (stopped 2026-06-29, the known
 * stale-sales gap, not a new problem). The Base reports data dictionary
 * (Downloads/Base reports/_TEMPLATES/DATA_DICTIONARY.md, from this session's
 * earlier Bella Vita SOP work) independently confirms "Repeat customer LOB"
 * as a real LOB value in the same workbook family.
 *
 * Adds two fields to the EXISTING BELLA_SALES source (additive, no new
 * table) and two new metrics, both filtered to lob='Repeat'.
 *
 * Run with: npx tsx scripts/add-bella-repeat-lob-kpi.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { saveSourceField, saveDefinition, createMetric } from "../src/modules/kpi/kpi-studio.service.js";
import type { RowDataPacket } from "mysql2";

const CREATED_BY = "demo-super-admin-id";
const BELLA_SALES_SOURCE_ID = "38f5462b-baa1-4bfb-924b-1d97a3166f8c";
const BELLA_VITA_PROCESS_ID = "050b7ba8-67ba-11f1-adb1-00155d0ab410";

async function ensureMetric(code: string, name: string, unit: string, direction: "higher_is_better" | "lower_is_better") {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`, [code]);
  if (rows.length) return String(rows[0].id);
  const created = await createMetric({ metric_code: code, metric_name: name, unit, direction } as never);
  return String((created as { id: string }).id);
}

async function main() {
  await saveSourceField({
    data_source_id: BELLA_SALES_SOURCE_ID, field_name: "repeat_sales", source_column: "id", aggregate_fn: "COUNT",
    filter_json: [{ column: "lob", op: "eq", value: "Repeat" }],
  } as never);
  await saveSourceField({
    data_source_id: BELLA_SALES_SOURCE_ID, field_name: "repeat_revenue", source_column: "amount", aggregate_fn: "SUM",
    filter_json: [{ column: "lob", op: "eq", value: "Repeat" }],
  } as never);
  console.log("[SEED] BELLA_SALES: repeat_sales / repeat_revenue fields added");

  const salesId = await ensureMetric("BELLA_REPEAT_SALES_COUNT", "Bella-Vita repeat-customer sales", "count", "higher_is_better");
  const revenueId = await ensureMetric("BELLA_REPEAT_REVENUE", "Bella-Vita repeat-customer revenue", "currency", "higher_is_better");

  await saveDefinition({
    metric_id: salesId, grain: "process", process_id: BELLA_VITA_PROCESS_ID,
    data_source_id: BELLA_SALES_SOURCE_ID, formula_expression: "repeat_sales",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: revenueId, grain: "process", process_id: BELLA_VITA_PROCESS_ID,
    data_source_id: BELLA_SALES_SOURCE_ID, formula_expression: "repeat_revenue",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] Done. BELLA_REPEAT_SALES_COUNT / BELLA_REPEAT_REVENUE wired.");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
