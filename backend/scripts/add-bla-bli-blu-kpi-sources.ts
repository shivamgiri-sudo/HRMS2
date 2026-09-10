/**
 * Wires bla_bli_blu_cdr_daily_actual (sql/1728) into KPI Studio.
 *
 * Run with: npx tsx scripts/add-bla-bli-blu-kpi-sources.ts
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
    `SELECT id FROM process_master WHERE process_name = 'Bla Bli Blu' AND active_status = 1 LIMIT 1`,
  );
  const processId = String(procRows[0].id);

  const source = await saveDataSource({
    source_code: "BLA_BLI_BLU_CDR_DAILY",
    source_name: "Bla Bli Blu — CDR (Daily)",
    source_type: "local_query",
    source_object: "bla_bli_blu_cdr_daily_actual",
    date_column: "report_date",
    description: "Bla Bli Blu's own B-3 Dashboard's CDR Raw sheet -- a live dialer_db sync (cdr_bla_bli_blu, a SmartPing cloud-dialer export, single client_id='487'), confirmed live 2026-09-10.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "total_calls", source_column: "total_calls", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "unique_customers", source_column: "unique_customers", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "connected_calls", source_column: "connected_calls", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "unique_agents", source_column: "unique_agents", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "talk_seconds", source_column: "talk_seconds", aggregate_fn: "SUM" });

  const totalCallsId = await ensureMetric("BLA_BLI_BLU_TOTAL_CALLS", "Bla Bli Blu total calls", "count", "higher_is_better");
  const connRateId = await ensureMetric("BLA_BLI_BLU_CONNECT_RATE", "Bla Bli Blu connect rate", "percent", "higher_is_better");
  const achtId = await ensureMetric("BLA_BLI_BLU_ACHT", "Bla Bli Blu average talk time", "seconds", "lower_is_better");

  await saveDefinition({
    metric_id: totalCallsId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "total_calls",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: connRateId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "PCT(connected_calls, total_calls)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: achtId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "SAFE_DIV(talk_seconds, total_calls)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] BLA_BLI_BLU_CDR_DAILY wired: total calls, connect rate, ACHT");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
