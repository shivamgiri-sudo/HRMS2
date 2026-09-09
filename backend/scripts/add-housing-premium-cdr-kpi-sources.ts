/**
 * Wires housing_premium_cdr_raw (sql/1716) into KPI Studio.
 *
 * Run with: npx tsx scripts/add-housing-premium-cdr-kpi-sources.ts
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
    source_code: "HOUSING_PREMIUM_CDR",
    source_name: "Housing Premium — CDR call log",
    source_type: "local_query",
    source_object: "housing_premium_cdr_raw",
    date_column: "report_date",
    description: "Housing Premium's own CDR sheet (sql/1716) -- found while auditing the same workbook used for Sale Raw; no DB backing exists for this data anywhere.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "calls_total", source_column: "id", aggregate_fn: "COUNT" });
  await saveSourceField({
    data_source_id: sourceId, field_name: "calls_answered", source_column: "id", aggregate_fn: "COUNT",
    filter_json: [{ column: "status", op: "eq", value: "Answered" }],
  } as never);
  await saveSourceField({
    data_source_id: sourceId, field_name: "talk_seconds", source_column: "talk_duration_seconds", aggregate_fn: "SUM",
  } as never);

  const totalId = await ensureMetric("HOUSING_PREMIUM_CDR_TOTAL_CALLS", "Housing Premium CDR total calls", "count", "higher_is_better");
  const answeredPctId = await ensureMetric("HOUSING_PREMIUM_CDR_ANSWERED_PCT", "Housing Premium CDR answered %", "pct", "higher_is_better");
  const achtId = await ensureMetric("HOUSING_PREMIUM_CDR_ACHT", "Housing Premium CDR average talk time", "seconds", "lower_is_better");

  await saveDefinition({
    metric_id: totalId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "calls_total",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: answeredPctId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "PCT(calls_answered, calls_total)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: achtId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "SAFE_DIV(talk_seconds, calls_answered)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] HOUSING_PREMIUM_CDR wired: total calls, answered%, ACHT");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
