/**
 * Wires inbound_cdr_daily_actual (sql/1712) into KPI Studio -- one source
 * per client, all sharing the table via process_key_kind='column' on
 * client_code (same pattern as this session's other multi-dashboard
 * sources), since a shared metric_id across clients would let one client's
 * saveDefinition silently overwrite another's.
 *
 * total_calls/total_answered are safely SUM-able across any date range (all
 * seven of the SOP's queries compute AL the same way: Call_Answered/
 * Call_Offered), so answer_rate_pct is recomputed via SAFE_DIV rather than
 * averaging the SOP's own daily percentage. service_level_pct/repeat_pct/
 * fcr_pct are NOT safely summable (their denominators differ by client, per
 * inbound-cdr-sync.service.ts's own comments) -- these are averaged as
 * stored, matching what the SOP's source sheet itself shows per day.
 *
 * Run with: npx tsx scripts/add-inbound-cdr-kpi-sources.ts
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

const CLIENTS: Array<{ code: string; label: string; processName: string; prefix: string }> = [
  { code: "GNC", label: "GNC", processName: "GNC", prefix: "INBOUND_GNC" },
  { code: "BELLAVITA", label: "Bellavita Inbound", processName: "Bella-Vita Organic", prefix: "INBOUND_BELLAVITA" },
  { code: "CLOVIA", label: "Clovia Inbound", processName: "Clovia", prefix: "INBOUND_CLOVIA" },
  { code: "NEEMANS", label: "Neemans Inbound", processName: "Neemans Private Limited", prefix: "INBOUND_NEEMANS" },
  { code: "VIEGA", label: "Viega Inbound", processName: "Viega", prefix: "INBOUND_VIEGA" },
  { code: "EXICOM", label: "Exicom Inbound", processName: "Exicom", prefix: "INBOUND_EXICOM" },
  { code: "DU_BANGLADESH", label: "DU Bangladesh Inbound", processName: "DU Digital", prefix: "INBOUND_DU_BANGLADESH" },
];

async function main() {
  for (const client of CLIENTS) {
    const [procRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM process_master WHERE process_name = ? AND active_status = 1 LIMIT 1`,
      [client.processName],
    );
    if (!procRows.length) {
      console.error(`[SEED] SKIPPED ${client.code}: no active process named "${client.processName}"`);
      continue;
    }
    const processId = String(procRows[0].id);

    const source = await saveDataSource({
      source_code: `INBOUND_CDR_${client.code}`,
      source_name: `${client.label} — daily CDR actuals`,
      source_type: "local_query",
      source_object: "inbound_cdr_daily_actual",
      date_column: "call_date",
      description: `Live-synced daily inbound call-centre KPIs for ${client.label}, read from dialer_db via inbound-cdr-sync.service.ts (sql/1712) -- ported from Inbound Process.docx's own Google Apps Script SQL, not a manual upload.`,
      process_key_kind: "column",
      process_key_column: "client_code",
      process_key_value: client.code,
      process_id: processId,
    } as never, CREATED_BY);
    const sourceId = String((source as { id: string }).id);

    await saveSourceField({ data_source_id: sourceId, field_name: "call_offered", source_column: "call_offered", aggregate_fn: "SUM" });
    await saveSourceField({ data_source_id: sourceId, field_name: "call_answered", source_column: "call_answered", aggregate_fn: "SUM" });
    await saveSourceField({ data_source_id: sourceId, field_name: "service_level_pct", source_column: "service_level_pct", aggregate_fn: "AVG" });
    await saveSourceField({ data_source_id: sourceId, field_name: "repeat_pct", source_column: "repeat_pct", aggregate_fn: "AVG" });
    await saveSourceField({ data_source_id: sourceId, field_name: "fcr_pct", source_column: "fcr_pct", aggregate_fn: "AVG" });
    await saveSourceField({ data_source_id: sourceId, field_name: "acht_seconds", source_column: "acht_seconds", aggregate_fn: "AVG" });

    const callsId = await ensureMetric(`${client.prefix}_CALLS_OFFERED`, `${client.label} calls offered`, "count", "higher_is_better");
    const alId = await ensureMetric(`${client.prefix}_ANSWER_RATE_PCT`, `${client.label} answer rate`, "pct", "higher_is_better");
    const slId = await ensureMetric(`${client.prefix}_SERVICE_LEVEL_PCT`, `${client.label} service level`, "pct", "higher_is_better");
    const repeatId = await ensureMetric(`${client.prefix}_REPEAT_PCT`, `${client.label} repeat call rate`, "pct", "lower_is_better");
    const achtId = await ensureMetric(`${client.prefix}_ACHT`, `${client.label} average call handling time`, "seconds", "lower_is_better");

    await saveDefinition({
      metric_id: callsId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "call_offered",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    await saveDefinition({
      metric_id: alId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "PCT(call_answered, call_offered)",
      aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    await saveDefinition({
      metric_id: slId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "service_level_pct",
      aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    await saveDefinition({
      metric_id: repeatId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "repeat_pct",
      aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    await saveDefinition({
      metric_id: achtId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "acht_seconds",
      aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);

    console.log(`[SEED] ${client.prefix} wired: calls offered, answer rate%, service level%, repeat%, ACHT`);
  }

  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
