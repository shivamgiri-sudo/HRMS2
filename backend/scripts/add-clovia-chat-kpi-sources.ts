/**
 * Wires clovia_chat_daily_actual (sql/1704) into KPI Studio.
 *
 * Run with: npx tsx scripts/add-clovia-chat-kpi-sources.ts
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
    source_code: "CLOVIA_CHAT_DAILY",
    source_name: "Clovia — Chat Performance (daily)",
    source_type: "local_query",
    source_object: "clovia_chat_daily_actual",
    date_column: "report_date",
    description: "Manually-uploaded daily chat counts (sql/1704) -- Botlytics chat dump per Clovia's own SOP; no DB backing exists for this data anywhere.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "total_chat", source_column: "total_chat", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "total_response", source_column: "total_response", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "csat_count", source_column: "csat_count", aggregate_fn: "SUM" });

  const volumeId = await ensureMetric("CLOVIA_CHAT_VOLUME", "Clovia chat volume", "count", "higher_is_better");
  const responsePctId = await ensureMetric("CLOVIA_CHAT_RESPONSE_PCT", "Clovia chat response rate", "pct", "higher_is_better");
  const csatPctId = await ensureMetric("CLOVIA_CHAT_CSAT_PCT", "Clovia chat CSAT rate", "pct", "higher_is_better");

  await saveDefinition({
    metric_id: volumeId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "total_chat",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: responsePctId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "PCT(total_response, total_chat)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: csatPctId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "PCT(csat_count, total_response)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] CLOVIA_CHAT_DAILY wired: volume, response%, CSAT%");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
