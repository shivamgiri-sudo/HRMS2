/**
 * Wires the existing AI call-analysis layer (db_masmis.outbound_call_insights
 * = RISK_*, db_masmis.magical_script_cache = FUNNEL_*) for Housing Premium
 * (client_id 419), Housing Owner (496) and Lawyer Panel (498) -- the same
 * two tables and metric shapes already wired for many other clients
 * (RISK_487/475/409/481/489/497, FUNNEL_487/475/468/375/489/481/497/409),
 * just never extended to these three, even though their real data is
 * already live and current (419 through 2026-09-08, 496 through 2026-09-09,
 * 498 through 2026-08-24).
 *
 * Enhancement, not a gap fill: these processes' core call data is already
 * covered (Housing Premium/Owner via HOUSING_*_CR_LIVE added this session,
 * Lawyer Panel via the pre-existing LP_REGIONAL/LP_NON_REGIONAL/LP_FEEDBACK).
 * This adds the AI risk-signal and pitch-funnel layer on top, matching what
 * every other AI-covered client already has.
 *
 * Run with: npx tsx scripts/add-housing-lp-ai-insights-kpi-sources.ts
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

const TARGETS: Array<{ clientId: string; processName: string; label: string }> = [
  { clientId: "419", processName: "Housing Premium", label: "Housing Premium" },
  { clientId: "496", processName: "Housing Owner", label: "Housing Owner" },
  { clientId: "498", processName: "Lawyer Panel", label: "Lawyer Panel" },
];

async function wireRisk(clientId: string, processName: string, label: string) {
  const [procRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM process_master WHERE process_name = ? LIMIT 1`, [processName],
  );
  const processId = String(procRows[0].id);

  const source = await saveDataSource({
    source_code: `RISK_${clientId}`,
    source_name: `${label} — AI Risk Signals`,
    source_type: "local_query",
    source_object: "db_masmis.outbound_call_insights",
    date_column: "call_date",
    description: `${label}'s AI-scored risk/sentiment signal layer, same table and metric shape already wired for other clients (RISK_487/475/409/481/489/497).`,
    process_key_kind: "column",
    process_key_column: "client_id",
    process_key_value: clientId,
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "insights", source_column: "call_date", aggregate_fn: "COUNT" });
  await saveSourceField({ data_source_id: sourceId, field_name: "refund", source_column: "call_date", aggregate_fn: "COUNT", filter_json: [{ column: "refund_flag", op: "eq", value: "1" }] } as never);
  await saveSourceField({ data_source_id: sourceId, field_name: "cancel", source_column: "call_date", aggregate_fn: "COUNT", filter_json: [{ column: "cancellation_flag", op: "eq", value: "1" }] } as never);
  await saveSourceField({ data_source_id: sourceId, field_name: "scam", source_column: "call_date", aggregate_fn: "COUNT", filter_json: [{ column: "scam_flag", op: "eq", value: "1" }] } as never);
  await saveSourceField({ data_source_id: sourceId, field_name: "social", source_column: "call_date", aggregate_fn: "COUNT", filter_json: [{ column: "social_flag", op: "eq", value: "1" }] } as never);
  await saveSourceField({ data_source_id: sourceId, field_name: "legal", source_column: "call_date", aggregate_fn: "COUNT", filter_json: [{ column: "legal_flag", op: "eq", value: "1" }] } as never);
  await saveSourceField({ data_source_id: sourceId, field_name: "gpos", source_column: "call_date", aggregate_fn: "COUNT", filter_json: [{ column: "golden_positive", op: "eq", value: "1" }] } as never);

  const refundId = await ensureMetric("RISK_REFUND_PCT", `${label} refund-demand %`, "pct", "lower_is_better");
  const cancelId = await ensureMetric("RISK_CANCELLATION_PCT", `${label} cancellation-request %`, "pct", "lower_is_better");
  const scamId = await ensureMetric("RISK_SCAM_PCT", `${label} called-a-scam %`, "pct", "lower_is_better");
  const socialId = await ensureMetric("RISK_SOCIAL_PCT", `${label} social-media-threat %`, "pct", "lower_is_better");
  const legalId = await ensureMetric("RISK_LEGAL_PCT", `${label} legal-action-mentioned %`, "pct", "lower_is_better");
  const sentId = await ensureMetric("SENTIMENT_POSITIVE_PCT", `${label} positive-sentiment %`, "pct", "higher_is_better");

  for (const [metricId, expr] of [
    [refundId, "PCT(refund, insights)"],
    [cancelId, "PCT(cancel, insights)"],
    [scamId, "PCT(scam, insights)"],
    [socialId, "PCT(social, insights)"],
    [legalId, "PCT(legal, insights)"],
    [sentId, "PCT(gpos, insights)"],
  ] as const) {
    await saveDefinition({
      metric_id: metricId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: expr,
      aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
  }

  console.log(`[SEED] RISK_${clientId} (${label}) wired: refund/cancellation/scam/social/legal %, positive sentiment %`);
}

async function wireFunnel(clientId: string, processName: string, label: string) {
  const [procRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM process_master WHERE process_name = ? LIMIT 1`, [processName],
  );
  const processId = String(procRows[0].id);

  const source = await saveDataSource({
    source_code: `FUNNEL_${clientId}`,
    source_name: `${label} — AI Pitch Funnel`,
    source_type: "local_query",
    source_object: "db_masmis.magical_script_cache",
    date_column: "call_date",
    description: `${label}'s AI-scored pitch/opening/offer/sale funnel, same table and metric shape already wired for other clients (FUNNEL_487/475/468/375/489/481/497/409).`,
    process_key_kind: "column",
    process_key_column: "client_id",
    process_key_value: clientId,
    process_id: processId,
  } as never, CREATED_BY);
  const sourceId = String((source as { id: string }).id);

  await saveSourceField({ data_source_id: sourceId, field_name: "calls", source_column: "call_date", aggregate_fn: "COUNT" });
  await saveSourceField({ data_source_id: sourceId, field_name: "scored", source_column: "op_success", aggregate_fn: "COUNT", filter_json: [{ column: "op_success", op: "is_not_null", value: null }] } as never);
  await saveSourceField({ data_source_id: sourceId, field_name: "opened", source_column: "call_date", aggregate_fn: "COUNT", filter_json: [{ column: "op_success", op: "eq", value: "1" }] } as never);
  await saveSourceField({ data_source_id: sourceId, field_name: "offered", source_column: "call_date", aggregate_fn: "COUNT", filter_json: [{ column: "offer_success", op: "eq", value: "1" }] } as never);
  await saveSourceField({ data_source_id: sourceId, field_name: "sold", source_column: "call_date", aggregate_fn: "COUNT", filter_json: [{ column: "sale_done", op: "eq", value: "1" }] } as never);

  const scoredId = await ensureMetric("FUNNEL_SCORED_PCT", `${label} AI-scored %`, "pct", "higher_is_better");
  const openId = await ensureMetric("FUNNEL_OPENING_PCT", `${label} opening-accepted %`, "pct", "higher_is_better");
  const offerId = await ensureMetric("FUNNEL_OFFER_PCT", `${label} offer-accepted %`, "pct", "higher_is_better");
  const saleId = await ensureMetric("FUNNEL_SALE_PCT", `${label} sale-closed %`, "pct", "higher_is_better");
  const offerToSaleId = await ensureMetric("FUNNEL_OFFER_TO_SALE_PCT", `${label} offer-to-sale %`, "pct", "higher_is_better");

  for (const [metricId, expr] of [
    [scoredId, "PCT(scored, calls)"],
    [openId, "PCT(opened, scored)"],
    [offerId, "PCT(offered, scored)"],
    [saleId, "PCT(sold, scored)"],
    [offerToSaleId, "PCT(sold, offered)"],
  ] as const) {
    await saveDefinition({
      metric_id: metricId, grain: "process", process_id: processId,
      data_source_id: sourceId, formula_expression: expr,
      aggregation_method: "average", scoring_type: "raw", target_source: "none", created_by: CREATED_BY,
    } as never, CREATED_BY);
  }

  console.log(`[SEED] FUNNEL_${clientId} (${label}) wired: scored/opening/offer/sale %, offer-to-sale %`);
}

async function main() {
  for (const t of TARGETS) {
    await wireRisk(t.clientId, t.processName, t.label);
    await wireFunnel(t.clientId, t.processName, t.label);
  }
  process.exit(0);
}
main().catch((e) => { console.error("[SEED] FAILED", e); process.exit(1); });
