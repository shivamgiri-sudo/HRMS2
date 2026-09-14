/**
 * Wires housing_owner_sale_raw (sql/1708) into KPI Studio.
 *
 * The sibling housing_owner_call_logs wiring was RETRACTED 2026-09-10:
 * db_masmis.CR_housing_owner already carries this exact per-call
 * performance data live, from the same Tata Teleservices dialer.
 *
 * Run with: npx tsx scripts/add-housing-owner-kpi-sources.ts
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
    `SELECT id FROM process_master WHERE process_name = 'Housing Owner' AND active_status = 1 LIMIT 1`,
  );
  const processId = String(procRows[0].id);

  // --- Sale Raw ---
  const saleSource = await saveDataSource({
    source_code: "HOUSING_OWNER_SALE_RAW",
    source_name: "Housing Owner — Sale Raw",
    source_type: "local_query",
    source_object: "housing_owner_sale_raw",
    date_column: "report_date",
    description: "Manually-uploaded per-order sales data (sql/1708) -- Housing Owner's own SOP Sale Raw sheet; no DB backing exists for this data anywhere.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const saleSourceId = String((saleSource as { id: string }).id);

  await saveSourceField({ data_source_id: saleSourceId, field_name: "sales_count", source_column: "sale_count", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: saleSourceId, field_name: "revenue", source_column: "value", aggregate_fn: "SUM" });

  const salesCountId = await ensureMetric("HOUSING_OWNER_SALES_COUNT", "Housing Owner sales count", "count", "higher_is_better");
  const revenueId = await ensureMetric("HOUSING_OWNER_REVENUE", "Housing Owner revenue", "currency", "higher_is_better");

  await saveDefinition({
    metric_id: salesCountId, grain: "process", process_id: processId,
    data_source_id: saleSourceId, formula_expression: "sales_count",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: revenueId, grain: "process", process_id: processId,
    data_source_id: saleSourceId, formula_expression: "revenue",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] HOUSING_OWNER_SALE_RAW wired: sales count, revenue");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
