/**
 * Wires db_masmis.CR_lp_regional / CR_lp_non_regional directly into KPI
 * Studio -- no new mas_hrms table. These are the live, periodically
 * updated (Regional last through 2026-08-29, Non Regional through
 * 2026-08-29) homes for LP's BPO CR Reports (call log) export, confirmed
 * to already carry the same data lp_cdr_raw (part of sql/1713, RETRACTED
 * 2026-09-10) duplicated.
 *
 * No connect-rate metric is computed: disposition is a lead-outcome code
 * (e.g. BRCH001), not a connect/no-connect flag, and lead_status is a
 * pipeline stage (ReSchedule/Drop/Active) -- neither maps to "connected"
 * without guessing, same discipline as Reginald Abandoned Cart.
 *
 * Run with: npx tsx scripts/add-lp-cr-kpi-sources.ts
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

const DASHBOARDS: Array<{ table: string; value: string; name: string; prefix: string }> = [
  { table: "db_masmis.CR_lp_regional", value: "regional", name: "LP Regional", prefix: "LP_CR_LIVE_REGIONAL" },
  { table: "db_masmis.CR_lp_non_regional", value: "non_regional", name: "LP Non Regional", prefix: "LP_CR_LIVE_NON_REGIONAL" },
];

async function main() {
  const [procRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM process_master WHERE process_name = 'Lawyer Panel' LIMIT 1`,
  );
  const processId = String(procRows[0].id);

  for (const d of DASHBOARDS) {
    const source = await saveDataSource({
      source_code: `${d.prefix}_SOURCE`,
      source_name: `${d.name} — Call Records (live)`,
      source_type: "local_query",
      source_object: d.table,
      date_column: "created_at",
      description: `LP's live, periodically-updated ${d.name} call record staging table in db_masmis -- read directly, not duplicated into mas_hrms. Confirmed the same data lp_cdr_raw (part of sql/1713, retracted) would have held.`,
      process_key_kind: "constant",
      process_id: processId,
    } as never, CREATED_BY);
    const sourceId = String((source as { id: string }).id);

    await saveSourceField({ data_source_id: sourceId, field_name: "total_calls", source_column: "id", aggregate_fn: "COUNT" });
    await saveSourceField({ data_source_id: sourceId, field_name: "talk_seconds", source_column: "call_duration", aggregate_fn: "SUM" });

    const totalId = await ensureMetric(`${d.prefix}_TOTAL_CALLS`, `${d.name} total calls (live)`, "count", "higher_is_better");
    const achtId = await ensureMetric(`${d.prefix}_ACHT`, `${d.name} average call handling time (live)`, "seconds", "lower_is_better");

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

    console.log(`[SEED] ${d.prefix} wired: total calls, ACHT`);
  }

  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
