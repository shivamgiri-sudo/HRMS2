/**
 * One-off setup: registers process_delivery_actual and tni_finding as KPI Studio
 * process-grain sources, one row per active process (process-grain sources are
 * one-process-per-row by design — see buildProcessQueryPlan's process_key_value
 * constant-filter model in kpi-studio.sources.ts). Creates matching definitions
 * so each process's scorecard can show delivery/quality units and open TNI
 * finding counts without a separate manual upload, since both tables already
 * carry a native process_id column.
 *
 * Safe to re-run: saveDataSource/saveDefinition are both upsert-shaped keyed by
 * source_code / (metric_id, scope), so a second run updates rather than
 * duplicates.
 *
 * Run with: npx tsx scripts/seed-tni-and-delivery-kpi-sources.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { saveDataSource, saveSourceField, saveDefinition, createMetric } from "../src/modules/kpi/kpi-studio.service.js";
import type { RowDataPacket } from "mysql2";

const CREATED_BY = "demo-super-admin-id";

async function getActiveProcesses(): Promise<{ id: string; name: string }[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, process_name AS name FROM process_master WHERE active_status = 1`
  );
  return (rows as RowDataPacket[]).map((r) => ({ id: String(r.id), name: String(r.name) }));
}

async function ensureMetric(code: string, name: string, unit: string, direction: "higher_is_better" | "lower_is_better") {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`,
    [code]
  );
  if (rows.length) return String(rows[0].id);
  const created = await createMetric({ metric_code: code, metric_name: name, unit, direction, created_by: CREATED_BY } as never);
  return String((created as { id: string }).id);
}

async function main() {
  const processes = await getActiveProcesses();
  console.log(`[SEED] ${processes.length} active processes`);

  const deliveredUnitsMetricId = await ensureMetric("PROCESS_DELIVERED_UNITS", "Delivered units", "count", "higher_is_better");
  const qualityScoreMetricId = await ensureMetric("PROCESS_DELIVERY_QUALITY", "Delivery quality score", "pct", "higher_is_better");
  const openTniMetricId = await ensureMetric("PROCESS_OPEN_TNI_COUNT", "Open TNI findings", "count", "lower_is_better");
  const extremeTniMetricId = await ensureMetric("PROCESS_EXTREME_TNI_COUNT", "Extreme-review TNI findings", "count", "lower_is_better");

  let created = 0;
  for (const proc of processes) {
    // ── process_delivery_actual ────────────────────────────────────────────
    const pdaCode = `PROCESS_DELIVERY_${proc.id.slice(0, 8).toUpperCase()}`;
    const pdaSource = await saveDataSource({
      source_code: pdaCode,
      source_name: `Process delivery actuals — ${proc.name}`,
      source_type: "local_query",
      source_object: "process_delivery_actual",
      date_column: "activity_date",
      description: "Bulk-uploaded process delivery actuals (units delivered/accepted, quality/SLA score) for this process.",
      process_key_kind: "column",
      process_key_column: "process_id",
      process_key_value: proc.id,
      process_id: proc.id,
    } as never, CREATED_BY);
    const pdaSourceId = String((pdaSource as { id: string }).id);

    await saveSourceField({ data_source_id: pdaSourceId, field_name: "delivered_units", source_column: "delivered_units", aggregate_fn: "SUM" });
    await saveSourceField({ data_source_id: pdaSourceId, field_name: "quality_score", source_column: "quality_score", aggregate_fn: "AVG" });

    await saveDefinition({
      metric_id: deliveredUnitsMetricId, grain: "process", process_id: proc.id,
      data_source_id: pdaSourceId, formula_expression: "delivered_units",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none",
      created_by: CREATED_BY,
    } as never, CREATED_BY);

    await saveDefinition({
      metric_id: qualityScoreMetricId, grain: "process", process_id: proc.id,
      data_source_id: pdaSourceId, formula_expression: "quality_score",
      aggregation_method: "average", scoring_type: "raw", target_source: "none",
      created_by: CREATED_BY,
    } as never, CREATED_BY);

    // ── tni_finding ─────────────────────────────────────────────────────────
    const tniCode = `TNI_FINDING_${proc.id.slice(0, 8).toUpperCase()}`;
    const tniSource = await saveDataSource({
      source_code: tniCode,
      source_name: `TNI findings — ${proc.name}`,
      source_type: "local_query",
      source_object: "tni_finding",
      date_column: "raised_at",
      description: "Training-need findings raised against this process (from tni_finding, status lifecycle OPEN..VERIFIED).",
      process_key_kind: "column",
      process_key_column: "process_id",
      process_key_value: proc.id,
      process_id: proc.id,
    } as never, CREATED_BY);
    const tniSourceId = String((tniSource as { id: string }).id);

    // Two counting fields: total open-ish findings, and extreme-review findings.
    // COUNT with a filter on status/severity — filter_json narrows what THIS field counts.
    await saveSourceField({
      data_source_id: tniSourceId, field_name: "open_findings", source_column: "id", aggregate_fn: "COUNT",
      filter_json: [{ column: "status", op: "in", value: ["OPEN", "ASSIGNED", "IN_PROGRESS"] }],
    } as never);
    await saveSourceField({
      data_source_id: tniSourceId, field_name: "extreme_findings", source_column: "id", aggregate_fn: "COUNT",
      filter_json: [{ column: "severity", op: "eq", value: "EXTREME_REVIEW" }],
    } as never);

    await saveDefinition({
      metric_id: openTniMetricId, grain: "process", process_id: proc.id,
      data_source_id: tniSourceId, formula_expression: "open_findings",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none",
      created_by: CREATED_BY,
    } as never, CREATED_BY);

    await saveDefinition({
      metric_id: extremeTniMetricId, grain: "process", process_id: proc.id,
      data_source_id: tniSourceId, formula_expression: "extreme_findings",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none",
      created_by: CREATED_BY,
    } as never, CREATED_BY);

    created++;
    if (created % 10 === 0) console.log(`[SEED] ${created}/${processes.length} processes done`);
  }

  console.log(`[SEED] Done. ${created} processes wired for PROCESS_DELIVERY_* and TNI_FINDING_* sources.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[SEED] FAILED", e);
  process.exit(1);
});
