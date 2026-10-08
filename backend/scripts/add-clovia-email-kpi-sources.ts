/**
 * Wires clovia_email_daily_actual (sql/1703) into KPI Studio, same reasoning
 * as every other manual-upload target built tonight.
 *
 * Run with: npx tsx scripts/add-clovia-email-kpi-sources.ts
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
    source_code: "CLOVIA_EMAIL_DAILY",
    source_name: "Clovia — Email Tracker (daily)",
    source_type: "local_query",
    source_object: "clovia_email_daily_actual",
    date_column: "report_date",
    description: "Manually-uploaded daily per-agent email counts (sql/1703) -- columns read verbatim from the live 'Clovia Email Tracker Sept'26.xlsb' workbook; no DB backing exists for this data anywhere.",
    process_key_kind: "constant",
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "total_mail_assigned", source_column: "total_mail_assigned", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "closed_email", source_column: "closed_email", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "re_open", source_column: "re_open", aggregate_fn: "SUM" });
  await saveSourceField({ data_source_id: sourceId, field_name: "open_email", source_column: "open_email", aggregate_fn: "SUM" });

  const assignedId = await ensureMetric("CLOVIA_EMAIL_ASSIGNED", "Clovia email assigned", "count", "higher_is_better");
  const closedId = await ensureMetric("CLOVIA_EMAIL_CLOSED", "Clovia email closed", "count", "higher_is_better");
  const closurePctId = await ensureMetric("CLOVIA_EMAIL_CLOSURE_PCT", "Clovia email closure rate", "pct", "higher_is_better");

  await saveDefinition({
    metric_id: assignedId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "total_mail_assigned",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: closedId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "closed_email",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: closurePctId, grain: "process", process_id: processId,
    data_source_id: sourceId, formula_expression: "PCT(closed_email, total_mail_assigned)",
    aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] CLOVIA_EMAIL_DAILY wired: assigned, closed, closure%");
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
