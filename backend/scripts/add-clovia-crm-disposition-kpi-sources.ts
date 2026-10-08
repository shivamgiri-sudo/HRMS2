/**
 * Wires clovia_crm_disposition (sql/1705) into KPI Studio.
 *
 * Run with: npx tsx scripts/add-clovia-crm-disposition-kpi-sources.ts
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
    source_code: "CLOVIA_CRM_DISPOSITION",
    source_name: "Clovia — CRM Disposition",
    source_type: "local_query",
    source_object: "clovia_crm_disposition",
    date_column: "report_date",
    description: "Manually-uploaded per-ticket CRM disposition data (sql/1705) -- Clovia CRM per its own SOP; no DB backing exists for this data anywhere.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "tickets", source_column: "id", aggregate_fn: "COUNT" });
  await saveSourceField({
    data_source_id: sourceId, field_name: "ftr_scored", source_column: "id", aggregate_fn: "COUNT",
    filter_json: [{ column: "ftr_flag", op: "is_not_null" }],
  } as never);
  await saveSourceField({
    data_source_id: sourceId, field_name: "ftr_passed", source_column: "id", aggregate_fn: "COUNT",
    filter_json: [{ column: "ftr_flag", op: "eq", value: 1 }],
  } as never);

  const ticketsId = await ensureMetric("CLOVIA_CRM_TICKETS", "Clovia CRM tickets", "count", "higher_is_better");
  const ftrPctId = await ensureMetric("CLOVIA_CRM_FTR_PCT", "Clovia CRM first-time resolution rate", "pct", "higher_is_better");

  await saveDefinition({
    metric_id: ticketsId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "tickets",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: ftrPctId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "PCT(ftr_passed, ftr_scored)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] CLOVIA_CRM_DISPOSITION wired: tickets, FTR%");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
