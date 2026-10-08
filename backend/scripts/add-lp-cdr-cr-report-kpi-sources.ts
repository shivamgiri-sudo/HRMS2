/**
 * Wires lp_cr_report_raw (sql/1713) into KPI Studio.
 *
 * Dashboard-scoped sources (REGIONAL/NON_REGIONAL), same
 * process_key_kind='column' pattern as this session's LP Leads/DU APR.
 *
 * The sibling lp_cdr_raw wiring was RETRACTED 2026-09-10: db_masmis.
 * CR_lp_regional/CR_lp_non_regional already carry this exact
 * call-detail-record data live.
 *
 * Run with: npx tsx scripts/add-lp-cdr-cr-report-kpi-sources.ts
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

const CR_DASHBOARDS: Array<{ label: "REGIONAL" | "NON_REGIONAL"; name: string; prefix: string }> = [
  { label: "REGIONAL", name: "LP Regional", prefix: "LP_CR_REPORT_REGIONAL" },
  { label: "NON_REGIONAL", name: "LP Non Regional", prefix: "LP_CR_REPORT_NON_REGIONAL" },
];

async function main() {
  const [procRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM process_master WHERE process_name = 'Lawyer Panel' LIMIT 1`,
  );
  const processId = String(procRows[0].id);

  for (const d of CR_DASHBOARDS) {
    const source = await saveDataSource({
      source_code: `${d.prefix}_SOURCE`,
      source_name: `${d.name} — CR Report shares`,
      source_type: "local_query",
      source_object: "lp_cr_report_raw",
      date_column: "created_on",
      description: `Manually-uploaded LP Mascallnet NRGN Call History export for the ${d.name} dashboard (sql/1713) -- no DB backing exists for this data anywhere.`,
      process_key_kind: "column",
      process_key_column: "dashboard_label",
      process_key_value: d.label,
      process_id: processId,
    } as never, CREATED_BY);
    const sourceId = String((source as { id: string }).id);

    await saveSourceField({ data_source_id: sourceId, field_name: "cr_shared_count", source_column: "id", aggregate_fn: "COUNT" });

    const crCountId = await ensureMetric(`${d.prefix}_COUNT`, `${d.name} credit reports shared`, "count", "higher_is_better");
    await saveDefinition({
      metric_id: crCountId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "cr_shared_count",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);

    console.log(`[SEED] ${d.prefix} (CR Report) wired: shared count`);
  }

  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
