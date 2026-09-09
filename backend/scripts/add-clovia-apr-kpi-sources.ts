/**
 * Wires clovia_apr_daily_actual (sql/1718) into KPI Studio.
 *
 * Run with: npx tsx scripts/add-clovia-apr-kpi-sources.ts
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
    source_code: "CLOVIA_APR_DAILY",
    source_name: "Clovia — APR Utilization (Daily)",
    source_type: "local_query",
    source_object: "clovia_apr_daily_actual",
    date_column: "call_date",
    description: "Clovia's own APR-Utilization Raw sheet (sql/1718) -- found while auditing the same workbook used for Chat Performance/CRM Disposition; no DB backing exists for this data anywhere.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "total_calls", source_column: "total_calls", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "talk_seconds", source_column: "talk_seconds", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "login_seconds", source_column: "login_seconds", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "net_login_seconds", source_column: "net_login_seconds", aggregate_fn: "SUM" });

  const callsId = await ensureMetric("CLOVIA_APR_TOTAL_CALLS", "Clovia APR total calls", "count", "higher_is_better");
  const achtId = await ensureMetric("CLOVIA_APR_ACHT", "Clovia APR average call handling time", "seconds", "lower_is_better");
  const utilId = await ensureMetric("CLOVIA_APR_UTILIZATION_PCT", "Clovia APR login utilization", "pct", "higher_is_better");

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
    data_source_id: sourceId, formula_expression: "PCT(net_login_seconds, login_seconds)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] CLOVIA_APR_DAILY wired: total calls, ACHT, login utilization%");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
