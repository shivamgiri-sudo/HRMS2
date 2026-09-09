/**
 * Wires clovia_ib_cdr_raw (sql/1719) into KPI Studio.
 *
 * Run with: npx tsx scripts/add-clovia-ib-cdr-kpi-sources.ts
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
    `SELECT id FROM process_master WHERE process_name = 'Clovia' AND active_status = 1 LIMIT 1`,
  );
  const processId = String(procRows[0].id);

  const source = await saveDataSource({
    source_code: "CLOVIA_IB_CDR",
    source_name: "Clovia — Inbound CDR",
    source_type: "local_query",
    source_object: "clovia_ib_cdr_raw",
    date_column: "report_date",
    description: "Clovia's own IB CDR Raw sheet (sql/1719) -- found while auditing the same workbook used for Chat Performance/CRM Disposition; no DB backing exists for this data anywhere.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "calls_total", source_column: "id", aggregate_fn: "COUNT" });
  await saveSourceField({
    data_source_id: sourceId, field_name: "calls_answered", source_column: "id", aggregate_fn: "COUNT",
    filter_json: [{ column: "disposition", op: "eq", value: "A" }],
  } as never);
  await saveSourceField({ data_source_id: sourceId, field_name: "talk_seconds", source_column: "call_duration_seconds", aggregate_fn: "SUM" });

  const totalId = await ensureMetric("CLOVIA_IB_CDR_TOTAL_CALLS", "Clovia IB CDR total calls", "count", "higher_is_better");
  const answeredPctId = await ensureMetric("CLOVIA_IB_CDR_ANSWERED_PCT", "Clovia IB CDR answered %", "pct", "higher_is_better");
  const achtId = await ensureMetric("CLOVIA_IB_CDR_ACHT", "Clovia IB CDR average call handling time", "seconds", "lower_is_better");

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

  console.log("[SEED] CLOVIA_IB_CDR wired: total calls, answered%, ACHT");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
