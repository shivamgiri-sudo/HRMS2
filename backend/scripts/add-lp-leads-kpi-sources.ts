/**
 * Wires lp_leads_raw (sql/1709) into KPI Studio.
 *
 * Two sources, not one: REGIONAL and NON_REGIONAL are two separate report
 * instances of the identical shape (per LP's own SOP "9. Leads"), both
 * anchored to the single "Lawyer Panel" process -- 'column' on
 * dashboard_label, not 'constant', so the same physical process gets two
 * independently-computed sets of numbers rather than one blended total
 * that would double-count (same pattern as this session's Molecular/
 * Reginald Men Email dashboards).
 *
 * Run with: npx tsx scripts/add-lp-leads-kpi-sources.ts
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
    `SELECT id FROM process_master WHERE process_name = 'Lawyer Panel' LIMIT 1`,
  );
  const processId = String(procRows[0].id);

  const dashboards: Array<{ code: string; label: "REGIONAL" | "NON_REGIONAL"; name: string; prefix: string }> = [
    { code: "LP_LEADS_REGIONAL", label: "REGIONAL", name: "LP Leads Regional", prefix: "LP_LEADS_REGIONAL" },
    { code: "LP_LEADS_NON_REGIONAL", label: "NON_REGIONAL", name: "LP Leads Non Regional", prefix: "LP_LEADS_NON_REGIONAL" },
  ];

  for (const d of dashboards) {
    const source = await saveDataSource({
      source_code: d.code,
      source_name: `${d.name} — daily leads actuals`,
      source_type: "local_query",
      source_object: "lp_leads_raw",
      date_column: "report_date",
      description: `Manually-uploaded LP BPO Leads (M) export for the ${d.name} dashboard (sql/1709) -- no DB backing exists for this data anywhere.`,
      process_key_kind: "column",
      process_key_column: "dashboard_label",
      process_key_value: d.label,
      process_id: processId,
    } as never, CREATED_BY);
    const sourceId = String((source as { id: string }).id);

    await saveSourceField({ data_source_id: sourceId, field_name: "leads_total", source_column: "id", aggregate_fn: "COUNT" });
    await saveSourceField({
      data_source_id: sourceId, field_name: "leads_connected", source_column: "id", aggregate_fn: "COUNT",
      filter_json: [{ column: "disposition", op: "eq", value: "Connected" }],
    } as never);

    console.log(`[SEED] ${d.code} source + fields wired`);
  }

  for (const d of dashboards) {
    const [srcRows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_studio_data_source WHERE source_code = ?`, [d.code]);
    const sourceId = String(srcRows[0].id);

    const totalId = await ensureMetric(`${d.prefix}_TOTAL`, `${d.name} total leads`, "count", "higher_is_better");
    const connectedPctId = await ensureMetric(`${d.prefix}_CONNECTED_PCT`, `${d.name} connected %`, "pct", "higher_is_better");

    await saveDefinition({
      metric_id: totalId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "leads_total",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    await saveDefinition({
      metric_id: connectedPctId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "PCT(leads_connected, leads_total)",
      aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);

    console.log(`[SEED] ${d.prefix}_TOTAL / ${d.prefix}_CONNECTED_PCT wired`);
  }

  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
