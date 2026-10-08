/**
 * Wires lp_apr_daily_actual (sql/1701) into KPI Studio, same reasoning as the
 * email ticket wiring earlier tonight: a manually-uploaded data point belongs
 * on a scorecard, not just sitting in a raw table.
 *
 * Anchored directly to the Lawyer Panel process_id, same as LP_FEEDBACK/
 * LP_REGIONAL/LP_NON_REGIONAL built earlier tonight -- Lawyer Panel is
 * currently active_status=0 in process_master (flagged, not resolved, a
 * business decision left to the user), so this bypasses that filter rather
 * than being blocked by it; a storage/reporting gap should not depend on
 * that decision.
 *
 * Run with: npx tsx scripts/add-lp-apr-kpi-sources.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { saveDataSource, saveSourceField, saveDefinition, createMetric } from "../src/modules/kpi/kpi-studio.service.js";
import type { RowDataPacket } from "mysql2";

const CREATED_BY = "demo-super-admin-id";
const LAWYER_PANEL_PROCESS_ID = "050f3ee1-67ba-11f1-adb1-00155d0ab410";

async function ensureMetric(code: string, name: string, unit: string, direction: "higher_is_better" | "lower_is_better") {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`, [code]);
  if (rows.length) return String(rows[0].id);
  const created = await createMetric({ metric_code: code, metric_name: name, unit, direction } as never);
  return String((created as { id: string }).id);
}

async function main() {
  const source = await saveDataSource({
    source_code: "LP_APR_DAILY",
    source_name: "Lawyer Panel — WebConsole APR",
    source_type: "local_query",
    source_object: "lp_apr_daily_actual",
    date_column: "call_date",
    description: "Manually-uploaded LP WebConsole APR (sql/1701) -- dialer_db.apr_5/apr_137_235/apr_bla_bli_blu are confirmed empty (dead sync job).",
    process_key_kind: "constant",
    process_id: LAWYER_PANEL_PROCESS_ID,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "total_calls", source_column: "total_calls", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "talk_seconds", source_column: "talk_seconds", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "login_seconds", source_column: "login_seconds", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "net_login_seconds", source_column: "net_login_seconds", aggregate_fn: "SUM" });

  const totalCallsId = await ensureMetric("LP_APR_TOTAL_CALLS", "LP APR total calls", "count", "higher_is_better");
  const achtId = await ensureMetric("LP_APR_ACHT", "LP APR average call handling time", "seconds", "lower_is_better");
  const utilId = await ensureMetric("LP_APR_UTILIZATION_PCT", "LP APR utilization (net/gross login)", "pct", "higher_is_better");

  await saveDefinition({
    metric_id: totalCallsId, grain: "process", process_id: LAWYER_PANEL_PROCESS_ID,
    data_source_id: sourceId, formula_expression: "total_calls",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: achtId, grain: "process", process_id: LAWYER_PANEL_PROCESS_ID,
    data_source_id: sourceId, formula_expression: "SAFE_DIV(talk_seconds, total_calls)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: utilId, grain: "process", process_id: LAWYER_PANEL_PROCESS_ID,
    data_source_id: sourceId, formula_expression: "PCT(net_login_seconds, login_seconds)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] LP_APR_DAILY wired: total_calls, ACHT, utilization%");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
