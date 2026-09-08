/**
 * Two additive KPI Studio gaps found by live SOP-vs-DB verification
 * (2026-09-08 session): DU Digital's Korea/Thailand campaigns had no source at
 * all (the existing DU_INBOUND_CDR source only covers DU_Bangladesh_* — that
 * was verified correct, not a bug, before writing this), and Lawyer Panel had
 * live, fresh CR_lp_* report tables but zero KPI Studio presence.
 *
 * Both additive: no existing source or definition is touched.
 *
 * Run with: npx tsx scripts/seed-du-korea-and-lp-kpi-sources.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { saveDataSource, saveSourceField, saveDefinition, createMetric } from "../src/modules/kpi/kpi-studio.service.js";
import type { RowDataPacket } from "mysql2";

const CREATED_BY = "demo-super-admin-id";
const DU_DIGITAL_PROCESS_ID = "050cc297-67ba-11f1-adb1-00155d0ab410";
const LAWYER_PANEL_PROCESS_ID = "050f3ee1-67ba-11f1-adb1-00155d0ab410";

// Confirmed live 2026-09-08: dialer_db.cdr_du_digital_korea distinct CampaignName values.
const DU_KOREA_THAILAND_CAMPAIGNS = [
  "South_Korea_IB", "South_KoreaIB1", "SouthKoreaEnglish", "SouthKoreaHindi", "SouthKoreaKorean",
  "South_Korea_New", "eVisa_Korea_English", "EVisa_Korea_Hindi", "EVisa_Korea_Korea",
  "Thailand_English", "ThailandThai", "Thailand_Hindi", "eVisa_Thai_Thai", "eVisa_Thai_English",
  "1212130", "1212131",
];

async function ensureMetric(code: string, name: string, unit: string, direction: "higher_is_better" | "lower_is_better") {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`, [code]);
  if (rows.length) return String(rows[0].id);
  const created = await createMetric({ metric_code: code, metric_name: name, unit, direction } as never);
  return String((created as { id: string }).id);
}

async function main() {
  // ── DU Korea/Thailand CDR ──────────────────────────────────────────────
  const duSource = await saveDataSource({
    source_code: "DU_KOREA_THAILAND_CDR",
    source_name: "DU Digital — Korea/Thailand CDR",
    source_type: "local_query",
    source_object: "dialer_db.cdr_du_digital_korea",
    date_column: "CallDate",
    description: "South Korea and Thailand inbound campaigns for DU Digital (dialer_db.cdr_du_digital_korea). "
      + "Sibling of DU_INBOUND_CDR, which covers only the DU_Bangladesh_* campaigns in dialer_db.cdr_in_4 — "
      + "the two never overlap, so both sources are additive, not competing.",
    // 'constant', not 'column': this table has no process_id column of its own — it
    // already belongs to one process by nature (the campaign-name filter below does
    // the real narrowing). 'column' was tried first and failed live with
    // ER_BAD_FIELD_ERROR ("Unknown column 'process_id'"), since buildProcessQueryPlan's
    // 'column' kind filters the RAW SOURCE TABLE by that column, not by a value on the
    // data source row.
    process_key_kind: "constant",
    process_id: DU_DIGITAL_PROCESS_ID,
  } as never, CREATED_BY);
  const duSourceId = String((duSource as { id: string }).id);

  const campaignFilter = { column: "CampaignName", op: "in", value: DU_KOREA_THAILAND_CAMPAIGNS };
  await saveSourceField({
    data_source_id: duSourceId, field_name: "offered", source_column: "CallDate", aggregate_fn: "COUNT",
    filter_json: [campaignFilter],
  } as never);
  // DisconnBy and AgentId are NULL on every row of this table (confirmed live,
  // 2026-09-08) — unlike the DU_Bangladesh cdr_in_4 table this was first modeled on,
  // where those columns carry real values. NULL <> 'x' is unknown, not true, so that
  // filter silently zeroed "answered" for every row rather than raising an error.
  // Disposition='A' is the real answered signal here (confirmed: 72 of 84 calls on
  // 2026-09-08 carry it; the rest are INCALL/NODISP/DROP).
  await saveSourceField({
    data_source_id: duSourceId, field_name: "answered", source_column: "CallDate", aggregate_fn: "COUNT",
    filter_json: [campaignFilter, { column: "Disposition", op: "eq", value: "A" }],
  } as never);
  await saveSourceField({
    data_source_id: duSourceId, field_name: "handle_seconds", source_column: "CallDurationSecond", aggregate_fn: "SUM",
    filter_json: [campaignFilter, { column: "Disposition", op: "eq", value: "A" }],
  } as never);

  const duOfferedMetricId = await ensureMetric("DU_KOREA_THAILAND_CALLS_OFFERED", "DU Korea/Thailand calls offered", "count", "higher_is_better");
  const duAnsweredMetricId = await ensureMetric("DU_KOREA_THAILAND_CALLS_ANSWERED", "DU Korea/Thailand calls answered", "count", "higher_is_better");

  await saveDefinition({
    metric_id: duOfferedMetricId, grain: "process", process_id: DU_DIGITAL_PROCESS_ID,
    data_source_id: duSourceId, formula_expression: "offered",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);
  await saveDefinition({
    metric_id: duAnsweredMetricId, grain: "process", process_id: DU_DIGITAL_PROCESS_ID,
    data_source_id: duSourceId, formula_expression: "answered",
    aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
  } as never, CREATED_BY);

  console.log("[SEED] DU_KOREA_THAILAND_CDR wired:", duSourceId);

  // ── Lawyer Panel: 3 live report tables, each its own source ────────────
  const lpTables: Array<{ code: string; label: string; table: string; dateCol: string }> = [
    { code: "LP_FEEDBACK", label: "Feedback", table: "db_masmis.CR_lp_feedback", dateCol: "ConnectedTime" },
    { code: "LP_REGIONAL", label: "Regional", table: "db_masmis.CR_lp_regional", dateCol: "connected_time" },
    { code: "LP_NON_REGIONAL", label: "Non-Regional", table: "db_masmis.CR_lp_non_regional", dateCol: "connected_time" },
  ];

  // Separate metric per table, not one shared metric across all three: saveDefinition
  // upserts on (metric_id, scope), and scope here is just the process — three sources
  // sharing one metric+process would each overwrite the last one's definition instead
  // of coexisting (Lawyer Panel is one process, all three CR_lp_* tables belong to it).
  for (const t of lpTables) {
    const callsMetricId = await ensureMetric(`LP_${t.code}_TOTAL_CALLS`, `Lawyer Panel ${t.label} total calls`, "count", "higher_is_better");
    const talkMinutesMetricId = await ensureMetric(`LP_${t.code}_TALK_MINUTES`, `Lawyer Panel ${t.label} total talk minutes`, "minutes", "higher_is_better");
    const src = await saveDataSource({
      source_code: t.code,
      source_name: `Lawyer Panel — ${t.label}`,
      source_type: "local_query",
      source_object: t.table,
      date_column: t.dateCol,
      description: `Live upload-based CR report for Lawyer Panel (${t.label}). Confirmed fresh 2026-09-08.`,
      // Same 'constant' correction as DU_KOREA_THAILAND_CDR above — none of the three
      // CR_lp_* tables carry a process_id column either.
      process_key_kind: "constant",
      process_id: LAWYER_PANEL_PROCESS_ID,
    } as never, CREATED_BY);
    const srcId = String((src as { id: string }).id);

    const durationCol = t.table.endsWith("CR_lp_feedback") ? "CallDurationMinutes" : "call_duration";
    await saveSourceField({ data_source_id: srcId, field_name: "total_calls", source_column: t.dateCol, aggregate_fn: "COUNT" });
    await saveSourceField({ data_source_id: srcId, field_name: "talk_minutes", source_column: durationCol, aggregate_fn: "SUM" });

    await saveDefinition({
      metric_id: callsMetricId, grain: "process", process_id: LAWYER_PANEL_PROCESS_ID,
      data_source_id: srcId, formula_expression: "total_calls",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
    await saveDefinition({
      metric_id: talkMinutesMetricId, grain: "process", process_id: LAWYER_PANEL_PROCESS_ID,
      data_source_id: srcId, formula_expression: "talk_minutes",
      aggregation_method: "sum", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);

    console.log(`[SEED] ${t.code} wired:`, srcId);
  }

  console.log("[SEED] Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[SEED] FAILED", e);
  process.exit(1);
});
