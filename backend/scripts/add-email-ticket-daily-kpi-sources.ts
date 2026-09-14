/**
 * Wires email_ticket_daily_actual (the manual bulk-upload target created for
 * the Molecular Email / Reginald Men Email dashboards, sql/1700) into KPI
 * Studio so uploaded figures actually surface on a scorecard, per the
 * standing direction that a manually-uploaded data point belongs in KPI
 * Studio, not just sitting in a raw table.
 *
 * Two sources, not one: MOLECULAR and REGINALD_MEN are two separate report
 * instances of the identical shape (per their SOPs), both anchored to the
 * single "Reginald" process -- 'column' on dashboard_label, not 'constant',
 * so the same physical process gets two independently-computed sets of
 * numbers rather than one blended total that would double-count.
 *
 * CLOSURE_PCT's formula matches the SOP's own Dashboard-tab definition
 * exactly: Email Closure / (Opening Pending + Total Tickets + Email Reopen)
 * x 100 -- fidelity to the spec, including summing opening_pending (a daily
 * snapshot value) across the window, which is what the SOP's own
 * reconciliation check ("Sum rows vs top totals") does.
 *
 * Run with: npx tsx scripts/add-email-ticket-daily-kpi-sources.ts
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
    `SELECT id FROM process_master WHERE process_name = 'Reginald' AND active_status = 1 LIMIT 1`,
  );
  const processId = String(procRows[0].id);

  const dashboards: Array<{ code: string; label: "MOLECULAR" | "REGINALD_MEN"; name: string }> = [
    { code: "EMAIL_TICKETS_MOLECULAR", label: "MOLECULAR", name: "Molecular Email" },
    { code: "EMAIL_TICKETS_REGINALD_MEN", label: "REGINALD_MEN", name: "Reginald Men Email" },
  ];

  for (const d of dashboards) {
    const source = await saveDataSource({
      source_code: d.code,
      source_name: `${d.name} — daily ticket actuals`,
      source_type: "local_query",
      source_object: "email_ticket_daily_actual",
      date_column: "report_date",
      description: `Manually-uploaded daily ticket counts for the ${d.name} dashboard (sql/1700) -- the underlying ticketing DB (molecular_db_email) does not exist anywhere in this project's infrastructure.`,
      process_key_kind: "column",
      process_key_column: "dashboard_label",
      process_key_value: d.label,
      process_id: processId,
    } as never, CREATED_BY);
    const sourceId = String((source as { id: string }).id);

    await saveSourceField({ data_source_id: sourceId, field_name: "total_tickets", source_column: "total_tickets", aggregate_fn: "SUM" });
    await saveSourceField({ data_source_id: sourceId, field_name: "email_closed", source_column: "email_closed", aggregate_fn: "SUM" });
    await saveSourceField({ data_source_id: sourceId, field_name: "open_pending", source_column: "open_pending", aggregate_fn: "SUM" });
    await saveSourceField({ data_source_id: sourceId, field_name: "email_reopen", source_column: "email_reopen", aggregate_fn: "SUM" });
    await saveSourceField({ data_source_id: sourceId, field_name: "opening_pending", source_column: "opening_pending", aggregate_fn: "SUM" });

    console.log(`[SEED] ${d.code} source + fields wired`);
  }

  // Every metric below is per-dashboard, not shared: MOLECULAR and REGINALD_MEN
  // both scope to the same "Reginald" process_id, and saveDefinition upserts by
  // (metric_id, scope) -- a metric shared across both would let the second
  // dashboard's saveDefinition silently overwrite the first's (same collision
  // this file's own comment on LP_FEEDBACK/LP_REGIONAL flagged earlier tonight).
  for (const d of dashboards) {
    const [srcRows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_studio_data_source WHERE source_code = ?`, [d.code]);
    const sourceId = String(srcRows[0].id);
    const prefix = d.label === "MOLECULAR" ? "MOLECULAR" : "REGINALD_MEN";

    const totalId = await ensureMetric(`EMAIL_TOTAL_TICKETS_${prefix}`, `${d.name} tickets received`, "count", "higher_is_better");
    const closedId = await ensureMetric(`EMAIL_CLOSED_${prefix}`, `${d.name} closed`, "count", "higher_is_better");
    const openId = await ensureMetric(`EMAIL_OPEN_PENDING_${prefix}`, `${d.name} open/pending`, "count", "lower_is_better");
    const reopenId = await ensureMetric(`EMAIL_REOPEN_${prefix}`, `${d.name} reopened`, "count", "lower_is_better");
    const closureId = await ensureMetric(`EMAIL_CLOSURE_PCT_${prefix}`, `${d.name} closure rate`, "pct", "higher_is_better");

    await saveDefinition({
      metric_id: totalId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "total_tickets",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    await saveDefinition({
      metric_id: closedId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "email_closed",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    await saveDefinition({
      metric_id: openId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "open_pending",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    await saveDefinition({
      metric_id: reopenId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "email_reopen",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    // SUM(...), not "+": SUM ignores a missing opening_pending rather than
    // nulling the whole formula (opening_pending is nullable on purpose --
    // see email-ticket-daily-bulk.service.ts). Matches the SOP's own Dashboard-
    // tab formula: Email Closure / (Opening Pending + Total Tickets + Email Reopen) x 100.
    await saveDefinition({
      metric_id: closureId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: "PCT(email_closed, SUM(opening_pending, total_tickets, email_reopen))",
      aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);

    console.log(`[SEED] ${d.code}: total/closed/open/reopen/closure_pct wired`);
  }

  console.log("[SEED] Done.");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
