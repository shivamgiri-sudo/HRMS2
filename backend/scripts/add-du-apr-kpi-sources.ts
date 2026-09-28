/**
 * Wires du_apr_daily_actual (sql/1710) into KPI Studio.
 *
 * Two sources, not one: KOREA and THAILAND are two separate report instances
 * of the identical shape (per DU Digital's own SOP "6. DU Korea"/"6. DU
 * Thailand"), both anchored to the single "DU Digital" process -- 'column'
 * on dashboard_label, not 'constant', so the same physical process gets two
 * independently-computed sets of numbers rather than one blended total that
 * would double-count (same pattern as this session's LP Leads and
 * Molecular/Reginald Men Email dashboards).
 *
 * Run with: npx tsx scripts/add-du-apr-kpi-sources.ts
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
    `SELECT id FROM process_master WHERE process_name = 'DU Digital' AND active_status = 1 LIMIT 1`,
  );
  const processId = String(procRows[0].id);

  const dashboards: Array<{ code: string; label: "KOREA" | "THAILAND"; name: string; prefix: string }> = [
    { code: "DU_APR_KOREA", label: "KOREA", name: "DU Digital Korea", prefix: "DU_APR_KOREA" },
    { code: "DU_APR_THAILAND", label: "THAILAND", name: "DU Digital Thailand", prefix: "DU_APR_THAILAND" },
  ];

  for (const d of dashboards) {
    const source = await saveDataSource({
      source_code: d.code,
      source_name: `${d.name} — daily APR actuals`,
      source_type: "local_query",
      source_object: "du_apr_daily_actual",
      date_column: "call_date",
      description: `Manually-uploaded DU CRM Agents Time details export for the ${d.name} dashboard (sql/1710) -- no DB backing exists for this data anywhere.`,
      process_key_kind: "column",
      process_key_column: "dashboard_label",
      process_key_value: d.label,
      process_id: processId,
    } as never, CREATED_BY);
    const sourceId = String((source as { id: string }).id);

    await saveSourceField({ data_source_id: sourceId, field_name: "total_calls", source_column: "total_calls", aggregate_fn: "SUM" });
    await saveSourceField({ data_source_id: sourceId, field_name: "talk_seconds", source_column: "talk_seconds", aggregate_fn: "SUM" });
    await saveSourceField({ data_source_id: sourceId, field_name: "login_seconds", source_column: "login_seconds", aggregate_fn: "SUM" });
    await saveSourceField({ data_source_id: sourceId, field_name: "net_login_seconds", source_column: "net_login_seconds", aggregate_fn: "SUM" });

    console.log(`[SEED] ${d.code} source + fields wired`);
  }

  for (const d of dashboards) {
    const [srcRows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_studio_data_source WHERE source_code = ?`, [d.code]);
    const sourceId = String(srcRows[0].id);

    const totalCallsId = await ensureMetric(`${d.prefix}_TOTAL_CALLS`, `${d.name} total calls`, "count", "higher_is_better");
    const achtId = await ensureMetric(`${d.prefix}_ACHT`, `${d.name} average call handling time`, "seconds", "lower_is_better");
    const utilId = await ensureMetric(`${d.prefix}_UTILIZATION_PCT`, `${d.name} login utilization`, "pct", "higher_is_better");

    await saveDefinition({
      metric_id: totalCallsId, grain: "process", process_id: processId,
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

    console.log(`[SEED] ${d.prefix}_TOTAL_CALLS / ${d.prefix}_ACHT / ${d.prefix}_UTILIZATION_PCT wired`);
  }

  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
