/**
 * Wires housing_premium_sale_raw (sql/1706) into KPI Studio.
 *
 * Run with: npx tsx scripts/add-housing-premium-sale-raw-kpi-sources.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { saveDataSource, saveSourceField, saveDefinition, createMetric } from "../src/modules/kpi/kpi-studio.service.js";
import type { RowDataPacket } from "mysql2";

const CREATED_BY = "demo-super-admin-id";

async function ensureMetric(code: string, name: string, unit: string, direction: "higher_is_better" | "lower_is_better") {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`, [code]);
  if (rows.length) return String(rows[0].id);
  const created = await createMetric({ metric_code: code, metric_name: name, unit, direction } as never);
  return String((created as { id: string }).id);
}

async function main() {
  const [procRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM process_master WHERE process_name = 'Housing Premium' AND active_status = 1 LIMIT 1`,
  );
  const processId = String(procRows[0].id);

  const source = await saveDataSource({
    source_code: "HOUSING_PREMIUM_SALE_RAW",
    source_name: "Housing Premium — Sale Raw",
    source_type: "local_query",
    source_object: "housing_premium_sale_raw",
    date_column: "report_date",
    description: "Manually-uploaded per-order sales data (sql/1706) -- Housing Premium's own SOP Sale Raw sheet; no DB backing exists for this data anywhere.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "sales_count", source_column: "id", aggregate_fn: "COUNT" });
  await saveSourceField({ data_source_id: sourceId, field_name: "revenue", source_column: "amount", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "target", source_column: "target", aggregate_fn: "SUM" });

  const salesCountId = await ensureMetric("HOUSING_PREMIUM_SALES_COUNT", "Housing Premium sales count", "count", "higher_is_better");
  const revenueId = await ensureMetric("HOUSING_PREMIUM_REVENUE", "Housing Premium revenue", "currency", "higher_is_better");
  const targetAchId = await ensureMetric("HOUSING_PREMIUM_TARGET_ACHIEVEMENT_PCT", "Housing Premium target achievement", "pct", "higher_is_better");

  await saveDefinition({
    metric_id: salesCountId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "sales_count",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: revenueId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "revenue",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: targetAchId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "PCT(revenue, target)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] HOUSING_PREMIUM_SALE_RAW wired: sales count, revenue, target achievement%");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
