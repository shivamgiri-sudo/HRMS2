/**
 * Wires housing_owner_sale_raw and housing_owner_call_logs (sql/1708) into
 * KPI Studio.
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

  // --- Call Logs ---
  const callSource = await saveDataSource({
    source_code: "HOUSING_OWNER_CALL_LOGS",
    source_name: "Housing Owner — Call Logs (Tata Dialer)",
    source_type: "local_query",
    source_object: "housing_owner_call_logs",
    date_column: "report_date",
    description: "Manually-uploaded per-agent per-day Tata Dialer call performance (sql/1708) -- Housing Owner's own SOP Call Logs sheet; no DB backing exists for this data anywhere.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const callSourceId = String((callSource as { id: string }).id);

  await saveSourceField({ data_source_id: callSourceId, field_name: "total_calls", source_column: "total_calls", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: callSourceId, field_name: "in_call_seconds", source_column: "in_call_seconds", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: callSourceId, field_name: "available_seconds", source_column: "available_seconds", aggregate_fn: "SUM" });

  const totalCallsId = await ensureMetric("HOUSING_OWNER_TOTAL_CALLS", "Housing Owner total calls", "count", "higher_is_better");
  const achtId = await ensureMetric("HOUSING_OWNER_ACHT", "Housing Owner average call handling time", "seconds", "lower_is_better");
  const utilId = await ensureMetric("HOUSING_OWNER_CALL_UTILIZATION_PCT", "Housing Owner call time utilization", "pct", "higher_is_better");

  await saveDefinition({
    metric_id: totalCallsId, grain: "process", process_id: processId,
    data_source_id: callSourceId, formula_expression: "total_calls",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: achtId, grain: "process", process_id: processId,
    data_source_id: callSourceId, formula_expression: "SAFE_DIV(in_call_seconds, total_calls)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: utilId, grain: "process", process_id: processId,
    data_source_id: callSourceId, formula_expression: "PCT(in_call_seconds, available_seconds)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] HOUSING_OWNER_SALE_RAW + HOUSING_OWNER_CALL_LOGS wired: sales count, revenue, total calls, ACHT, call utilization%");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
