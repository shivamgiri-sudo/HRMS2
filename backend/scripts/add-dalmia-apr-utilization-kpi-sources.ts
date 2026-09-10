/**
 * Wires dalmia_apr_utilization_raw (sql/1733) into KPI Studio.
 *
 * Run with: npx tsx scripts/add-dalmia-apr-utilization-kpi-sources.ts
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
    `SELECT id FROM process_master WHERE process_name = 'Dalmia Cement' AND active_status = 1 LIMIT 1`,
  );
  const processId = String(procRows[0].id);

  const source = await saveDataSource({
    source_code: "DALMIA_APR_UTILIZATION",
    source_name: "Dalmia Cement — APR Utilization (Daily)",
    source_type: "local_query",
    source_object: "dalmia_apr_utilization_raw",
    date_column: "report_date",
    description: "Dalmia Cement's own APR-Utilization Raw sheet (sql/1733) -- found while auditing a real MIS workbook for this process; no DB backing exists for this data anywhere.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "total_calls", source_column: "call_chat_count", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "talk_seconds", source_column: "talk_seconds", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "utilization_pct_avg", source_column: "utilization_pct", aggregate_fn: "AVG" });

  const callsId = await ensureMetric("DALMIA_APR_TOTAL_CALLS", "Dalmia APR total calls/chats", "count", "higher_is_better");
  const achtId = await ensureMetric("DALMIA_APR_ACHT", "Dalmia APR average call handling time", "seconds", "lower_is_better");
  const utilId = await ensureMetric("DALMIA_APR_UTILIZATION_PCT", "Dalmia APR utilization", "pct", "higher_is_better");

  await saveDefinition({
    metric_id: callsId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "total_calls",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: achtId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "SAFE_DIV(talk_seconds, total_calls)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: utilId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "utilization_pct_avg",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] DALMIA_APR_UTILIZATION wired: total calls, ACHT, utilization%");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
