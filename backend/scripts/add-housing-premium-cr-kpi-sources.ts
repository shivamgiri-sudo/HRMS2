/**
 * Wires db_masmis.CR_housing_premium directly into KPI Studio -- no new
 * mas_hrms table. This is the live, actively-maintained (new upload
 * batches every 1-3 days through 2026-09-08) home for Housing Premium's
 * outbound call log, confirmed to already carry the same data
 * housing_premium_cdr_raw (sql/1716, RETRACTED 2026-09-10) duplicated.
 *
 * KPI Studio's source_object supports dot-qualified cross-schema
 * identifiers (assertSafeIdentifier validates each dot-separated part,
 * quoteIdentifier quotes them individually) and the mas_hrms connection
 * pool has confirmed SELECT access to db_masmis on the same host, so
 * this points straight at the live table.
 *
 * call_result is uniformly 'ANSWER' across every real row (this table
 * only logs connected calls, not dial attempts), so no connect-rate
 * metric is computed -- same discipline as Reginald Abandoned Cart's
 * un-guessed connect-rate.
 *
 * Run with: npx tsx scripts/add-housing-premium-cr-kpi-sources.ts
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
    source_code: "HOUSING_PREMIUM_CR_LIVE",
    source_name: "Housing Premium — Call Records (live)",
    source_type: "local_query",
    source_object: "db_masmis.CR_housing_premium",
    date_column: "call_date",
    description: "Housing Premium's live, actively-maintained call record staging table in db_masmis -- read directly, not duplicated into mas_hrms. Confirmed the same data housing_premium_cdr_raw (sql/1716, retracted) would have held.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "total_calls", source_column: "id", aggregate_fn: "COUNT" });
  await saveSourceField({ data_source_id: sourceId, field_name: "talk_seconds", source_column: "duration", aggregate_fn: "SUM" });

  const totalId = await ensureMetric("HOUSING_PREMIUM_CR_TOTAL_CALLS", "Housing Premium total calls (live)", "count", "higher_is_better");
  const achtId = await ensureMetric("HOUSING_PREMIUM_CR_ACHT", "Housing Premium average call handling time (live)", "seconds", "lower_is_better");

  await saveDefinition({
    metric_id: totalId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "total_calls",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: achtId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "SAFE_DIV(talk_seconds, total_calls)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] HOUSING_PREMIUM_CR_LIVE wired: total calls, ACHT");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
