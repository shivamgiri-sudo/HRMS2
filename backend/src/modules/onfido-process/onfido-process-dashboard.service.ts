import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import { ONFIDO_REPORT_CONFIGS } from "../bulk-upload/onfido-report-configs.js";
import { ensureOnfidoTableColumns } from "../bulk-upload/onfido-schema-sync.js";

/**
 * Onfido process KPI/Quality/Operations dashboard.
 *
 * Reads only from onfido_db — the raw-data warehouse the bulk-upload pipeline fills
 * (see onfido-raw-bulk.service.ts). Same honesty rule as process-performance.service.ts:
 * a section either returns a number computed from real rows, or explains why it
 * cannot (availability: 'no_data'), never a placeholder. There is no cross-table SQL
 * join here because each report table lives in its own onfido_db table with its own
 * shape — aggregates are computed per table and combined in application code, the
 * same approach process-performance.service.ts uses for its own multi-source rollups.
 */

export type Availability = "ok" | "no_data";

export interface KpiValue {
  /** Stable id used to ask for this metric's drill-down (getMetricBreakdown / listRecords). */
  key: string;
  label: string;
  value: number | null;
  unit: "count" | "percent" | "seconds" | null;
  availability: Availability;
  note?: string;
}

export interface PerfFilters {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  tlName?: string | null;
}

// Fallback only — the frontend always sends an explicit from/to (see its own
// defaultRange()), so this only fires for a direct API call that omits them.
// Kept consistent with the frontend's own fix: every Onfido source table is a
// lagged batch upload (real data stops days-to-weeks before "today"), so a
// "1st of this month" anchor is frequently an empty window; trailing 90 days
// reliably covers the last real upload regardless of what day it is.
function readFilters(raw: { from?: string; to?: string; tlName?: string }): PerfFilters {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 90);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    from: raw.from || iso(start),
    to: raw.to || iso(today),
    tlName: raw.tlName || null,
  };
}

export { readFilters };

// ── DOC AHT rule (2026-09-18 owner feedback) ─────────────────────────────────
//
// "Doc AHT — we don't consider task type process_labelling_document_raw_extraction.
// Excluding that task type, every place should show the average AHT." Verified against
// the client's own GD/MCN/SLA sheet, whose per-day "Doc AHT" is exactly this average:
// 1-Sep-26 = 111.50s here with the labelling type excluded, 124.60s with it included.
//
// The task type lives in the row's raw_data ("Task Information Task Type Old"); the
// older "Task Type Short Name" key is blank on ~99% of rows and cannot carry it.
// A VIRTUAL generated column over raw_data."Task Information Task Type Old", indexed together with
// report_date and manual_processing_time_secs so the AHT averages never have to read the 2.6 GB JSON.
// Created by scripts/onfido-add-doc-task-type-index.ts (and by onfido-doc-task-type-column.ts if absent).
export const DOC_TASK_TYPE_EXPR = "doc_task_type_old";
/** The task type as a label: the Old key first, the Short Name key (populated on a
 *  small tail of rows) as a fallback, NULL when both are blank. */
export const DOC_TASK_TYPE_LABEL_EXPR =
  `COALESCE(NULLIF(TRIM(${DOC_TASK_TYPE_EXPR}), ''), NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."Task Type Short Name"'))), ''))`;
const DOC_AHT_EXCLUDED_TASK_TYPE = "process_labelling_document_raw_extraction";
/** WHERE fragment matching the DOC rows that count toward AHT. */
export const DOC_AHT_ROW_FILTER = `COALESCE(${DOC_TASK_TYPE_EXPR}, '') <> '${DOC_AHT_EXCLUDED_TASK_TYPE}'`;
/** Drop-in replacement for AVG(manual_processing_time_secs) on onfido_doc_raw. */
export const DOC_AHT_AVG = `AVG(CASE WHEN ${DOC_AHT_ROW_FILTER} THEN manual_processing_time_secs END)`;

// ── POA figures are POA-raw only (2026-09-18 owner feedback) ─────────────────
//
// The Overview/POA pages used to fold onfido_poa_trial_raw (a separate trial-queue
// export, ~124 reports) into POA volume, AHT and the trends ("Raw + Trial Combined").
// The owner asked for POA alone — trial reports have their own POA Trial tab — and the
// client's own GD/MCN/SLA sheet reproduces the POA-raw-only per-day AHT exactly
// (2-Sep-26: 191.32s both). Every query that merged the trial table now reads this
// always-empty source instead, so the merge code stays in place and is one constant
// to flip back. The standalone POA Trial tab queries the real table and is unaffected.
const POA_TRIAL_MERGE_SOURCE = "(SELECT * FROM onfido_poa_trial_raw WHERE 1 = 0) AS poa_trial_not_counted";

/**
 * mysql2 returns SUM()/COUNT()-on-BIGINT-column results as STRINGS, not numbers (the
 * driver's default so a value beyond Number.MAX_SAFE_INTEGER doesn't silently lose
 * precision). Every query in this file adds two of these together — "1" + "37" is the
 * string "137", not 38 — confirmed live: POA's error rate showed "1 error(s) across 137
 * audit(s)" instead of 38 before this coercion. Numeric-looking strings are converted to
 * numbers right after the row comes back, so every caller downstream gets real numbers.
 */
function coerceNumericStrings<T extends RowDataPacket>(row: T): T {
  if (!row) return row;
  const out = { ...row } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      out[key] = Number(v);
    }
  }
  return out as T;
}

async function scalar<T extends RowDataPacket>(sql: string, params: unknown[]): Promise<T> {
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<T[]>(sql, params);
  return coerceNumericStrings(rows[0]);
}

/**
 * Overview KPI cards for the selected date range. DOC and POA are kept separate
 * throughout — they are different queues with different SLAs (see the Onfido
 * Charter's per-queue AHT benchmarks) and blending them would hide which queue an
 * issue actually belongs to.
 */
export async function getOverview(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }) {
  const f = readFilters(rawFilters);
  const amName = rawFilters.amName || null;
  const tlClause = f.tlName ? "AND tl_name = ?" : "";
  const tlParam = f.tlName ? [f.tlName] : [];
  const amClause = amName ? "AND am_name = ?" : "";
  const amParam = amName ? [amName] : [];
  const filterClause = `${tlClause} ${amClause}`;
  const filterParams = [...tlParam, ...amParam];

  const docVolume = await scalar<RowDataPacket & { n: number; aht: number | null; esc: number }>(
    `SELECT COUNT(*) AS n, ${DOC_AHT_AVG} AS aht, SUM(is_escalated) AS esc
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );

  const docQuality = await scalar<RowDataPacket & { audits: number; errors: number }>(
    `SELECT COALESCE(SUM(total_audits),0) AS audits, COALESCE(SUM(total_error),0) AS errors
       FROM onfido_doc_quality_raw WHERE task_complete_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );

  // "lines" is a reserved word in MySQL (LOAD DATA ... LINES TERMINATED BY) — using it as
  // a bare column alias fails to parse; line_count sidesteps that.
  // Dated by qc_updated_date (when QC actually logged/reviewed the escalation),
  // not report_completed_date (when the underlying DOC report was originally
  // completed, which can be a year-plus earlier) — see the Escalations section
  // below for the full rationale.
  const cre = await scalar<RowDataPacket & { line_count: number; reports: number }>(
    `SELECT COUNT(*) AS line_count, COUNT(DISTINCT ims_report_url) AS reports
       FROM onfido_doc_escalation_cre_raw WHERE qc_updated_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );
  const crq = await scalar<RowDataPacket & { line_count: number; reports: number }>(
    `SELECT COUNT(*) AS line_count, COUNT(DISTINCT ims_report_url) AS reports
       FROM onfido_doc_escalation_crq_raw WHERE qc_updated_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );

  // DOC external audit quality metrics — FAR%, FRR%, classification%, extraction%.
  // Denominator comes from the per-row total columns (SUM of stage-specific audit counts),
  // not COUNT(*) — the reference dashboard formula: FAR% = SUM(far_flag) / SUM(far_total).
  const docExtQuality = await scalar<RowDataPacket & {
    audits: number; errors: number;
    farN: number; farTotal: number; frrN: number; frrTotal: number;
    classN: number; classTotal: number; extN: number; extTotal: number;
  }>(
    `SELECT COUNT(*) AS audits, COALESCE(SUM(has_error),0) AS errors,
            COALESCE(SUM(manual_far_flag),0) AS farN, COALESCE(SUM(manual_far_total),0) AS farTotal,
            COALESCE(SUM(manual_frr_flag),0) AS frrN, COALESCE(SUM(manual_frr_total),0) AS frrTotal,
            COALESCE(SUM(classification_flag),0) AS classN, COALESCE(SUM(classification_total),0) AS classTotal,
            COALESCE(SUM(extraction_flag),0) AS extN, COALESCE(SUM(extraction_total),0) AS extTotal
       FROM onfido_doc_external_audit_raw WHERE report_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );

  const poaVolume = await scalar<RowDataPacket & { n: number; aht: number | null }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );
  const poaTrial = await scalar<RowDataPacket & { n: number; aht: number | null }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM ${POA_TRIAL_MERGE_SOURCE} WHERE report_completed_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );
  // Volume-weighted combine, not an average-of-averages: onfido_poa_raw and
  // onfido_poa_trial_raw are two file formats for the same real POA queue (see
  // getPoaBreakdown's identical ahtSum/ahtN pattern below), so a report from
  // either table should count equally toward the combined AHT, not have each
  // table's average count equally regardless of how many reports it covers.
  const poaAhtWeightedSum =
    (poaVolume.aht !== null ? poaVolume.aht * poaVolume.n : 0) +
    (poaTrial.aht !== null ? poaTrial.aht * poaTrial.n : 0);
  const poaAhtWeightedCount =
    (poaVolume.aht !== null ? poaVolume.n : 0) + (poaTrial.aht !== null ? poaTrial.n : 0);
  const poaCombinedAht = poaAhtWeightedCount > 0 ? poaAhtWeightedSum / poaAhtWeightedCount : null;
  const poaQuality = await scalar<RowDataPacket & { errors: number; noErrors: number }>(
    `SELECT COALESCE(SUM(error_count),0) AS errors, COALESCE(SUM(no_error_count),0) AS noErrors
       FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );

  const poaSub = await scalar<RowDataPacket & { qc: number; classification: number; extraction: number; dataComparison: number }>(
    `SELECT COALESCE(SUM(total_qc),0) AS qc, COALESCE(SUM(classification_error),0) AS classification,
            COALESCE(SUM(extraction_error),0) AS extraction, COALESCE(SUM(data_comparison_error),0) AS dataComparison
       FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );

  const kpi = (
    key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string
  ): KpiValue => ({
    key, label, value, unit,
    availability: value === null ? "no_data" : "ok",
    note,
  });

  const docErrorRate = docQuality.audits > 0 ? (docQuality.errors / docQuality.audits) * 100 : null;
  // Error rate = SUM(Error) / (SUM(Error) + SUM(No Error)) — the file's own per-row
  // Error/No Error columns (owner-specified formula), not a proxy off overall_result.
  const poaQualityTotal = poaQuality.errors + poaQuality.noErrors;
  const poaErrorRate = poaQualityTotal > 0 ? (poaQuality.errors / poaQualityTotal) * 100 : null;
  const docEscRate = docVolume.n > 0 ? ((docVolume.esc ?? 0) / docVolume.n) * 100 : null;
  // Each sub-component uses the same denominator as the overall rate (Total QC),
  // per the owner's formula: Classification Error% = SUM(Classification Error) / Total Audit.
  const rate = (numerator: number, denominator: number) =>
    denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;

  return {
    filters: f,
    doc: {
      volume: kpi("doc_volume", "DOC Tasks Processed", docVolume.n, "count"),
      avgAht: kpi("doc_aht", "DOC Avg Handling Time", docVolume.aht !== null ? Math.round(docVolume.aht) : null, "seconds"),
      escalationRate: kpi("doc_escalation_rate", "DOC Escalation Rate", docEscRate !== null ? Math.round(docEscRate * 10) / 10 : null, "percent"),
      auditErrorRate: kpi(
        "doc_audit_error_rate", "DOC Audit Error Rate", docErrorRate !== null ? Math.round(docErrorRate * 10) / 10 : null, "percent",
        `${docQuality.errors} error(s) across ${docQuality.audits} audit(s)`
      ),
      clientEscalationLines: kpi(
        "doc_client_escalations", "DOC Client-Reported Errors (lines)", (cre.line_count ?? 0) + (crq.line_count ?? 0), "count",
        `${cre.reports ?? 0} distinct CRE report(s), ${crq.reports ?? 0} distinct CRQ report(s)`
      ),
      manualFarRate: kpi(
        "doc_manual_far_rate", "DOC Manual FAR%",
        rate(Number(docExtQuality.farN), Number(docExtQuality.farTotal)), "percent",
        Number(docExtQuality.farTotal) > 0
          ? `${docExtQuality.farN} errors of ${docExtQuality.farTotal} FAR audits`
          : "no FAR audits in range"
      ),
      manualFrrRate: kpi(
        "doc_manual_frr_rate", "DOC Manual FRR%",
        rate(Number(docExtQuality.frrN), Number(docExtQuality.frrTotal)), "percent",
        Number(docExtQuality.frrTotal) > 0
          ? `${docExtQuality.frrN} errors of ${docExtQuality.frrTotal} FRR audits`
          : "no FRR audits in range"
      ),
      classificationRate: kpi(
        "doc_classification_rate", "DOC Classification Error%",
        rate(Number(docExtQuality.classN), Number(docExtQuality.classTotal)), "percent",
        Number(docExtQuality.classTotal) > 0
          ? `${docExtQuality.classN} of ${docExtQuality.classTotal} classification audits`
          : "no classification audits in range"
      ),
      extractionRate: kpi(
        "doc_extraction_rate", "DOC Extraction Error%",
        rate(Number(docExtQuality.extN), Number(docExtQuality.extTotal)), "percent",
        Number(docExtQuality.extTotal) > 0
          ? `${docExtQuality.extN} of ${docExtQuality.extTotal} extraction audits`
          : "no extraction audits in range"
      ),
    },
    poa: {
      volume: kpi("poa_volume", "POA Reports Processed", (poaVolume.n ?? 0) + (poaTrial.n ?? 0), "count",
        poaTrial.n > 0 ? `includes ${poaTrial.n} trial-queue report(s)` : undefined),
      avgAht: kpi("poa_aht", "POA Avg Handling Time", poaCombinedAht !== null ? Math.round(poaCombinedAht) : null, "seconds"),
      errorRate: kpi("poa_error_rate", "POA Audit Error Rate", poaErrorRate !== null ? Math.round(poaErrorRate * 10) / 10 : null, "percent",
        poaQualityTotal > 0 ? `${poaQuality.errors} error(s) across ${poaQualityTotal} audit(s)` : "no POA audits in range"),
      classificationErrorRate: kpi(
        "poa_error_classification", "POA Classification Error Rate", rate(poaSub.classification, poaSub.qc), "percent",
        `${poaSub.classification} of ${poaSub.qc} QC(s)`
      ),
      extractionErrorRate: kpi(
        "poa_error_extraction", "POA Extraction Error Rate", rate(poaSub.extraction, poaSub.qc), "percent",
        `${poaSub.extraction} of ${poaSub.qc} QC(s)`
      ),
      dataComparisonErrorRate: kpi(
        "poa_error_data_comparison", "POA Data Comparison Error Rate", rate(poaSub.dataComparison, poaSub.qc), "percent",
        `${poaSub.dataComparison} of ${poaSub.qc} QC(s)`
      ),
    },
  };
}

export interface TlBreakdownRow {
  tlName: string;
  docVolume: number;
  docAvgAht: number | null;
  docEscalations: number;
  docAuditErrorRate: number | null;
  escalationLines: number;
  manualFarRate: number | null;
  manualFrrRate: number | null;
  classificationRate: number | null;
  extractionRate: number | null;
}

/** Per-TL rollup for the same date range — the table the KPI cards drill into. */
export async function getTlBreakdown(rawFilters: { from?: string; to?: string }): Promise<TlBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();

  const [docRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name,
            COUNT(*) AS n, ${DOC_AHT_AVG} AS aht, SUM(is_escalated) AS esc
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ?
       GROUP BY tl_name`,
    [f.from, f.to]
  );
  const [qualityRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name,
            COALESCE(SUM(total_audits),0) AS audits, COALESCE(SUM(total_error),0) AS errors
       FROM onfido_doc_quality_raw WHERE task_complete_date BETWEEN ? AND ?
       GROUP BY tl_name`,
    [f.from, f.to]
  );
  const [creRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name, COUNT(*) AS n
       FROM onfido_doc_escalation_cre_raw WHERE qc_updated_date BETWEEN ? AND ?
       GROUP BY tl_name`,
    [f.from, f.to]
  );
  const [crqRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name, COUNT(*) AS n
       FROM onfido_doc_escalation_crq_raw WHERE qc_updated_date BETWEEN ? AND ?
       GROUP BY tl_name`,
    [f.from, f.to]
  );
  const [extAuditRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name,
            COALESCE(SUM(manual_far_flag),0) AS farN, COALESCE(SUM(manual_far_total),0) AS farTotal,
            COALESCE(SUM(manual_frr_flag),0) AS frrN, COALESCE(SUM(manual_frr_total),0) AS frrTotal,
            COALESCE(SUM(classification_flag),0) AS classN, COALESCE(SUM(classification_total),0) AS classTotal,
            COALESCE(SUM(extraction_flag),0) AS extN, COALESCE(SUM(extraction_total),0) AS extTotal
       FROM onfido_doc_external_audit_raw WHERE report_date BETWEEN ? AND ?
       GROUP BY tl_name`,
    [f.from, f.to]
  );

  const qualityByTl = new Map(qualityRows.map((r) => [r.tl_name, r]));
  const extAuditByTl = new Map(extAuditRows.map((r) => [r.tl_name as string, r]));
  const escByTl = new Map<string, number>();
  for (const r of [...creRows, ...crqRows]) {
    escByTl.set(r.tl_name, (escByTl.get(r.tl_name) ?? 0) + Number(r.n));
  }

  const rateN = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

  return docRows.map((r): TlBreakdownRow => {
    const q = qualityByTl.get(r.tl_name);
    const audits = q ? Number(q.audits) : 0;
    const errors = q ? Number(q.errors) : 0;
    const ea = extAuditByTl.get(r.tl_name);
    return {
      tlName: r.tl_name,
      docVolume: Number(r.n),
      docAvgAht: r.aht !== null ? Math.round(Number(r.aht)) : null,
      docEscalations: Number(r.esc ?? 0),
      docAuditErrorRate: audits > 0 ? Math.round((errors / audits) * 1000) / 10 : null,
      escalationLines: escByTl.get(r.tl_name) ?? 0,
      manualFarRate: ea ? rateN(Number(ea.farN), Number(ea.farTotal)) : null,
      manualFrrRate: ea ? rateN(Number(ea.frrN), Number(ea.frrTotal)) : null,
      classificationRate: ea ? rateN(Number(ea.classN), Number(ea.classTotal)) : null,
      extractionRate: ea ? rateN(Number(ea.extN), Number(ea.extTotal)) : null,
    };
  }).sort((a, b) => b.docVolume - a.docVolume);
}

/** Monthly volume trend (DOC + POA combined counts), for a simple bar/line chart. */
export async function getMonthlyTrend(rawFilters: { from?: string; to?: string }) {
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();
  const [docRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m') AS ym, COUNT(*) AS n
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? GROUP BY ym ORDER BY ym`,
    [f.from, f.to]
  );
  const [poaRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_completed_date, '%Y-%m') AS ym, COUNT(*) AS n
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? GROUP BY ym ORDER BY ym`,
    [f.from, f.to]
  );
  const byMonth = new Map<string, { doc: number; poa: number }>();
  for (const r of docRows) byMonth.set(r.ym, { doc: Number(r.n), poa: 0 });
  for (const r of poaRows) {
    const existing = byMonth.get(r.ym) ?? { doc: 0, poa: 0 };
    existing.poa = Number(r.n);
    byMonth.set(r.ym, existing);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, doc: v.doc, poa: v.poa }));
}

// ── Metric registry — drives multi-level drill-down for every KPI card ─────────
//
// Level 1: the KPI tile itself (getOverview, above).
// Level 2: this metric's value broken down by Team Leader (getMetricTlBreakdown).
// Level 3: the raw records behind it, pre-filtered to just what this metric counts
//          (listMetricRecords) — click a Level-2 TL row to get here.
// Level 4: one record's full detail (getRecord — same drawer the raw-data browser uses).
//
// `numeratorExpr`/`denominatorExpr`/`recordFilter` are always fixed strings defined here,
// never built from a request — safe to interpolate into SQL the same way resolveTable's
// whitelist is.
interface MetricDef {
  key: string;
  table: string;
  dateColumn: string;
  kind: "count" | "avg" | "rate";
  column?: string;          // for kind: "avg"
  avgExpr?: string;         // for kind: "avg" — overrides AVG(column) (e.g. DOC's task-type exclusion)
  numeratorExpr?: string;   // for kind: "rate"
  denominatorExpr?: string; // for kind: "rate"
  recordFilter?: string;    // WHERE fragment narrowing level-3 records to what this metric counts
}

const METRIC_DEFS: Record<string, MetricDef> = {
  doc_volume: { key: "doc_volume", table: "onfido_doc_raw", dateColumn: "report_date", kind: "count" },
  doc_aht: {
    key: "doc_aht", table: "onfido_doc_raw", dateColumn: "report_date", kind: "avg",
    column: "manual_processing_time_secs", avgExpr: DOC_AHT_AVG, recordFilter: DOC_AHT_ROW_FILTER,
  },
  doc_escalation_rate: {
    key: "doc_escalation_rate", table: "onfido_doc_raw", dateColumn: "report_date", kind: "rate",
    numeratorExpr: "SUM(is_escalated)", denominatorExpr: "COUNT(*)", recordFilter: "is_escalated = 1",
  },
  doc_audit_error_rate: {
    key: "doc_audit_error_rate", table: "onfido_doc_quality_raw", dateColumn: "task_complete_date", kind: "rate",
    numeratorExpr: "SUM(total_error)", denominatorExpr: "SUM(total_audits)", recordFilter: "total_error > 0",
  },
  doc_client_escalations: {
    key: "doc_client_escalations", table: "onfido_doc_escalation_cre_raw", dateColumn: "qc_updated_date", kind: "count",
  },
  poa_volume: { key: "poa_volume", table: "onfido_poa_raw", dateColumn: "report_completed_date", kind: "count" },
  poa_aht: {
    key: "poa_aht", table: "onfido_poa_raw", dateColumn: "report_completed_date", kind: "avg",
    column: "manual_processing_time_secs",
  },
  poa_error_rate: {
    key: "poa_error_rate", table: "onfido_poa_quality_raw", dateColumn: "report_completed_date", kind: "rate",
    numeratorExpr: "SUM(error_count)", denominatorExpr: "SUM(error_count) + SUM(no_error_count)",
    recordFilter: "error_count > 0",
  },
  poa_error_classification: {
    key: "poa_error_classification", table: "onfido_poa_quality_raw", dateColumn: "report_completed_date", kind: "rate",
    numeratorExpr: "SUM(classification_error)", denominatorExpr: "SUM(total_qc)", recordFilter: "classification_error > 0",
  },
  poa_error_extraction: {
    key: "poa_error_extraction", table: "onfido_poa_quality_raw", dateColumn: "report_completed_date", kind: "rate",
    numeratorExpr: "SUM(extraction_error)", denominatorExpr: "SUM(total_qc)", recordFilter: "extraction_error > 0",
  },
  poa_error_data_comparison: {
    key: "poa_error_data_comparison", table: "onfido_poa_quality_raw", dateColumn: "report_completed_date", kind: "rate",
    numeratorExpr: "SUM(data_comparison_error)", denominatorExpr: "SUM(total_qc)", recordFilter: "data_comparison_error > 0",
  },
  doc_manual_far_rate: {
    key: "doc_manual_far_rate", table: "onfido_doc_external_audit_raw", dateColumn: "report_date", kind: "rate",
    numeratorExpr: "SUM(manual_far_flag)", denominatorExpr: "SUM(manual_far_total)", recordFilter: "manual_far_flag > 0",
  },
  doc_manual_frr_rate: {
    key: "doc_manual_frr_rate", table: "onfido_doc_external_audit_raw", dateColumn: "report_date", kind: "rate",
    numeratorExpr: "SUM(manual_frr_flag)", denominatorExpr: "SUM(manual_frr_total)", recordFilter: "manual_frr_flag > 0",
  },
  doc_classification_rate: {
    key: "doc_classification_rate", table: "onfido_doc_external_audit_raw", dateColumn: "report_date", kind: "rate",
    numeratorExpr: "SUM(classification_flag)", denominatorExpr: "SUM(classification_total)", recordFilter: "classification_flag > 0",
  },
  doc_extraction_rate: {
    key: "doc_extraction_rate", table: "onfido_doc_external_audit_raw", dateColumn: "report_date", kind: "rate",
    numeratorExpr: "SUM(extraction_flag)", denominatorExpr: "SUM(extraction_total)", recordFilter: "extraction_flag > 0",
  },
};

function resolveMetric(metricKey: string): MetricDef {
  const def = METRIC_DEFS[metricKey];
  if (!def) throw Object.assign(new Error(`Unknown metric '${metricKey}'`), { statusCode: 400 });
  return def;
}

export function listMetrics() {
  return Object.values(METRIC_DEFS).map((m) => ({ key: m.key, table: m.table, kind: m.kind }));
}

export interface MetricTlRow { tlName: string; value: number | null; note?: string }

/** Level 2 — this metric's value broken down by Team Leader, for the same date range. */
export async function getMetricTlBreakdown(metricKey: string, rawFilters: { from?: string; to?: string }): Promise<MetricTlRow[]> {
  const def = resolveMetric(metricKey);
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();

  const selectExpr =
    def.kind === "count" ? "COUNT(*) AS value" :
    def.kind === "avg" ? `${def.avgExpr ?? `AVG(${def.column})`} AS value` :
    `${def.numeratorExpr} AS n, ${def.denominatorExpr} AS d`;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name, ${selectExpr}
       FROM ${def.table} WHERE ${def.dateColumn} BETWEEN ? AND ?
       GROUP BY tl_name`,
    [f.from, f.to]
  );

  return rows
    .map((r): MetricTlRow => {
      if (def.kind === "rate") {
        const n = Number(r.n ?? 0);
        const d = Number(r.d ?? 0);
        return { tlName: r.tl_name, value: d > 0 ? Math.round((n / d) * 1000) / 10 : null, note: `${n} of ${d}` };
      }
      const v = r.value === null ? null : Number(r.value);
      return { tlName: r.tl_name, value: def.kind === "avg" && v !== null ? Math.round(v) : v };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

/** Level 3 — the raw records a metric counts, optionally narrowed to one TL from level 2. */
export async function listMetricRecords(metricKey: string, filters: RecordListFilters) {
  const def = resolveMetric(metricKey);
  return queryTableRecords(def.table, def.recordFilter ?? null, filters);
}

const TABLE_BY_KEY = new Map(ONFIDO_REPORT_CONFIGS.map((c) => [c.uploadTypeCode, c.table]));
const VALID_TABLE_NAMES = new Set(ONFIDO_REPORT_CONFIGS.map((c) => c.table));

/**
 * Accepts either an upload_type_code (e.g. "ONFIDO_DOC_RAW", what the "Browse Raw Data"
 * picker sends) or the bare physical table name (e.g. "onfido_doc_raw", what
 * listMetricRecords returns as its `table` for a metric drill-down's level-4 detail call)
 * — the record-detail route (GET /records/:table/:id) is shared by both drill-down paths.
 */
export function resolveTable(tableKey: string): string {
  if (VALID_TABLE_NAMES.has(tableKey)) return tableKey;
  const table = TABLE_BY_KEY.get(tableKey.toUpperCase());
  if (!table) throw Object.assign(new Error(`Unknown Onfido table key '${tableKey}'`), { statusCode: 400 });
  return table;
}

// Every dimension any breakdown table (Attrition/ETM/Task Skip/Analyst Performance)
// groups by — the only column names `filterColumn` may ever resolve to, so a
// request can never inject an arbitrary identifier into the query below.
const ALLOWED_FILTER_COLUMNS = new Set([
  "tl_name", "am_name", "aon_bucket", "location", "escalated_by_email",
  "unassigned_from_email", "ims_client_name", "task_type", "analyst_email",
  "docupedia_document_name", "error_category", "error_breakdown",
  // has_error powers the "errors only" raw-table view (a real, standalone table
  // of just the failed audits, not a grouped breakdown) — same generic
  // filterColumn/filterValue mechanism, just a boolean flag instead of a label.
  "has_error",
]);

// onfido_doc_raw has no real task_type column (see DOC_RAW_DIMENSION_EXPR above) — every
// other table task_type is allowed against stores it as a plain column, so this is the one
// exception the generic filterColumn WHERE-builder below needs to special-case.
const FILTER_COLUMN_JSON_OVERRIDE: Record<string, Record<string, string>> = {
  onfido_doc_raw: { task_type: DOC_TASK_TYPE_LABEL_EXPR },
};

export interface RecordListFilters {
  from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string; search?: string;
  limit?: number; cursor?: number;
  /** Drill-down from a breakdown row: e.g. { filterColumn: "am_name", filterValue: "Kamal Negi" }. */
  filterColumn?: string; filterValue?: string;
}

/**
 * Shared by listRecords (the "Browse Raw Data" table picker) and listMetricRecords (level 3
 * of a metric's drill-down) — same pagination/filter logic, the only difference is which
 * table and which extra WHERE condition (if any) narrows it to what one metric counts.
 * `extraCondition` is always a fixed string from METRIC_DEFS, never user input.
 */
export async function buildRecordFilter(
  pool: Awaited<ReturnType<typeof getOnfidoPool>>, table: string, extraCondition: string | null, filters: RecordListFilters
): Promise<{ whereSql: string; params: unknown[] }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (extraCondition) where.push(extraCondition);
  const [dateColRows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND DATA_TYPE = 'date' LIMIT 1`,
    [table]
  );
  const dateCol = dateColRows[0]?.COLUMN_NAME as string | undefined;
  if (dateCol && filters.from) { where.push(`${dateCol} >= ?`); params.push(filters.from); }
  if (dateCol && filters.to) { where.push(`${dateCol} <= ?`); params.push(filters.to); }
  if (filters.tlName) { where.push("tl_name = ?"); params.push(filters.tlName); }
  if (filters.amName) { where.push("am_name = ?"); params.push(filters.amName); }
  if (filters.analystEmail) {
    where.push(`${table === "onfido_task_skip_raw" ? "unassigned_from_email" : "analyst_email"} = ?`);
    params.push(filters.analystEmail);
  }
  if (filters.filterColumn && filters.filterValue !== undefined) {
    if (!ALLOWED_FILTER_COLUMNS.has(filters.filterColumn)) {
      throw Object.assign(new Error(`Unknown filter column '${filters.filterColumn}'`), { statusCode: 400 });
    }
    const colExpr = FILTER_COLUMN_JSON_OVERRIDE[table]?.[filters.filterColumn] ?? filters.filterColumn;
    if (filters.filterValue === "(unassigned)" || filters.filterValue === "Standard Review (untagged)") {
      where.push(`(${colExpr} IS NULL OR TRIM(${colExpr}) = '')`);
    } else {
      where.push(`${colExpr} = ?`); params.push(filters.filterValue);
    }
  }
  if (filters.search) {
    where.push("(analyst_email LIKE ? OR raw_data LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  return { whereSql, params };
}

async function queryTableRecords(table: string, extraCondition: string | null, filters: RecordListFilters) {
  const pool = await getOnfidoPool();
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const offset = Math.max(0, filters.cursor ?? 0);
  const { whereSql, params } = await buildRecordFilter(pool, table, extraCondition, filters);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ${table} ${whereSql} ORDER BY uploaded_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ n: total }]] = await pool.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM ${table} ${whereSql}`, params
  );

  return { table, rows, total: Number(total), limit, cursor: offset };
}

/** Raw record browser behind the "Browse Raw Data" table picker — one page, newest first. */
export async function listRecords(tableKey: string, filters: RecordListFilters) {
  return queryTableRecords(resolveTable(tableKey), null, filters);
}

/** Full record for the drill-down drawer, including every column the source file had. */
export async function getRecord(tableKey: string, id: string) {
  const table = resolveTable(tableKey);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

// ── Volume trend at daily/weekly/monthly granularity ────────────────────────

export type TrendGranularity = "daily" | "weekly" | "monthly";

/**
 * mysql2 returns a DATE column as a JS Date representing local midnight of
 * that calendar date (confirmed live: MySQL DATE '2026-07-01' round-trips as
 * `2026-06-30T18:30:00.000Z`, i.e. IST midnight on Jul 1) — the same
 * host-timezone trap already on record elsewhere in this codebase. Two wrong
 * ways to turn that back into a label: `.toISOString()` converts to UTC first
 * and silently shifts the date back a day (Jul 1 -> "2026-06-30"); a bare
 * `String(d)` gives JS's verbose Date.toString() ("Wed Jul 01 2026 00:00:00
 * GMT+0530..."), whose first 10 characters are "Wed Jul 01", not an ISO date.
 * Reading the LOCAL year/month/day getters is the only one of the three that
 * reconstructs the real calendar date the DB actually stored.
 */
function dateBucketToIso(d: unknown): string {
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return String(d).slice(0, 10);
}

/** Same daily/weekly/monthly bucket expression every trend function below uses. */
export function bucketExpr(dateCol: string, granularity: TrendGranularity): string {
  return granularity === "daily" ? `DATE(${dateCol})`
    : granularity === "weekly" ? `DATE_SUB(${dateCol}, INTERVAL WEEKDAY(${dateCol}) DAY)`
    : `DATE_FORMAT(${dateCol}, '%Y-%m-01')`;
}
export function bucketLabel(d: unknown, granularity: TrendGranularity): string {
  const iso = dateBucketToIso(d);
  return granularity === "monthly" ? iso.slice(0, 7) : iso;
}

/** Same DOC+POA volume rollup as getMonthlyTrend, generalised to daily/weekly buckets
 *  for the Trends view's granularity toggle — this is a re-aggregation of the same
 *  two real tables, not a new data source. */
export async function getVolumeTrend(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity) {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();

  const [docRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_date", granularity)} AS bucket, COUNT(*) AS n
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  const [poaRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_completed_date", granularity)} AS bucket, COUNT(*) AS n
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );

  const fmt = (d: unknown) => bucketLabel(d, granularity);

  const byBucket = new Map<string, { doc: number; poa: number }>();
  for (const r of docRows) byBucket.set(fmt(r.bucket), { doc: Number(r.n), poa: 0 });
  for (const r of poaRows) {
    const key = fmt(r.bucket);
    const existing = byBucket.get(key) ?? { doc: 0, poa: 0 };
    existing.poa = Number(r.n);
    byBucket.set(key, existing);
  }
  return [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({ bucket, doc: v.doc, poa: v.poa }));
}

export interface EtmGranularTrendPoint { bucket: string; doc: number; poa: number }

/** ETM tab's trend chart, daily/weekly/monthly — real per-task escalation counts,
 *  same re-aggregation approach as getVolumeTrend. */
export async function getEtmTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<EtmGranularTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const expr = bucketExpr("report_date", granularity);
  const [docRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM onfido_doc_etm_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  const [poaRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM onfido_poa_etm_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  const byBucket = new Map<string, { doc: number; poa: number }>();
  for (const r of docRows) byBucket.set(bucketLabel(r.bucket, granularity), { doc: Number(r.n), poa: 0 });
  for (const r of poaRows) {
    const key = bucketLabel(r.bucket, granularity);
    const existing = byBucket.get(key) ?? { doc: 0, poa: 0 };
    existing.poa = Number(r.n);
    byBucket.set(key, existing);
  }
  return [...byBucket.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, v]) => ({ bucket, ...v }));
}

export interface TaskSkipGranularTrendPoint { bucket: string; count: number }

/** Task Skip tab's trend chart, daily/weekly/monthly. */
export async function getTaskSkipTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<TaskSkipGranularTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail, "unassigned_from_email");
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("skip_date", granularity)} AS bucket, COUNT(*) AS n
       FROM onfido_task_skip_raw WHERE skip_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => ({ bucket: bucketLabel(r.bucket, granularity), count: Number(r.n) }));
}

export interface QualityGranularTrendPoint { bucket: string; taskCount: number; errorRate: number | null }

/** Quality tab's trend chart, daily/weekly/monthly — error rate is errors/total
 *  PER BUCKET, always a real 0-100% ratio regardless of bucket width (unlike
 *  Attrition's headcount-based rates, this one has no "denominator too small
 *  for the numerator" failure mode — see getAttritionMonthlyDetail's own note
 *  on why that metric stays month-only). */
export async function getQualityTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<QualityGranularTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_date", granularity)} AS bucket, COUNT(*) AS total, SUM(has_error) AS errors
       FROM onfido_doc_external_audit_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => {
    const total = Number(r.total ?? 0);
    return { bucket: bucketLabel(r.bucket, granularity), taskCount: total, errorRate: rate1(Number(r.errors ?? 0), total) };
  });
}

/** Internal-QC counterpart to getQualityTrend (which reads the client-facing
 *  onfido_doc_external_audit_raw table) — this one reads onfido_doc_quality_raw,
 *  the DOC queue's own internal audit export, for the Overview page's
 *  "Month-wise Internal Quality score" card (2026-09-17 dashboard feedback). */
export async function getDocInternalQualityTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<QualityGranularTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("task_complete_date", granularity)} AS bucket,
            COALESCE(SUM(total_audits),0) AS total, COALESCE(SUM(total_error),0) AS errors
       FROM onfido_doc_quality_raw WHERE task_complete_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => {
    const total = Number(r.total ?? 0);
    return { bucket: bucketLabel(r.bucket, granularity), taskCount: total, errorRate: rate1(Number(r.errors ?? 0), total) };
  });
}

export interface DocInternalQualityOverview { taskCount: KpiValue; overallErrorRate: KpiValue }

/** Single-range counterpart to getDocInternalQualityTrend — the Quality page's
 *  "Int Overall Err %" KPI card (2026-09-17 feedback). onfido_doc_quality_raw
 *  only ever extracted total_audits/total_error (no classification/extraction/
 *  raw-extraction sub-breakdown columns), so this is the one metric available
 *  on the internal side, same limitation getDocInternalQualityTrend has. */
export async function getDocInternalQualityOverview(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<DocInternalQualityOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const agg = await scalar<RowDataPacket & { total: number; errors: number }>(
    `SELECT COALESCE(SUM(total_audits),0) AS total, COALESCE(SUM(total_error),0) AS errors
       FROM onfido_doc_quality_raw WHERE task_complete_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const total = Number(agg.total ?? 0);
  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  return {
    taskCount: kpi("int_quality_task_count", "Int Audits", total, "count"),
    overallErrorRate: kpi("int_quality_overall_err", "Int Overall Err %", rate1(Number(agg.errors ?? 0), total), "percent", `${agg.errors ?? 0} of ${total}`),
  };
}

export interface AttritionGranularTrendPoint { bucket: string; attritionCount: number }

/** Attrition tab's trend chart, daily/weekly/monthly — exit COUNT only, not a
 *  rate: an attrition rate needs a real calendar month's opening/closing HC
 *  (see getAttritionMonthlyDetail), so daily/weekly buckets only ever show the
 *  count here, never a %, to avoid resurrecting the same noisy-denominator
 *  problem that produced 3000%+ rates before that fix. */
export async function getAttritionTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<AttritionGranularTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("work_date", granularity)} AS bucket, COALESCE(SUM(attrition_flag),0) AS n
       FROM onfido_agent_daily_raw WHERE attrition_flag = 1 AND work_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => ({ bucket: bucketLabel(r.bucket, granularity), attritionCount: Number(r.n) }));
}

// ── Analyst Performance ──────────────────────────────────────────────────────
//
// Primary source is onfido_doc_external_audit_raw: it is by far the largest,
// most complete per-task table with an analyst_email + real quality flags
// (has_error, manual_far_flag, manual_frr_flag, classification/extraction/
// raw_extraction/add_extraction flags), so it is what actually carries an
// analyst's identity (tl_name/am_name/qa_name) and month-over-month history.
// POA numbers come from onfido_poa_raw/onfido_poa_quality_raw the same way the
// Overview cards read them.

export interface AnalystSearchHit { email: string; tlName: string | null; taskCount: number }

/** Analyst search-as-you-type box: distinct emails matching the query, most active first. */
export async function searchAnalysts(query: string): Promise<AnalystSearchHit[]> {
  const pool = await getOnfidoPool();
  const like = `%${query}%`;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email AS email,
            COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name,
            COUNT(*) AS n
       FROM onfido_doc_external_audit_raw
      WHERE analyst_email LIKE ?
      GROUP BY analyst_email, tl_name
      ORDER BY n DESC
      LIMIT 20`,
    [like]
  );
  return rows.map((r) => ({ email: r.email, tlName: r.tl_name, taskCount: Number(r.n) }));
}

export interface AnalystPerformance {
  email: string;
  tlName: string | null;
  amName: string | null;
  qaName: string | null;
  totalTasks: KpiValue;
  avgManualProcessingTime: KpiValue;
  overallErrorRate: KpiValue;
  manualFarRate: KpiValue;
  manualFrrRate: KpiValue;
  poaTasks: KpiValue;
  poaAvgAht: KpiValue;
  poaErrorRate: KpiValue;
  monthly: { month: string; tasks: number; errorRate: number | null }[];
  peers: { email: string; tlName: string | null; tasks: number; errorRate: number | null }[];
}

/** Full profile for one analyst — everything the Analyst Performance drill-down shows. */
export async function getAnalystPerformance(email: string, rawFilters: { from?: string; to?: string }): Promise<AnalystPerformance | null> {
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();

  const identity = await scalar<RowDataPacket & { tl_name: string | null; am_name: string | null; qa_name: string | null; n: number }>(
    `SELECT tl_name, am_name, qa_name, COUNT(*) OVER () AS n
       FROM onfido_doc_external_audit_raw
      WHERE LOWER(analyst_email) = LOWER(?)
      ORDER BY uploaded_at DESC LIMIT 1`,
    [email]
  );
  if (!identity || !identity.n) return null;

  const agg = await scalar<RowDataPacket & { total: number; errors: number; farN: number; frrN: number; farTotal: number; frrTotal: number; avgSecs: number | null }>(
    `SELECT COUNT(*) AS total, SUM(has_error) AS errors, SUM(manual_far_flag) AS farN,
            SUM(manual_frr_flag) AS frrN,
            COALESCE(SUM(manual_far_total), 0) AS farTotal,
            COALESCE(SUM(manual_frr_total), 0) AS frrTotal,
            AVG(manual_processing_time_secs) AS avgSecs
       FROM onfido_doc_external_audit_raw
      WHERE LOWER(analyst_email) = LOWER(?) AND report_date BETWEEN ? AND ?`,
    [email, f.from, f.to]
  );

  const poaAgg = await scalar<RowDataPacket & { n: number; aht: number | null }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_poa_raw WHERE LOWER(analyst_email) = LOWER(?) AND report_completed_date BETWEEN ? AND ?`,
    [email, f.from, f.to]
  );
  const poaQ = await scalar<RowDataPacket & { errors: number; noErrors: number }>(
    `SELECT COALESCE(SUM(error_count),0) AS errors, COALESCE(SUM(no_error_count),0) AS noErrors
       FROM onfido_poa_quality_raw WHERE LOWER(analyst_email) = LOWER(?) AND report_completed_date BETWEEN ? AND ?`,
    [email, f.from, f.to]
  );

  const [monthlyRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m') AS ym, COUNT(*) AS n, SUM(has_error) AS errors
       FROM onfido_doc_external_audit_raw
      WHERE LOWER(analyst_email) = LOWER(?) AND report_date BETWEEN ? AND ?
      GROUP BY ym ORDER BY ym`,
    [email, f.from, f.to]
  );

  const [peerRows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email AS email,
            COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name,
            COUNT(*) AS n, SUM(has_error) AS errors
       FROM onfido_doc_external_audit_raw
      WHERE tl_name = ? AND report_date BETWEEN ? AND ?
      GROUP BY analyst_email, tl_name
      ORDER BY n DESC LIMIT 30`,
    [identity.tl_name, f.from, f.to]
  );

  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

  const total = Number(agg.total ?? 0);
  const errors = Number(agg.errors ?? 0);
  const farN = Number(agg.farN ?? 0);
  const frrN = Number(agg.frrN ?? 0);
  const farTotal = Number(agg.farTotal ?? 0);
  const frrTotal = Number(agg.frrTotal ?? 0);
  const poaTotal = Number(poaQ.errors ?? 0) + Number(poaQ.noErrors ?? 0);

  return {
    email,
    tlName: identity.tl_name,
    amName: identity.am_name,
    qaName: identity.qa_name,
    totalTasks: kpi("analyst_total_tasks", "Total Tasks", total, "count"),
    avgManualProcessingTime: kpi("analyst_avg_time", "Avg Handling Time", agg.avgSecs !== null ? Math.round(Number(agg.avgSecs)) : null, "seconds"),
    overallErrorRate: kpi("analyst_overall_err", "Overall Error Rate", rate(errors, total), "percent", `${errors} of ${total}`),
    manualFarRate: kpi("analyst_far", "Manual FAR Rate", rate(farN, farTotal), "percent",
      farTotal > 0 ? `${farN} of ${farTotal} FAR audits` : "no FAR audits in range"),
    manualFrrRate: kpi("analyst_frr", "Manual FRR Rate", rate(frrN, frrTotal), "percent",
      frrTotal > 0 ? `${frrN} of ${frrTotal} FRR audits` : "no FRR audits in range"),
    poaTasks: kpi("analyst_poa_tasks", "POA Tasks", Number(poaAgg.n ?? 0), "count"),
    poaAvgAht: kpi("analyst_poa_aht", "POA Avg Handling Time", poaAgg.aht !== null ? Math.round(Number(poaAgg.aht)) : null, "seconds"),
    poaErrorRate: kpi("analyst_poa_err", "POA Error Rate", rate(Number(poaQ.errors ?? 0), poaTotal), "percent",
      poaTotal > 0 ? `${poaQ.errors} of ${poaTotal}` : "no POA audits in range"),
    monthly: monthlyRows.map((r) => ({
      month: r.ym, tasks: Number(r.n), errorRate: rate(Number(r.errors ?? 0), Number(r.n)),
    })),
    peers: peerRows.map((r) => ({
      email: r.email, tlName: r.tl_name, tasks: Number(r.n), errorRate: rate(Number(r.errors ?? 0), Number(r.n)),
    })),
  };
}

// ── Alerts ────────────────────────────────────────────────────────────────
//
// Real computed threshold breaches (not the fixed placeholder sequence a UI
// prototype might ship with) — each row's rate is COUNT/SUM arithmetic over
// onfido_doc_external_audit_raw / onfido_poa_quality_raw for the selected
// range. Thresholds are configurable display defaults, not fabricated data;
// only the underlying rates decide which analysts appear.

export interface AlertThresholds {
  overallErrorPct: number;
  farPct: number;
  frrPct: number;
  poaErrorPct: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  overallErrorPct: 1.5, farPct: 2, frrPct: 1, poaErrorPct: 1,
};

export interface AlertRow {
  analystEmail: string;
  tlName: string | null;
  amName: string | null;
  metric: "Overall Error %" | "Manual FAR %" | "Manual FRR %" | "POA Error %";
  value: number;
  threshold: number;
  severity: "high" | "medium";
}

function severityFor(value: number, threshold: number): "high" | "medium" {
  return value >= threshold * 1.5 ? "high" : "medium";
}

/** Every analyst currently over a quality threshold, for the selected range. */
export async function listAlerts(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS): Promise<AlertRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();

  const [auditRows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email, COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name, MAX(am_name) AS am_name,
            COUNT(*) AS total, SUM(has_error) AS errors,
            SUM(manual_far_flag) AS farN, SUM(manual_frr_flag) AS frrN,
            COALESCE(SUM(manual_far_total), 0) AS farTotal, COALESCE(SUM(manual_frr_total), 0) AS frrTotal
       FROM onfido_doc_external_audit_raw
      WHERE report_date BETWEEN ? AND ? ${clause} AND analyst_email IS NOT NULL AND analyst_email <> ''
      GROUP BY analyst_email, tl_name`,
    [f.from, f.to, ...params]
  );
  const [poaRows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email, COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name, MAX(am_name) AS am_name,
            COALESCE(SUM(error_count),0) AS errors, COALESCE(SUM(no_error_count),0) AS noErrors
       FROM onfido_poa_quality_raw
      WHERE report_completed_date BETWEEN ? AND ? ${clause} AND analyst_email IS NOT NULL AND analyst_email <> ''
      GROUP BY analyst_email, tl_name`,
    [f.from, f.to, ...params]
  );

  const alerts: AlertRow[] = [];
  const round1 = (n: number) => Math.round(n * 10) / 10;

  for (const r of auditRows) {
    const total = Number(r.total);
    if (total === 0) continue;
    const overallPct = round1((Number(r.errors ?? 0) / total) * 100);
    const farTotal = Number(r.farTotal ?? 0);
    const frrTotal = Number(r.frrTotal ?? 0);
    const farPct = farTotal > 0 ? round1((Number(r.farN ?? 0) / farTotal) * 100) : 0;
    const frrPct = frrTotal > 0 ? round1((Number(r.frrN ?? 0) / frrTotal) * 100) : 0;
    if (overallPct > thresholds.overallErrorPct) {
      alerts.push({ analystEmail: r.analyst_email, tlName: r.tl_name, amName: r.am_name ?? null, metric: "Overall Error %", value: overallPct, threshold: thresholds.overallErrorPct, severity: severityFor(overallPct, thresholds.overallErrorPct) });
    }
    if (farPct > thresholds.farPct) {
      alerts.push({ analystEmail: r.analyst_email, tlName: r.tl_name, amName: r.am_name ?? null, metric: "Manual FAR %", value: farPct, threshold: thresholds.farPct, severity: severityFor(farPct, thresholds.farPct) });
    }
    if (frrPct > thresholds.frrPct) {
      alerts.push({ analystEmail: r.analyst_email, tlName: r.tl_name, amName: r.am_name ?? null, metric: "Manual FRR %", value: frrPct, threshold: thresholds.frrPct, severity: severityFor(frrPct, thresholds.frrPct) });
    }
  }
  for (const r of poaRows) {
    const total = Number(r.errors ?? 0) + Number(r.noErrors ?? 0);
    if (total === 0) continue;
    const poaPct = round1((Number(r.errors ?? 0) / total) * 100);
    if (poaPct > thresholds.poaErrorPct) {
      alerts.push({ analystEmail: r.analyst_email, tlName: r.tl_name, amName: r.am_name ?? null, metric: "POA Error %", value: poaPct, threshold: thresholds.poaErrorPct, severity: severityFor(poaPct, thresholds.poaErrorPct) });
    }
  }

  return alerts.sort((a, b) => (b.severity === a.severity ? b.value - a.value : b.severity === "high" ? 1 : -1));
}

export function listAvailableTables() {
  return ONFIDO_REPORT_CONFIGS.map((c) => ({
    key: c.uploadTypeCode, table: c.table, name: c.uploadTypeName, description: c.description,
  }));
}

/**
 * Real distinct TL/AM names for the Executive Filters dropdowns — a closed
 * set read straight from the DB, not free text (standing platform rule: any
 * field whose valid values are a known set must be a dropdown). Sourced from
 * onfido_doc_external_audit_raw (17k rows, the richest per-task DOC table)
 * unioned with onfido_agent_daily_raw (the HR roster) so a TL/AM who only
 * shows up in one of the two sources still appears.
 */
export async function getFilterOptions(range: { from?: string; to?: string } = {}): Promise<{ tlNames: string[]; amNames: string[]; tlAmMapping: Record<string, string[]>; analysts: FilterAnalyst[] }> {
  const pool = await getOnfidoPool();
  const [tlRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT tl_name AS name FROM onfido_doc_external_audit_raw WHERE tl_name IS NOT NULL AND TRIM(tl_name) <> ''
     UNION
     SELECT DISTINCT tl_name AS name FROM onfido_agent_daily_raw WHERE tl_name IS NOT NULL AND TRIM(tl_name) <> ''
     ORDER BY name`
  );
  const [amRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT am_name AS name FROM onfido_doc_external_audit_raw WHERE am_name IS NOT NULL AND TRIM(am_name) <> ''
     UNION
     SELECT DISTINCT am_name AS name FROM onfido_agent_daily_raw WHERE am_name IS NOT NULL AND TRIM(am_name) <> ''
     ORDER BY name`
  );
  // The AM->TL cascade is an enhancement: if it cannot be built the dropdowns
  // still work (uncascaded) rather than the whole dashboard losing its filters.
  const tlAmMapping = await getTlAmMapping(pool, range).catch((err: unknown) => {
    console.error("[onfido] tlAmMapping failed, serving uncascaded filters:", err);
    return {} as Record<string, string[]>;
  });
  const analysts = await getFilterAnalysts(pool, range).catch((err: unknown) => {
    console.error("[onfido] analyst filter list failed:", err);
    return [] as FilterAnalyst[];
  });
  return { tlNames: tlRows.map((r) => r.name as string), amNames: amRows.map((r) => r.name as string), tlAmMapping, analysts };
}

export interface FilterAnalyst { email: string; name: string | null; tlName: string | null; amName: string | null }

/** Analysts on the HR roster in the window, with the TL/AM they sat under, for the dependent Analyst dropdown. */
async function getFilterAnalysts(
  pool: Awaited<ReturnType<typeof getOnfidoPool>>, range: { from?: string; to?: string }
): Promise<FilterAnalyst[]> {
  if (!range.from || !range.to || !ISO_DATE.test(range.from) || !ISO_DATE.test(range.to)) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT analyst_email, emp_name, tl_name, am_name FROM onfido_agent_daily_raw
      WHERE work_date BETWEEN ? AND ? AND analyst_email IS NOT NULL AND TRIM(analyst_email) <> ''
      ORDER BY emp_name, analyst_email LIMIT 5000`,
    [range.from, range.to]
  );
  return rows.map((r) => ({
    email: String(r.analyst_email), name: (r.emp_name as string | null) ?? null,
    tlName: (r.tl_name as string | null) ?? null, amName: (r.am_name as string | null) ?? null,
  }));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * AM -> aligned TL names, so the TL dropdown can be restricted to the selected
 * AM. When a valid from/to is supplied only pairs seen in that window count
 * (the TL an AM manages changes month to month); with no range it is all-time.
 * Pairs come from both raw tables, same union as the dropdown lists above.
 */
async function getTlAmMapping(
  pool: Awaited<ReturnType<typeof getOnfidoPool>>, range: { from?: string; to?: string }
): Promise<Record<string, string[]>> {
  const ranged = !!range.from && !!range.to && ISO_DATE.test(range.from) && ISO_DATE.test(range.to);
  const agentWhere = ranged ? "AND work_date BETWEEN ? AND ?" : "";
  const auditWhere = ranged ? "AND report_date BETWEEN ? AND ?" : "";
  const params = ranged ? [range.from, range.to, range.from, range.to] : [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT am_name AS am, tl_name AS tl FROM onfido_agent_daily_raw
       WHERE am_name IS NOT NULL AND TRIM(am_name) <> '' AND tl_name IS NOT NULL AND TRIM(tl_name) <> '' ${agentWhere}
     UNION
     SELECT DISTINCT am_name AS am, tl_name AS tl FROM onfido_doc_external_audit_raw
       WHERE am_name IS NOT NULL AND TRIM(am_name) <> '' AND tl_name IS NOT NULL AND TRIM(tl_name) <> '' ${auditWhere}`,
    params
  );
  const mapping: Record<string, Set<string>> = {};
  for (const r of rows) {
    (mapping[r.am as string] ??= new Set()).add(r.tl as string);
  }
  return Object.fromEntries(Object.entries(mapping).map(([am, tls]) => [am, [...tls].sort()]));
}

// ── Attrition & Shrinkage — onfido_agent_daily_raw (Agent Wise sheet) ───────
//
// The only genuinely raw, per-employee-per-day source (see onfido-report-
// configs.ts's own comment on why the workbook's other sheets aren't imported).
//
// Attrition % and Shrinkage % are inherently MONTHLY ratios (opening/closing
// headcount are a snapshot pair, attrition/UL are a flow accumulated across
// that same single month) — confirmed against the reference dashboard's own
// Month Wise Detail table, which never showed a blended rate across more than
// one calendar month. Blending them across an arbitrary multi-month Executive
// Filter range is not just imprecise, it is arithmetically wrong: tested live
// against an 9-month range, Attrition% came out at 312% and one TL's at 4471%,
// because a nine-month cumulative exit count was divided by a two-day HC
// snapshot average. getAttritionMonthlyDetail computes one row per real
// calendar month (each internally consistent); getAttritionOverview and
// getAttritionBreakdown resolve to the single most recent month with data in
// range so their rates stay meaningful regardless of how wide a range the
// filter bar is set to — and say so via each KPI's `note`.

export interface AttritionMonthRow {
  month: string;
  openingHc: number; closingHc: number; avgHc: number;
  attritionCount: number; attritionRate: number | null;
  scheduled: number; unplannedLeave: number; actualUl: number;
  ulShrinkageRate: number | null; actualShrinkageRate: number | null;
}

const rate1 = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const rate2 = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 100 : null);
/** Avg HC as the business defines it: (opening + closing) / 2, to two decimals. */
const twoPointAvg = (opening: number, closing: number) => Math.round(((opening + closing) / 2) * 100) / 100;

/** On-floor rows only — HC and attrition are counted on the floor, never in training. */
const ONFLOOR = `LOWER(COALESCE(state,'onfloor')) = 'onfloor'`;

/** First and last calendar day of a YYYY-MM month, as ISO dates. Lets month
 *  queries filter with a sargable `work_date BETWEEN` instead of wrapping the
 *  indexed column in DATE_FORMAT(). */
function monthBounds(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, "0")}` };
}

/** The reference dashboard's AON buckets, in its display order. The upload
 *  spells them several ways across months ("0-30" / "0 to 30", and the top
 *  bucket as both "Above than 90" and "Above then 90"), so each is matched by
 *  pattern rather than by exact string. */
const AON_BUCKETS: { match: RegExp; label: string }[] = [
  { match: /^0\s*(-|to)\s*30$/, label: "0 to 30" },
  { match: /^31\s*(-|to)\s*60$/, label: "31 to 60" },
  { match: /^61\s*(-|to)\s*90$/, label: "61 to 90" },
  { match: /^(above\s*(than|then)?\s*90|90\s*\+|>\s*90)$/, label: "Above 90" },
];
function aonDisplayLabel(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return AON_BUCKETS.find((b) => b.match.test(key))?.label ?? null;
}

/**
 * Shared TL/AM filter builder for every Attrition/Quality/ETM/Task Skip
 * function below — the Executive Filters bar's TL/AM dropdowns apply across
 * every tab, the same way the reference dashboard's own filter bar does, not
 * just the Overview tab. Every one of these tables really does carry both
 * tl_name and am_name columns, so this is safe to reuse unconditionally.
 */
export function tlAmFilter(
  tlName?: string, amName?: string, analystEmail?: string, analystColumn: "analyst_email" | "unassigned_from_email" = "analyst_email"
): { clause: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (tlName) { parts.push("tl_name = ?"); params.push(tlName); }
  if (amName) { parts.push("am_name = ?"); params.push(amName); }
  if (analystEmail) { parts.push(`${analystColumn} = ?`); params.push(analystEmail); }
  return { clause: parts.length > 0 ? `AND ${parts.join(" AND ")}` : "", params };
}

/**
 * One correctly-scoped row per real calendar month overlapping [from, to].
 *
 * Formulas are the business's own, from its reference Attrition & Shrinkage
 * dashboard (the "attrition correction file", 2026-09-15):
 *   Opening HC   = on-floor HC on the month's first available day
 *   Closing HC   = on-floor HC on the month's last available day
 *   Avg HC       = (Opening HC + Closing HC) / 2
 *   Attrition %  = attrition / Avg HC
 *   UL / Actual Shrinkage % = UL (or Actual UL) / Scheduled
 * all to two decimals. Checked against the reference's Month Wise Detail
 * table: every month Jan–Aug 2026 reproduces it exactly (e.g. Jan 36 /
 * ((229 + 224) / 2) = 15.89%). The previous mean-of-every-day Avg HC
 * disagreed with the published figure in every month (Aug: 32.3% vs 33.91%).
 *
 * Transient on-floor-less buckets such as the "Training" TL, whose two-point
 * average used to produce 3000%+ rates, are excluded at the breakdown level
 * (getAttritionBreakdown) exactly as the reference does, rather than by
 * changing the formula here.
 */
export async function getAttritionMonthlyDetail(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }): Promise<AttritionMonthRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();

  // HC and attrition count: Onfloor rows only (matches reference benchmark SUMIFS…State="Onfloor").
  // Scheduled / UL / Actual UL: all states (Training rows contribute to shrinkage denominator).
  const onfloor = `LOWER(COALESCE(state,'onfloor')) = 'onfloor'`;
  const [dayRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(work_date, '%Y-%m') AS ym, work_date, SUM(hc) AS hc
       FROM onfido_agent_daily_raw WHERE work_date BETWEEN ? AND ? ${clause} AND ${onfloor}
       GROUP BY ym, work_date ORDER BY ym, work_date`,
    [f.from, f.to, ...params]
  );
  // Rows are ordered by date, so the first row of a month is its opening HC and
  // the last is its closing HC.
  const hcByMonth = new Map<string, { opening: number; closing: number }>();
  for (const r of dayRows) {
    const ym = r.ym as string;
    const hc = Number(r.hc ?? 0);
    const entry = hcByMonth.get(ym);
    if (!entry) hcByMonth.set(ym, { opening: hc, closing: hc });
    else entry.closing = hc;
  }

  const [aggRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(work_date, '%Y-%m') AS ym,
            COALESCE(SUM(CASE WHEN ${onfloor} THEN attrition_flag ELSE 0 END),0) AS attrition,
            COALESCE(SUM(scheduled),0) AS scheduled,
            COALESCE(SUM(unplanned_leave),0) AS ul, COALESCE(SUM(actual_ul),0) AS actualUl
       FROM onfido_agent_daily_raw WHERE work_date BETWEEN ? AND ? ${clause}
       GROUP BY ym ORDER BY ym`,
    [f.from, f.to, ...params]
  );

  return aggRows.map((r): AttritionMonthRow => {
    const hcInfo = hcByMonth.get(r.ym) ?? { opening: 0, closing: 0 };
    const avgHc = twoPointAvg(hcInfo.opening, hcInfo.closing);
    const attrition = Number(r.attrition ?? 0);
    const scheduled = Number(r.scheduled ?? 0);
    return {
      month: r.ym, openingHc: hcInfo.opening, closingHc: hcInfo.closing, avgHc,
      attritionCount: attrition, attritionRate: rate2(attrition, avgHc),
      scheduled, unplannedLeave: Number(r.ul ?? 0), actualUl: Number(r.actualUl ?? 0),
      ulShrinkageRate: rate2(Number(r.ul ?? 0), scheduled),
      actualShrinkageRate: rate2(Number(r.actualUl ?? 0), scheduled),
    };
  });
}

export interface AttritionOverview {
  month: string;
  openingHc: KpiValue;
  closingHc: KpiValue;
  avgHc: KpiValue;
  attritionCount: KpiValue;
  attritionRate: KpiValue;
  scheduled: KpiValue;
  unplannedLeave: KpiValue;
  ulShrinkageRate: KpiValue;
  actualShrinkageRate: KpiValue;
}

export async function getAttritionOverview(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }): Promise<AttritionOverview> {
  const months = await getAttritionMonthlyDetail(rawFilters);
  const m = months[months.length - 1];
  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  if (!m) {
    const empty = kpi("attr_none", "No data", null, "count");
    return { month: "", openingHc: empty, closingHc: empty, avgHc: empty, attritionCount: empty, attritionRate: empty, scheduled: empty, unplannedLeave: empty, ulShrinkageRate: empty, actualShrinkageRate: empty };
  }
  const suffix = `${m.month} (most recent month in range)`;
  return {
    month: m.month,
    openingHc: kpi("attr_opening_hc", "Opening HC", m.openingHc, "count", suffix),
    closingHc: kpi("attr_closing_hc", "Closing HC", m.closingHc, "count", suffix),
    avgHc: kpi("attr_avg_hc", "Avg HC", m.avgHc, "count", suffix),
    attritionCount: kpi("attr_count", "Attrition Count", m.attritionCount, "count", suffix),
    attritionRate: kpi("attr_rate", "Attrition %", m.attritionRate, "percent", `${m.attritionCount} of avg HC ${m.avgHc} — ${suffix}`),
    scheduled: kpi("attr_scheduled", "Scheduled", m.scheduled, "count", suffix),
    unplannedLeave: kpi("attr_ul", "Unplanned Leave (UL)", m.unplannedLeave, "count", suffix),
    ulShrinkageRate: kpi("attr_ul_shrinkage", "UL Shrinkage %", m.ulShrinkageRate, "percent", `${m.unplannedLeave} of ${m.scheduled} scheduled — ${suffix}`),
    actualShrinkageRate: kpi("attr_actual_shrinkage", "Actual Shrinkage %", m.actualShrinkageRate, "percent", `${m.actualUl} of ${m.scheduled} scheduled — ${suffix}`),
  };
}

export type AttritionDimension = "am_name" | "tl_name" | "aon_bucket" | "location";

export interface AttritionBreakdownRow {
  label: string;
  /** The value as stored in the source column — what a record-level drill-down
   *  must filter on. Differs from `label` only for AON, whose buckets are shown
   *  under normalised names ("Above than 90" is displayed as "Above 90"). */
  rawLabel: string;
  month: string;
  openingHc: number;
  closingHc: number;
  avgHc: number;
  attritionCount: number;
  attritionRate: number | null;
  scheduled: number;
  unplannedLeave: number;
  actualUl: number;
  ulShrinkageRate: number | null;
  actualShrinkageRate: number | null;
  note?: string;
}

/** Same per-month scoping as getAttritionOverview, grouped by AM/TL/AON/Location. */
export async function getAttritionBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, dimension: AttritionDimension
): Promise<AttritionBreakdownRow[]> {
  const months = await getAttritionMonthlyDetail(rawFilters);
  const targetMonth = months[months.length - 1]?.month;
  if (!targetMonth) return [];

  const pool = await getOnfidoPool();
  const col = dimension;
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const { start, end } = monthBounds(targetMonth);

  // Opening/closing are every group's on-floor HC on the MONTH's first and last
  // available day — not the first/last day that group happens to appear. A TL
  // who took over mid-month therefore opens at 0, exactly as the reference
  // shows (e.g. its Sep-26 TL table: opening 0, closing 6).
  const [[bounds]] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(MIN(work_date), '%Y-%m-%d') AS firstDay, DATE_FORMAT(MAX(work_date), '%Y-%m-%d') AS lastDay
       FROM onfido_agent_daily_raw WHERE work_date BETWEEN ? AND ? ${clause} AND ${ONFLOOR}`,
    [start, end, ...params]
  );
  if (!bounds?.firstDay) return [];

  // HC and attrition are on-floor; scheduled and UL span every state, the same
  // split getAttritionMonthlyDetail uses, so the rows reconcile to the month.
  const [aggRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${col}), ''), '(unassigned)') AS label,
            COALESCE(SUM(CASE WHEN ${ONFLOOR} AND work_date = ? THEN hc ELSE 0 END),0) AS openingHc,
            COALESCE(SUM(CASE WHEN ${ONFLOOR} AND work_date = ? THEN hc ELSE 0 END),0) AS closingHc,
            COALESCE(SUM(CASE WHEN ${ONFLOOR} THEN hc ELSE 0 END),0) AS onfloorHcDays,
            COALESCE(SUM(CASE WHEN ${ONFLOOR} THEN attrition_flag ELSE 0 END),0) AS attrition,
            COALESCE(SUM(scheduled),0) AS scheduled,
            COALESCE(SUM(unplanned_leave),0) AS ul,
            COALESCE(SUM(actual_ul),0) AS actualUl
       FROM onfido_agent_daily_raw WHERE work_date BETWEEN ? AND ? ${clause}
       GROUP BY label`,
    [bounds.firstDay, bounds.lastDay, start, end, ...params]
  );

  const rows = aggRows
    // A group with no on-floor presence all month — the "Training" AM/TL, the
    // "Practice" AON bucket — is not a team with a headcount. The reference
    // omits these, and a two-point average over them is how rates of 3000%+
    // were produced before, so they are left out rather than rated.
    .filter((r) => Number(r.onfloorHcDays ?? 0) > 0)
    .map((r): AttritionBreakdownRow | null => {
      const raw = String(r.label);
      // An AON label outside the known buckets is shown as-is, never dropped:
      // dropping it silently shrinks the table below the month's own totals.
      const label = dimension === "aon_bucket" ? (aonDisplayLabel(raw) ?? raw) : raw;
      const openingHc = Number(r.openingHc ?? 0);
      const closingHc = Number(r.closingHc ?? 0);
      const avgHc = twoPointAvg(openingHc, closingHc);
      const attrition = Number(r.attrition ?? 0);
      const scheduled = Number(r.scheduled ?? 0);
      return {
        label, rawLabel: raw, month: targetMonth, openingHc, closingHc, avgHc,
        attritionCount: attrition,
        attritionRate: rate2(attrition, avgHc),
        scheduled, unplannedLeave: Number(r.ul ?? 0), actualUl: Number(r.actualUl ?? 0),
        ulShrinkageRate: rate2(Number(r.ul ?? 0), scheduled),
        actualShrinkageRate: rate2(Number(r.actualUl ?? 0), scheduled),
      };
    })
    .filter((r): r is AttritionBreakdownRow => r !== null);

  // Ordering follows the reference: AM alphabetical, AON by bucket, TL (and
  // anything else) worst attrition first.
  if (dimension === "am_name") return rows.sort((a, b) => a.label.localeCompare(b.label));
  if (dimension === "aon_bucket") {
    const rank = (l: string) => { const i = AON_BUCKETS.findIndex((b) => b.label === l); return i === -1 ? AON_BUCKETS.length : i; };
    return rows.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
  }
  return rows.sort((a, b) => (b.attritionRate ?? -1) - (a.attritionRate ?? -1) || b.attritionCount - a.attritionCount);
}

export interface AttritionAonMonthRow { month: string; buckets: Record<string, number | null> }

/**
 * Attrition % per AON bucket, per calendar month — the "AON Month Wise ·
 * Attrition %" chart. Each month uses its own first/last on-floor day for the
 * two-point Avg HC, exactly as getAttritionMonthlyDetail does for the total.
 */
export async function getAttritionAonMonthly(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<AttritionAonMonthRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(work_date, '%Y-%m-%d') AS day, TRIM(aon_bucket) AS aon,
            COALESCE(SUM(hc),0) AS hc, COALESCE(SUM(attrition_flag),0) AS attrition
       FROM onfido_agent_daily_raw WHERE work_date BETWEEN ? AND ? ${clause} AND ${ONFLOOR}
       GROUP BY day, aon ORDER BY day`,
    [f.from, f.to, ...params]
  );

  // month -> { firstDay, lastDay, per bucket: hc by day + attrition }
  const months = new Map<string, { first: string; last: string; buckets: Map<string, { hcByDay: Map<string, number>; attrition: number }> }>();
  const extraLabels = new Set<string>();
  for (const r of rows) {
    const raw = String(r.aon ?? "").trim() || "(unassigned)";
    const label = aonDisplayLabel(raw) ?? raw;
    if (!AON_BUCKETS.some((b) => b.label === label)) extraLabels.add(label);
    const day = String(r.day);
    const ym = day.slice(0, 7);
    let m = months.get(ym);
    if (!m) { m = { first: day, last: day, buckets: new Map() }; months.set(ym, m); }
    if (day < m.first) m.first = day;
    if (day > m.last) m.last = day;
    let b = m.buckets.get(label);
    if (!b) { b = { hcByDay: new Map(), attrition: 0 }; m.buckets.set(label, b); }
    b.hcByDay.set(day, (b.hcByDay.get(day) ?? 0) + Number(r.hc ?? 0));
    b.attrition += Number(r.attrition ?? 0);
  }

  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => {
    const buckets: Record<string, number | null> = {};
    // Unrecognised labels are reported alongside the known buckets, not dropped.
    for (const label of [...AON_BUCKETS.map((b) => b.label), ...extraLabels]) {
      const b = m.buckets.get(label);
      buckets[label] = b ? rate2(b.attrition, twoPointAvg(b.hcByDay.get(m.first) ?? 0, b.hcByDay.get(m.last) ?? 0)) : null;
    }
    return { month, buckets };
  });
}

export interface AttritionReasonGroup {
  type: "Voluntary" | "Involuntary" | "Unspecified";
  totals: number[];
  total: number;
  reasons: { reason: string; counts: number[]; total: number }[];
}
export interface AttritionReasonMonthly {
  months: string[];
  groups: AttritionReasonGroup[];
  grandTotals: number[];
  grandTotal: number;
}

/**
 * Month-on-month attrition count by type and reason — the Voluntary vs
 * Involuntary chart and the Reason-wise table. On-floor exits only, the same
 * population as the Attrition Count, so every month's grand total equals it.
 *
 * The upload spells both columns inconsistently ("Involuntary" / "InVoluntary",
 * "Health Issue" / "Health issue"), so values are grouped case-insensitively and
 * shown in their most common spelling. Exits with no type are kept, under
 * "Unspecified", rather than dropped — otherwise the grand total stops matching.
 */
export async function getAttritionReasonMonthly(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<AttritionReasonMonthly> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(work_date, '%Y-%m') AS ym, TRIM(attrition_type) AS type, TRIM(attrition_reason) AS reason,
            COALESCE(SUM(attrition_flag),0) AS n
       FROM onfido_agent_daily_raw WHERE attrition_flag = 1 AND work_date BETWEEN ? AND ? ${clause} AND ${ONFLOOR}
       GROUP BY ym, type, reason`,
    [f.from, f.to, ...params]
  );

  const months = [...new Set(rows.map((r) => String(r.ym)))].sort();
  const mIdx = new Map(months.map((m, i) => [m, i]));
  const typeOf = (t: unknown): AttritionReasonGroup["type"] => {
    const k = String(t ?? "").trim().toLowerCase();
    return k === "voluntary" ? "Voluntary" : k === "involuntary" ? "Involuntary" : "Unspecified";
  };

  // group -> reasonKey -> { counts, spellings }
  const acc = new Map<AttritionReasonGroup["type"], Map<string, { counts: number[]; spellings: Map<string, number> }>>();
  for (const r of rows) {
    const type = typeOf(r.type);
    const spelling = String(r.reason ?? "").trim() || "Not specified";
    const key = spelling.toLowerCase();
    const n = Number(r.n ?? 0);
    let g = acc.get(type);
    if (!g) { g = new Map(); acc.set(type, g); }
    let e = g.get(key);
    if (!e) { e = { counts: months.map(() => 0), spellings: new Map() }; g.set(key, e); }
    e.counts[mIdx.get(String(r.ym))!] += n;
    e.spellings.set(spelling, (e.spellings.get(spelling) ?? 0) + n);
  }

  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const groups: AttritionReasonGroup[] = (["Voluntary", "Involuntary", "Unspecified"] as const)
    .filter((type) => acc.has(type))
    .map((type) => {
      const reasons = [...acc.get(type)!.values()]
        .map((e) => ({
          reason: [...e.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
          counts: e.counts,
          total: sum(e.counts),
        }))
        .sort((a, b) => b.total - a.total);
      const totals = months.map((_, i) => sum(reasons.map((x) => x.counts[i])));
      return { type, totals, total: sum(totals), reasons };
    });

  const grandTotals = months.map((_, i) => sum(groups.map((g) => g.totals[i])));
  return { months, groups, grandTotals, grandTotal: sum(grandTotals) };
}

export interface AttritionExitRow {
  id: string;
  empId: string; empName: string; analystEmail: string; tlName: string; amName: string;
  exitDate: string; reason: string | null; attritionType: string | null;
}

/** Every real exit row in range — the record-level drill-down behind the count.
 *  Carries `id` so the frontend can open the same full-record drawer every
 *  other table's rows do (GET /records/ONFIDO_AGENT_DAILY/:id). */
export async function listAttritionExits(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }): Promise<AttritionExitRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, emp_id, emp_name, analyst_email, tl_name, am_name, work_date, attrition_reason, attrition_type
       FROM onfido_agent_daily_raw WHERE attrition_flag = 1 AND work_date BETWEEN ? AND ? ${clause}
       ORDER BY work_date DESC LIMIT 500`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => ({
    id: r.id,
    empId: r.emp_id, empName: r.emp_name, analystEmail: r.analyst_email, tlName: r.tl_name, amName: r.am_name,
    exitDate: r.work_date instanceof Date ? r.work_date.toISOString().slice(0, 10) : String(r.work_date),
    reason: r.attrition_reason, attritionType: r.attrition_type,
  }));
}

// ── ETM (Escalated Task Management) — onfido_doc_etm_raw / onfido_poa_etm_raw ─
//
// Every row in these two tables is, by definition, an escalated task (that is
// what the ETM export contains) — so "ETM count" is simply COUNT(*) in range,
// same as the Overview cards' volume KPIs.

// ── Shared day-wise pivot + latest-day/YTD KPI helpers, used by both ETM and
//    Task Skip below to match the reference dashboard's "Analyst/Client/
//    Document-or-Task-Type Day-wise Trend" and "Day and Slot-wise Trend"
//    panels, and its 3-card KPI row (Selected / Latest Day / Jan-to-date). ──

async function countBetween(table: string, dateCol: string, from: string, to: string, clause: string, params: string[]): Promise<number> {
  const r = await scalar<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${dateCol} BETWEEN ? AND ? ${clause}`, [from, to, ...params]
  );
  return Number(r.n ?? 0);
}

async function latestDateOnOrBefore(table: string, dateCol: string, upTo: string, clause: string, params: string[]): Promise<string | null> {
  // DATE_FORMAT in SQL, not JS-side Date handling: mysql2 returns MAX() on a
  // DATE column as a JS Date object (no dateStrings on this pool), and
  // String(date).slice(0,10) mangles it into "Mon Sep 07" instead of an ISO
  // date — the same trap every other date column in this file avoids by
  // formatting in SQL.
  const r = await scalar<RowDataPacket & { d: string | null }>(
    `SELECT DATE_FORMAT(MAX(${dateCol}), '%Y-%m-%d') AS d FROM ${table} WHERE ${dateCol} <= ? ${clause}`, [upTo, ...params]
  );
  return r.d ?? null;
}

/** Selected-range count / latest-day count / Jan-to-date count — the reference
 *  dashboard's 3-card KPI row, computed once per queue/table. */
async function threeCardKpis(
  table: string, dateCol: string, from: string, to: string, clause: string, params: string[], keyPrefix: string, ytdSuffix: string
): Promise<{ selected: KpiValue; latestDay: KpiValue; ytd: KpiValue }> {
  const selected = await countBetween(table, dateCol, from, to, clause, params);
  const latestDate = await latestDateOnOrBefore(table, dateCol, to, clause, params);
  const latestCount = latestDate ? await countBetween(table, dateCol, latestDate, latestDate, clause, params) : 0;
  const yearStart = `${to.slice(0, 4)}-01-01`;
  const ytdCount = await countBetween(table, dateCol, yearStart, to, clause, params);
  return {
    selected: { key: `${keyPrefix}_selected`, label: "Selected Data Count", value: selected, unit: "count", availability: "ok", note: `${from} to ${to}` },
    latestDay: { key: `${keyPrefix}_latest`, label: "Latest Day Count", value: latestCount, unit: "count", availability: latestDate ? "ok" : "no_data", note: latestDate ?? undefined },
    ytd: { key: `${keyPrefix}_ytd`, label: `${yearStart.slice(0, 4)} to Till ${ytdSuffix}`, value: ytdCount, unit: "count", availability: "ok", note: `${yearStart} to ${to}` },
  };
}

export interface DayPivotRow { label: string; byDay: Record<string, number>; total: number }
export interface DayPivot { days: string[]; rows: DayPivotRow[]; dayTotals: Record<string, number> }

/** Generic label x day pivot ("Analyst/Client/Document-Type/Slot Day-wise
 *  Trend" panels). Text labels are ranked by total, descending, and capped at
 *  `limit`; numeric labels (the GMT `slot` hour, 0-23) are kept in full and
 *  sorted by value instead, matching the reference's hour-ordered rows. */
async function dayWisePivot(
  table: string, dateCol: string, groupCol: string,
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string },
  opts: { limit?: number; numeric?: boolean } = {}
): Promise<DayPivot> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail, table === "onfido_task_skip_raw" ? "unassigned_from_email" : "analyst_email");
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(${dateCol}, '%Y-%m-%d') AS day,
            COALESCE(NULLIF(TRIM(CAST(${groupCol} AS CHAR)), ''), '(unassigned)') AS label,
            COUNT(*) AS n
       FROM ${table} WHERE ${dateCol} BETWEEN ? AND ? ${clause} AND ${groupCol} IS NOT NULL
       GROUP BY day, label`,
    [f.from, f.to, ...params]
  );

  const days = new Set<string>();
  const byLabel = new Map<string, Map<string, number>>();
  const dayTotals = new Map<string, number>();
  for (const r of rows) {
    const day = String(r.day);
    const label = String(r.label);
    const n = Number(r.n);
    days.add(day);
    if (!byLabel.has(label)) byLabel.set(label, new Map());
    byLabel.get(label)!.set(day, n);
    dayTotals.set(day, (dayTotals.get(day) ?? 0) + n);
  }

  let pivotRows: DayPivotRow[] = [...byLabel.entries()].map(([label, byDayMap]) => {
    const byDay: Record<string, number> = {};
    let total = 0;
    for (const [day, n] of byDayMap) { byDay[day] = n; total += n; }
    return { label, byDay, total };
  });

  if (opts.numeric) {
    pivotRows.sort((a, b) => Number(a.label) - Number(b.label));
  } else {
    pivotRows.sort((a, b) => b.total - a.total);
    if (opts.limit) pivotRows = pivotRows.slice(0, opts.limit);
  }

  const sortedDays = [...days].sort();
  const dayTotalsObj: Record<string, number> = {};
  for (const d of sortedDays) dayTotalsObj[d] = dayTotals.get(d) ?? 0;
  return { days: sortedDays, rows: pivotRows, dayTotals: dayTotalsObj };
}

export interface EtmQueueKpis { selected: KpiValue; latestDay: KpiValue; ytd: KpiValue }
export interface EtmOverview { doc: EtmQueueKpis; poa: EtmQueueKpis }

export async function getEtmOverview(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }): Promise<EtmOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const doc = await threeCardKpis("onfido_doc_etm_raw", "report_date", f.from, f.to, clause, params, "etm_doc", "DOC ETM");
  const poa = await threeCardKpis("onfido_poa_etm_raw", "report_date", f.from, f.to, clause, params, "etm_poa", "POA ETM");
  return { doc, poa };
}

export interface EtmTrendPoint { month: string; doc: number; poa: number }

export async function getEtmMonthlyTrend(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }): Promise<EtmTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [docRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m') AS ym, COUNT(*) AS n
       FROM onfido_doc_etm_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY ym ORDER BY ym`,
    [f.from, f.to, ...params]
  );
  const [poaRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date, '%Y-%m') AS ym, COUNT(*) AS n
       FROM onfido_poa_etm_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY ym ORDER BY ym`,
    [f.from, f.to, ...params]
  );
  const byMonth = new Map<string, { doc: number; poa: number }>();
  for (const r of docRows) byMonth.set(r.ym, { doc: Number(r.n), poa: 0 });
  for (const r of poaRows) {
    const existing = byMonth.get(r.ym) ?? { doc: 0, poa: 0 };
    existing.poa = Number(r.n);
    byMonth.set(r.ym, existing);
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));
}

export type EtmQueue = "doc" | "poa";
export type EtmDimension = "tl_name" | "am_name" | "escalated_by_email" | "aon_bucket";

export interface EtmBreakdownRow { label: string; count: number }

export async function getEtmBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, queue: EtmQueue, dimension: EtmDimension
): Promise<EtmBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const table = queue === "doc" ? "onfido_doc_etm_raw" : "onfido_poa_etm_raw";
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label, COUNT(*) AS n
       FROM ${table} WHERE report_date BETWEEN ? AND ? ${clause}
       GROUP BY label ORDER BY n DESC LIMIT 30`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => ({ label: r.label, count: Number(r.n) }));
}

/** Same breakdown, scoped to the single most recent day in range instead of
 *  the whole window — the reference dashboard's "Latest Day" distribution. */
export async function getEtmLatestDayBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, queue: EtmQueue, dimension: EtmDimension
): Promise<{ date: string | null; rows: EtmBreakdownRow[] }> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const table = queue === "doc" ? "onfido_doc_etm_raw" : "onfido_poa_etm_raw";
  const date = await latestDateOnOrBefore(table, "report_date", f.to, clause, params);
  if (!date) return { date: null, rows: [] };
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label, COUNT(*) AS n
       FROM ${table} WHERE report_date = ? ${clause}
       GROUP BY label ORDER BY n DESC LIMIT 30`,
    [date, ...params]
  );
  return { date, rows: rows.map((r) => ({ label: r.label, count: Number(r.n) })) };
}

export type EtmPivotDimension = "analyst" | "slot" | "client" | "document_type";

/** "Analyst/Client/Document Type Day-wise Trend" + "Day and Slot-wise Trend"
 *  panels. document_type does not exist on onfido_poa_etm_raw (POA has no
 *  document-type field in the source export), so that combination returns an
 *  empty pivot rather than a SQL error. */
export async function getEtmDayPivot(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, queue: EtmQueue, by: EtmPivotDimension
): Promise<DayPivot> {
  if (by === "document_type" && queue === "poa") return { days: [], rows: [], dayTotals: {} };
  const table = queue === "doc" ? "onfido_doc_etm_raw" : "onfido_poa_etm_raw";
  const col = by === "analyst" ? "analyst_email" : by === "slot" ? "slot" : by === "client" ? "ims_client_name" : "document_type";
  return dayWisePivot(table, "report_date", col, rawFilters, { limit: by === "slot" ? undefined : 15, numeric: by === "slot" });
}

// ── Task Skip — onfido_task_skip_raw ────────────────────────────────────────

export interface TaskSkipOverview { selected: KpiValue; latestDay: KpiValue; ytd: KpiValue }

export async function getTaskSkipOverview(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }): Promise<TaskSkipOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail, "unassigned_from_email");
  return threeCardKpis("onfido_task_skip_raw", "skip_date", f.from, f.to, clause, params, "taskskip", "Task Skip");
}

export interface TaskSkipTrendPoint { month: string; count: number }

export async function getTaskSkipMonthlyTrend(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }): Promise<TaskSkipTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail, "unassigned_from_email");
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(skip_date, '%Y-%m') AS ym, COUNT(*) AS n
       FROM onfido_task_skip_raw WHERE skip_date BETWEEN ? AND ? ${clause} GROUP BY ym ORDER BY ym`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => ({ month: r.ym, count: Number(r.n) }));
}

export type TaskSkipDimension = "tl_name" | "am_name" | "unassigned_from_email" | "ims_client_name" | "task_type";

export interface TaskSkipBreakdownRow { label: string; count: number }

export async function getTaskSkipBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, dimension: TaskSkipDimension
): Promise<TaskSkipBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail, "unassigned_from_email");
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label, COUNT(*) AS n
       FROM onfido_task_skip_raw WHERE skip_date BETWEEN ? AND ? ${clause}
       GROUP BY label ORDER BY n DESC LIMIT 30`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => ({ label: r.label, count: Number(r.n) }));
}

/** Same breakdown, scoped to the single most recent day in range — the
 *  reference dashboard's "Latest Day" distribution. */
export async function getTaskSkipLatestDayBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, dimension: TaskSkipDimension
): Promise<{ date: string | null; rows: TaskSkipBreakdownRow[] }> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail, "unassigned_from_email");
  const date = await latestDateOnOrBefore("onfido_task_skip_raw", "skip_date", f.to, clause, params);
  if (!date) return { date: null, rows: [] };
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label, COUNT(*) AS n
       FROM onfido_task_skip_raw WHERE skip_date = ? ${clause}
       GROUP BY label ORDER BY n DESC LIMIT 30`,
    [date, ...params]
  );
  return { date, rows: rows.map((r) => ({ label: r.label, count: Number(r.n) })) };
}

export type TaskSkipPivotDimension = "analyst" | "slot" | "client" | "task_type";

/** "Analyst/Client/Task Type Day-wise Trend" + "Day and Slot-wise Trend" panels. */
export async function getTaskSkipDayPivot(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, by: TaskSkipPivotDimension
): Promise<DayPivot> {
  const col = by === "analyst" ? "unassigned_from_email" : by === "slot" ? "slot" : by === "client" ? "ims_client_name" : "task_type";
  return dayWisePivot("onfido_task_skip_raw", "skip_date", col, rawFilters, { limit: by === "slot" ? undefined : 15, numeric: by === "slot" });
}

// ── Quality Breakdown — onfido_doc_external_audit_raw ───────────────────────
//
// The richest per-task DOC table (340 real clients, 732 real document types
// in the current data) but until now only fed Analyst Performance and
// Alerts — every other Overview KPI reads the much smaller doc_raw/
// doc_quality_raw test-scale tables (tens to a few hundred rows) instead.
// Same real per-row flags Analyst Performance already reads: has_error,
// manual_far_flag, manual_frr_flag, classification/extraction/add_extraction/
// raw_extraction_flag.

export interface QualityOverview {
  taskCount: KpiValue;
  overallErrorRate: KpiValue;
  farRate: KpiValue;
  frrRate: KpiValue;
  classificationErrorRate: KpiValue;
  extractionErrorRate: KpiValue;
  addExtractionErrorRate: KpiValue;
  rawExtractionErrorRate: KpiValue;
}

export async function getQualityOverview(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }): Promise<QualityOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const agg = await scalar<RowDataPacket & {
    total: number; errors: number; farN: number; frrN: number;
    classN: number; extN: number; addExtN: number; rawExtN: number;
  }>(
    `SELECT COUNT(*) AS total, SUM(has_error) AS errors, SUM(manual_far_flag) AS farN, SUM(manual_frr_flag) AS frrN,
            SUM(classification_flag) AS classN, SUM(extraction_flag) AS extN,
            SUM(add_extraction_flag) AS addExtN, SUM(raw_extraction_flag) AS rawExtN
       FROM onfido_doc_external_audit_raw WHERE report_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  const total = Number(agg.total ?? 0);
  const r2 = (n: number) => rate2(n, total);
  return {
    taskCount: kpi("quality_task_count", "Tasks Audited", total, "count"),
    overallErrorRate: kpi("quality_overall_err", "Overall Error Rate", r2(Number(agg.errors ?? 0)), "percent", `${agg.errors ?? 0} of ${total}`),
    farRate: kpi("quality_far", "Manual FAR Rate", r2(Number(agg.farN ?? 0)), "percent", `${agg.farN ?? 0} of ${total}`),
    frrRate: kpi("quality_frr", "Manual FRR Rate", r2(Number(agg.frrN ?? 0)), "percent", `${agg.frrN ?? 0} of ${total}`),
    classificationErrorRate: kpi("quality_class", "Classification Error Rate", r2(Number(agg.classN ?? 0)), "percent", `${agg.classN ?? 0} of ${total}`),
    extractionErrorRate: kpi("quality_ext", "Extraction Error Rate", r2(Number(agg.extN ?? 0)), "percent", `${agg.extN ?? 0} of ${total}`),
    addExtractionErrorRate: kpi("quality_add_ext", "Add. Extraction Error Rate", r2(Number(agg.addExtN ?? 0)), "percent", `${agg.addExtN ?? 0} of ${total}`),
    rawExtractionErrorRate: kpi("quality_raw_ext", "Raw Extraction Error Rate", r2(Number(agg.rawExtN ?? 0)), "percent", `${agg.rawExtN ?? 0} of ${total}`),
  };
}

export type QualityDimension = "ims_client_name" | "docupedia_document_name" | "tl_name" | "am_name";

export interface QualityBreakdownRow {
  label: string; taskCount: number; overallErrorRate: number | null; farRate: number | null; frrRate: number | null;
}

export async function getQualityBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, dimension: QualityDimension
): Promise<QualityBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label,
            COUNT(*) AS total, SUM(has_error) AS errors, SUM(manual_far_flag) AS farN, SUM(manual_frr_flag) AS frrN
       FROM onfido_doc_external_audit_raw WHERE report_date BETWEEN ? AND ? ${clause}
       GROUP BY label ORDER BY total DESC LIMIT 50`,
    [f.from, f.to, ...params]
  );
  return rows.map((r): QualityBreakdownRow => {
    const total = Number(r.total ?? 0);
    return {
      label: r.label, taskCount: total,
      overallErrorRate: rate1(Number(r.errors ?? 0), total),
      farRate: rate1(Number(r.farN ?? 0), total),
      frrRate: rate1(Number(r.frrN ?? 0), total),
    };
  });
}

export interface QualityMetricTrendPoint {
  bucket: string;
  overallErrorRate: number | null;
  classificationErrorRate: number | null;
  extractionErrorRate: number | null;
  addExtractionErrorRate: number | null;
  rawExtractionErrorRate: number | null;
}

/** Bucketed counterpart to getQualityOverview — the Quality page's month/week/
 *  day-wise trend table (2026-09-17 feedback), one row per metric across time
 *  buckets. Each sub-rate uses its own *_total denominator column, same
 *  "Classification Error% = SUM(Classification Error) / Total Audit" formula
 *  getOverview's docExtQuality block already uses — not COUNT(*). */
export async function getQualityMetricTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<QualityMetricTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_date", granularity)} AS bucket,
            COUNT(*) AS total, COALESCE(SUM(has_error),0) AS errors,
            COALESCE(SUM(classification_flag),0) AS classN, COALESCE(SUM(classification_total),0) AS classTotal,
            COALESCE(SUM(extraction_flag),0) AS extN, COALESCE(SUM(extraction_total),0) AS extTotal,
            COALESCE(SUM(add_extraction_flag),0) AS addN, COALESCE(SUM(add_extraction_total),0) AS addTotal,
            COALESCE(SUM(raw_extraction_flag),0) AS rawN, COALESCE(SUM(raw_extraction_total),0) AS rawTotal
       FROM onfido_doc_external_audit_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => {
    const total = Number(r.total ?? 0);
    return {
      bucket: bucketLabel(r.bucket, granularity),
      overallErrorRate: rate1(Number(r.errors ?? 0), total),
      classificationErrorRate: rate1(Number(r.classN ?? 0), Number(r.classTotal ?? 0)),
      extractionErrorRate: rate1(Number(r.extN ?? 0), Number(r.extTotal ?? 0)),
      addExtractionErrorRate: rate1(Number(r.addN ?? 0), Number(r.addTotal ?? 0)),
      rawExtractionErrorRate: rate1(Number(r.rawN ?? 0), Number(r.rawTotal ?? 0)),
    };
  });
}

// ── Client Escalations (CRE + CRQ combined) ─────────────────────────────────
//
// CRE and CRQ are two file formats for the same real thing — a client
// reporting back an error on a DOC report — with an identical extracted
// column shape (ims_report_url, report_completed_date, analyst_email,
// tl_name, am_name, qa_name, report_sub_result, qc_sub_result,
// ims_client_name, error_category, error_breakdown, month_label). CRE is the
// current format (Jan'26 onward); CRQ is the earlier format the client used
// before switching, with real coverage back to 2022. Every function below
// UNIONs the two raw tables rather than picking one, so an escalation
// reported under either format counts once, and none of them JOIN across
// tables — same per-table-aggregate-then-combine approach as getOverview.
//
// Dated by qc_updated_date, not report_completed_date: report_completed_date
// is when the original DOC report was finished, which can be well over a
// year before the client actually raised/QC-logged the escalation against
// it (live data: report_completed_date 2024-05-21 vs qc_updated_date
// 2026-07-09 on the same row is typical, not an outlier). A date-range
// filter meant to answer "what did QC review this week/month" needs
// qc_updated_date; report_completed_date silently drops or misdates every
// escalation whose underlying report is older than the selected range.

const escCre = "onfido_doc_escalation_cre_raw";
const escCrq = "onfido_doc_escalation_crq_raw";

export interface EscalationOverview {
  totalLines: KpiValue;
  creLines: KpiValue;
  crqLines: KpiValue;
  distinctReports: KpiValue;
}

export async function getEscalationOverview(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<EscalationOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const cre = await scalar<RowDataPacket & { n: number; reports: number }>(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT ims_report_url) AS reports
       FROM ${escCre} WHERE qc_updated_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const crq = await scalar<RowDataPacket & { n: number; reports: number }>(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT ims_report_url) AS reports
       FROM ${escCrq} WHERE qc_updated_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  const creN = Number(cre.n ?? 0);
  const crqN = Number(crq.n ?? 0);
  return {
    totalLines: kpi("escalation_total", "Client-Reported Error Lines", creN + crqN, "count", `${creN} CRE + ${crqN} CRQ`),
    creLines: kpi("escalation_cre", "CRE Lines", creN, "count", `${cre.reports ?? 0} distinct report(s)`),
    crqLines: kpi("escalation_crq", "CRQ Lines", crqN, "count", `${crq.reports ?? 0} distinct report(s)`),
    distinctReports: kpi("escalation_reports", "Distinct Escalated Reports", Number(cre.reports ?? 0) + Number(crq.reports ?? 0), "count"),
  };
}

export interface EscalationTrendPoint { bucket: string; count: number; creCount: number; crqCount: number; }

export async function getEscalationTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<EscalationTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const expr = bucketExpr("qc_updated_date", granularity);
  const [creRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM ${escCre}
      WHERE qc_updated_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  const [crqRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM ${escCrq}
      WHERE qc_updated_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  const byBucket = new Map<string, { creCount: number; crqCount: number }>();
  for (const r of creRows) {
    const key = bucketLabel(r.bucket, granularity);
    byBucket.set(key, { creCount: Number(r.n), crqCount: byBucket.get(key)?.crqCount ?? 0 });
  }
  for (const r of crqRows) {
    const key = bucketLabel(r.bucket, granularity);
    byBucket.set(key, { creCount: byBucket.get(key)?.creCount ?? 0, crqCount: Number(r.n) });
  }
  return [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, { creCount, crqCount }]) => ({ bucket, creCount, crqCount, count: creCount + crqCount }));
}

export type EscalationDimension = "ims_client_name" | "error_category" | "error_breakdown" | "analyst_email" | "tl_name" | "am_name";

export interface EscalationBreakdownRow { label: string; count: number; }

/** Optional slicer on the Client Escalations page: only CRE or only CRQ. Absent = both (unchanged). */
export type EscalationSource = "CRE" | "CRQ";

export async function getEscalationBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, dimension: EscalationDimension,
  source?: EscalationSource
): Promise<EscalationBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const side = (table: string) =>
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label, COUNT(*) AS cnt
       FROM ${table} WHERE qc_updated_date BETWEEN ? AND ? ${clause} GROUP BY label`;
  const tables = source === "CRE" ? [escCre] : source === "CRQ" ? [escCrq] : [escCre, escCrq];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT label, SUM(cnt) AS total FROM (${tables.map(side).join(" UNION ALL ")}) t
      GROUP BY label ORDER BY total DESC LIMIT 50`,
    tables.flatMap(() => [f.from, f.to, ...params])
  );
  return rows.map((r) => ({ label: r.label, count: Number(r.total ?? 0) }));
}

/**
 * Raw record list behind an Escalations breakdown row — unlike every other
 * breakdown in this file, CRE and CRQ are two physically separate tables, so
 * this queries both and tags each row with which one it came from
 * (`escalation_source`), which the frontend passes straight back as the
 * `table` argument to the shared record-detail route (GET /records/:table/:id)
 * — the row already carries everything needed to open its own full detail,
 * no new detail endpoint required.
 */
export interface EscalationRecordRow extends RowDataPacket { escalation_source: "CRE" | "CRQ"; }

export async function getEscalationRecords(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string },
  dimension: EscalationDimension,
  value: string,
  limit = 50,
  source?: EscalationSource
): Promise<{ rows: EscalationRecordRow[]; total: number }> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const dimCond = value === "(unassigned)" ? `(${dimension} IS NULL OR TRIM(${dimension}) = '')` : `${dimension} = ?`;
  const valParams = value === "(unassigned)" ? [] : [value];

  const wantCre = source !== "CRQ";
  const wantCrq = source !== "CRE";
  const [creRows] = wantCre ? await pool.query<RowDataPacket[]>(
    `SELECT *, 'CRE' AS escalation_source FROM ${escCre}
      WHERE qc_updated_date BETWEEN ? AND ? ${clause} AND ${dimCond}
      ORDER BY qc_updated_date DESC LIMIT ?`,
    [f.from, f.to, ...params, ...valParams, limit]
  ) : [[] as RowDataPacket[]];
  const [crqRows] = wantCrq ? await pool.query<RowDataPacket[]>(
    `SELECT *, 'CRQ' AS escalation_source FROM ${escCrq}
      WHERE qc_updated_date BETWEEN ? AND ? ${clause} AND ${dimCond}
      ORDER BY qc_updated_date DESC LIMIT ?`,
    [f.from, f.to, ...params, ...valParams, limit]
  ) : [[] as RowDataPacket[]];
  const rows = [...creRows, ...crqRows]
    .sort((a, b) => new Date(b.qc_updated_date as string).getTime() - new Date(a.qc_updated_date as string).getTime())
    .slice(0, limit) as EscalationRecordRow[];

  const countOf = async (table: string): Promise<number> => {
    const [[row]] = await pool.query<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE qc_updated_date BETWEEN ? AND ? ${clause} AND ${dimCond}`,
      [f.from, f.to, ...params, ...valParams]
    );
    return Number(row.n);
  };
  const total = (wantCre ? await countOf(escCre) : 0) + (wantCrq ? await countOf(escCrq) : 0);
  return { rows, total };
}

// ── Client & Document Report (item #6 of the 2026-09-12 feedback: "DOC Check
// and POA Client and document wise need report") ───────────────────────────
//
// The client's ask, verbatim from the email: filter by Document Name, a
// month-wise and week-wise trend, and a table of Client Name / Task / AHT.
// "Task" here means which queue the row is from — same UNION-with-a-tag
// approach as the Escalations (CRE/CRQ) section above, tagging every row
// "DOC" or "POA" rather than a per-row task subtype (onfido_doc_raw's own
// per-row "Task Type Short Name" field is blank on 99.9% of rows, so it
// cannot carry this distinction; DOC vs POA — which queue processed the
// document — is the real, always-populated dimension the client is asking
// to see broken out).
//
// document_name/ims_client_name on onfido_poa_raw and document_name on
// onfido_doc_raw did not exist as columns until this fix — both queues'
// upload files always carried a document-type column (confirmed in each
// row's own raw_data JSON), it just was never extracted. document_name on
// onfido_poa_raw is genuinely blank on ~43% of historical rows (older POA
// exports didn't always carry a sub-document-type) — real data, not a bug in
// this fix; the UI must show "(unspecified)" for it rather than hide the row.

const cdDoc = "onfido_doc_raw";
const cdPoa = "onfido_poa_raw";

function documentNameFilter(documentName?: string): { clause: string; params: string[] } {
  if (!documentName) return { clause: "", params: [] };
  return { clause: "AND document_name = ?", params: [documentName] };
}

export interface ClientDocOverview {
  totalTasks: KpiValue;
  docTasks: KpiValue;
  poaTasks: KpiValue;
  avgAht: KpiValue;
  distinctClients: KpiValue;
}

export async function getClientDocOverview(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string; documentName?: string }
): Promise<ClientDocOverview> {
  const f = readFilters(rawFilters);
  const { clause: tlClause, params: tlParams } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const { clause: docClause, params: docParams } = documentNameFilter(rawFilters.documentName);
  const doc = await scalar<RowDataPacket & { n: number; aht: number | null; clients: number }>(
    `SELECT COUNT(*) AS n, ${DOC_AHT_AVG} AS aht, COUNT(DISTINCT ims_client_name) AS clients
       FROM ${cdDoc} WHERE report_date BETWEEN ? AND ? ${tlClause} ${docClause}`,
    [f.from, f.to, ...tlParams, ...docParams]
  );
  const poa = await scalar<RowDataPacket & { n: number; aht: number | null; clients: number }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht, COUNT(DISTINCT ims_client_name) AS clients
       FROM ${cdPoa} WHERE report_completed_date BETWEEN ? AND ? ${tlClause} ${docClause}`,
    [f.from, f.to, ...tlParams, ...docParams]
  );
  const docN = Number(doc.n ?? 0);
  const poaN = Number(poa.n ?? 0);
  // Volume-weighted combine, same reasoning as getOverview's POA-raw+trial AHT combine.
  const weightedSum = (doc.aht !== null ? doc.aht * docN : 0) + (poa.aht !== null ? poa.aht * poaN : 0);
  const weightedCount = (doc.aht !== null ? docN : 0) + (poa.aht !== null ? poaN : 0);
  const combinedAht = weightedCount > 0 ? weightedSum / weightedCount : null;
  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  return {
    totalTasks: kpi("clientdoc_total", "DOC + POA Tasks", docN + poaN, "count", `${docN} DOC + ${poaN} POA`),
    docTasks: kpi("clientdoc_doc", "DOC Tasks", docN, "count"),
    poaTasks: kpi("clientdoc_poa", "POA Tasks", poaN, "count"),
    avgAht: kpi("clientdoc_aht", "Combined Avg AHT", combinedAht !== null ? Math.round(combinedAht) : null, "seconds"),
    distinctClients: kpi("clientdoc_clients", "Distinct Clients", Math.max(Number(doc.clients ?? 0), Number(poa.clients ?? 0)), "count"),
  };
}

export interface ClientDocTrendPoint { bucket: string; doc: number; poa: number }

/** Month-wise / week-wise trend only — the client asked for exactly these two,
 *  not the daily granularity the rest of the dashboard supports elsewhere. */
export async function getClientDocTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string; documentName?: string },
  granularity: "monthly" | "weekly"
): Promise<ClientDocTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause: tlClause, params: tlParams } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const { clause: docClause, params: docParams } = documentNameFilter(rawFilters.documentName);
  const pool = await getOnfidoPool();
  const [docRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_date", granularity)} AS bucket, COUNT(*) AS n
       FROM ${cdDoc} WHERE report_date BETWEEN ? AND ? ${tlClause} ${docClause} GROUP BY bucket`,
    [f.from, f.to, ...tlParams, ...docParams]
  );
  const [poaRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_completed_date", granularity)} AS bucket, COUNT(*) AS n
       FROM ${cdPoa} WHERE report_completed_date BETWEEN ? AND ? ${tlClause} ${docClause} GROUP BY bucket`,
    [f.from, f.to, ...tlParams, ...docParams]
  );
  const byBucket = new Map<string, { doc: number; poa: number }>();
  for (const r of docRows) {
    const key = bucketLabel(r.bucket, granularity);
    byBucket.set(key, { doc: Number(r.n), poa: byBucket.get(key)?.poa ?? 0 });
  }
  for (const r of poaRows) {
    const key = bucketLabel(r.bucket, granularity);
    byBucket.set(key, { doc: byBucket.get(key)?.doc ?? 0, poa: Number(r.n) });
  }
  return [...byBucket.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, v]) => ({ bucket, ...v }));
}

export interface ClientDocBreakdownRow { clientName: string; task: "DOC" | "POA"; taskCount: number; aht: number | null }

/** The client's requested table shape: Client Name / Task / AHT. */
export async function getClientDocBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string; documentName?: string }
): Promise<ClientDocBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause: tlClause, params: tlParams } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const { clause: docClause, params: docParams } = documentNameFilter(rawFilters.documentName);
  const pool = await getOnfidoPool();
  const [docRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(ims_client_name), ''), '(unassigned)') AS client_name,
            COUNT(*) AS n, ${DOC_AHT_AVG} AS aht
       FROM ${cdDoc} WHERE report_date BETWEEN ? AND ? ${tlClause} ${docClause} GROUP BY client_name`,
    [f.from, f.to, ...tlParams, ...docParams]
  );
  const [poaRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(ims_client_name), ''), '(unassigned)') AS client_name,
            COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM ${cdPoa} WHERE report_completed_date BETWEEN ? AND ? ${tlClause} ${docClause} GROUP BY client_name`,
    [f.from, f.to, ...tlParams, ...docParams]
  );
  const rows: ClientDocBreakdownRow[] = [
    ...docRows.map((r): ClientDocBreakdownRow => ({
      clientName: r.client_name, task: "DOC", taskCount: Number(r.n), aht: r.aht !== null ? Math.round(Number(r.aht)) : null,
    })),
    ...poaRows.map((r): ClientDocBreakdownRow => ({
      clientName: r.client_name, task: "POA", taskCount: Number(r.n), aht: r.aht !== null ? Math.round(Number(r.aht)) : null,
    })),
  ];
  return rows.sort((a, b) => b.taskCount - a.taskCount).slice(0, 200);
}

/** Real, observed Document Name values for the filter dropdown — the Form
 *  Input Rule requires this be a dropdown built from the real domain, never
 *  free text. Excludes blanks (onfido_poa_raw's ~43% unpopulated rows). */
export async function getClientDocDocumentOptions(): Promise<string[]> {
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT document_name, COUNT(*) AS n FROM (
       SELECT document_name FROM ${cdDoc} WHERE document_name IS NOT NULL AND TRIM(document_name) <> ''
       UNION ALL
       SELECT document_name FROM ${cdPoa} WHERE document_name IS NOT NULL AND TRIM(document_name) <> ''
     ) t GROUP BY document_name ORDER BY n DESC LIMIT 500`
  );
  return rows.map((r) => r.document_name as string).sort((a, b) => a.localeCompare(b));
}

export interface ClientDocRecordRow extends RowDataPacket { source_table: "ONFIDO_DOC_RAW" | "ONFIDO_POA_RAW" }

/** Raw records behind one Client+Task breakdown row — mirrors
 *  getEscalationRecords' per-row source tagging, but the tag here is a
 *  ready-to-use upload-type-code key (resolveTable already accepts either
 *  form), so the frontend can pass it straight through to the existing
 *  generic /records/:table/:id detail route with no extra mapping step. */
export async function getClientDocRecords(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string; documentName?: string },
  clientName: string | undefined,
  task: "DOC" | "POA",
  limit = 50,
  taskType?: string
): Promise<{ rows: ClientDocRecordRow[]; total: number }> {
  const f = readFilters(rawFilters);
  const { clause: tlClause, params: tlParams } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const { clause: docClause, params: docParams } = documentNameFilter(rawFilters.documentName);
  const pool = await getOnfidoPool();
  // clientName omitted = every client (the Document-wise ranking drills into a document, not a client).
  const clientCond = clientName === undefined ? "1 = 1"
    : clientName === "(unassigned)" ? "(ims_client_name IS NULL OR TRIM(ims_client_name) = '')" : "ims_client_name = ?";
  const clientParams = clientName === undefined || clientName === "(unassigned)" ? [] : [clientName];
  // Task type is a DOC-only field (raw_data); ignored for POA.
  const taskTypeCond = task === "DOC" && taskType ? `AND ${DOC_TASK_TYPE_LABEL_EXPR} = ?` : "";
  const taskTypeParams = task === "DOC" && taskType ? [taskType] : [];

  const table = task === "DOC" ? cdDoc : cdPoa;
  const dateCol = task === "DOC" ? "report_date" : "report_completed_date";
  const sourceTable = task === "DOC" ? "ONFIDO_DOC_RAW" : "ONFIDO_POA_RAW";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT *, '${sourceTable}' AS source_table FROM ${table}
      WHERE ${dateCol} BETWEEN ? AND ? ${tlClause} ${docClause} AND ${clientCond} ${taskTypeCond}
      ORDER BY ${dateCol} DESC LIMIT ?`,
    [f.from, f.to, ...tlParams, ...docParams, ...clientParams, ...taskTypeParams, limit]
  );
  const [[countRow]] = await pool.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${dateCol} BETWEEN ? AND ? ${tlClause} ${docClause} AND ${clientCond} ${taskTypeCond}`,
    [f.from, f.to, ...tlParams, ...docParams, ...clientParams, ...taskTypeParams]
  );
  return { rows: rows as ClientDocRecordRow[], total: Number(countRow.n) };
}

// ── POA External Dashboard (item #7 of the 2026-09-12 feedback: "I have
// shared the POA External Dashboard format kindly update the same. (Required
// New Format)") — a standalone table, onfido_poa_external_raw, real headers
// read from the owner's attachment. Genuinely new: no prior dashboard covered
// this data (the existing External Quality dashboard is DOC-only). Drill-down
// uses the generic /records/:table route (single table, no UNION needed) —
// ONFIDO_POA_EXTERNAL_RAW is a real upload-type-code registered in
// ONFIDO_REPORT_CONFIGS, so resolveTable/listRecords/getRecord already work
// for it with no extra wiring.

const poaExt = "onfido_poa_external_raw";

export interface PoaExternalOverview {
  taskCount: KpiValue;
  avgAht: KpiValue;
  errorRate: KpiValue;
  distinctClients: KpiValue;
}

export async function getPoaExternalOverview(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<PoaExternalOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const agg = await scalar<RowDataPacket & { n: number; aht: number | null; errors: number; clients: number }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht,
            COALESCE(SUM(error_flag),0) AS errors, COUNT(DISTINCT ims_client_name) AS clients
       FROM ${poaExt} WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const n = Number(agg.n ?? 0);
  const errors = Number(agg.errors ?? 0);
  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  return {
    taskCount: kpi("poa_ext_volume", "POA External Reports", n, "count"),
    avgAht: kpi("poa_ext_aht", "Avg Handling Time", agg.aht !== null ? Math.round(agg.aht) : null, "seconds"),
    errorRate: kpi("poa_ext_error_rate", "Error Rate", n > 0 ? Math.round((errors / n) * 1000) / 10 : null, "percent",
      n > 0 ? `${errors} error(s) of ${n}` : undefined),
    distinctClients: kpi("poa_ext_clients", "Distinct Clients", Number(agg.clients ?? 0), "count"),
  };
}

export interface PoaExternalTrendPoint { bucket: string; taskCount: number; errorCount: number }

export async function getPoaExternalTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<PoaExternalTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const expr = bucketExpr("report_completed_date", granularity);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n, COALESCE(SUM(error_flag),0) AS errors
       FROM ${poaExt} WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  return rows
    .map((r) => ({ bucket: bucketLabel(r.bucket, granularity), taskCount: Number(r.n), errorCount: Number(r.errors) }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export type PoaExternalDimension = "ims_client_name" | "tl_name" | "am_name" | "location";

export interface PoaExternalBreakdownRow { label: string; taskCount: number; avgAht: number | null; errorRate: number | null }

export async function getPoaExternalBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, dimension: PoaExternalDimension
): Promise<PoaExternalBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label,
            COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht, COALESCE(SUM(error_flag),0) AS errors
       FROM ${poaExt} WHERE report_completed_date BETWEEN ? AND ? ${clause}
       GROUP BY label ORDER BY n DESC LIMIT 50`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => {
    const n = Number(r.n);
    return {
      label: r.label,
      taskCount: n,
      avgAht: r.aht !== null ? Math.round(Number(r.aht)) : null,
      errorRate: n > 0 ? Math.round((Number(r.errors) / n) * 1000) / 10 : null,
    };
  });
}

// ── GD MCN SLA APS (item #8 of the 2026-09-12 feedback: "GD MCN SLA APS Day
// and slot wise performance. (Required New Format)") ───────────────────────
//
// A genuinely different shape from every other table in this file: not a
// per-task record, an hourly staffing/SLA fact table (onfido_gd_mcn_sla_raw)
// — 24 hourly slot rows per day plus one "Total" daily-summary row (real
// column values, not an average computed here) tagged by gmt_slot = 'Total'.
// Day-level KPIs/trend read the file's own Total rows rather than
// re-averaging the 24 hourly rows, since the file's daily total is not
// necessarily a naive mean (Commitment/FTE Delivered are summed across the
// day, not averaged, per the raw data). Slot-wise breakdown (the "slot wise
// performance" the client explicitly asked for) reads only the real hourly
// rows, excluding the Total row.

const gdMcnSla = "onfido_gd_mcn_sla_raw";

export interface GdMcnSlaOverview {
  avgSlaPct: KpiValue;
  avgGdPct: KpiValue;
  avgMcnPct: KpiValue;
  avgOccupancyPct: KpiValue;
  avgAvailPct: KpiValue;
}

/** Percent columns are stored as the file's own ratio (e.g. 0.964 = 96.4%) —
 *  multiplied by 100 and rounded to 1dp for display, same convention as
 *  every other percent KPI in this file. */
function pctToDisplay(v: number | null): number | null {
  return v === null ? null : Math.round(v * 1000) / 10;
}

export async function getGdMcnSlaOverview(
  rawFilters: { from?: string; to?: string }
): Promise<GdMcnSlaOverview> {
  const f = readFilters(rawFilters);
  await ensureOnfidoTableColumns(gdMcnSla);
  const agg = await scalar<RowDataPacket & {
    sla: number | null; gd: number | null; mcn: number | null; occ: number | null; avail: number | null;
  }>(
    `SELECT AVG(sla_pct) AS sla, AVG(gd_pct) AS gd, AVG(mcn_pct) AS mcn,
            AVG(occupancy_pct) AS occ, AVG(avail_pct) AS avail
       FROM ${gdMcnSla} WHERE slot_date BETWEEN ? AND ? AND gmt_slot = 'Total'`,
    [f.from, f.to]
  );
  const kpi = (key: string, label: string, value: number | null): KpiValue => ({
    key, label, value, unit: "percent", availability: value === null ? "no_data" : "ok",
  });
  return {
    avgSlaPct: kpi("gd_mcn_sla", "Avg SLA %", pctToDisplay(agg.sla)),
    avgGdPct: kpi("gd_mcn_gd", "Avg GD %", pctToDisplay(agg.gd)),
    avgMcnPct: kpi("gd_mcn_mcn", "Avg MCN %", pctToDisplay(agg.mcn)),
    avgOccupancyPct: kpi("gd_mcn_occ", "Avg Occupancy %", pctToDisplay(agg.occ)),
    avgAvailPct: kpi("gd_mcn_avail", "Avg Availability %", pctToDisplay(agg.avail)),
  };
}

export interface GdMcnSlaTrendPoint {
  bucket: string; slaPct: number | null; gdPct: number | null; mcnPct: number | null;
  commitment: number | null; fteDelivered: number | null;
  docAht: number | null; poaAht: number | null;
}

/** Day-wise trend by default (unchanged callers keep their existing daily chart) —
 *  granularity is optional so the Overview page's new "Month-wise GD & MCN Trend"
 *  card can request monthly buckets from the same endpoint instead of a second one. */
export async function getGdMcnSlaTrend(
  rawFilters: { from?: string; to?: string }, granularity: TrendGranularity = "daily"
): Promise<GdMcnSlaTrendPoint[]> {
  const f = readFilters(rawFilters);
  await ensureOnfidoTableColumns(gdMcnSla);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("slot_date", granularity)} AS bucket, AVG(sla_pct) AS sla_pct, AVG(gd_pct) AS gd_pct,
            AVG(mcn_pct) AS mcn_pct, SUM(commitment) AS commitment, SUM(fte_delivered) AS fte_delivered,
            AVG(doc_aht) AS doc_aht, AVG(poa_aht) AS poa_aht
       FROM ${gdMcnSla} WHERE slot_date BETWEEN ? AND ? AND gmt_slot = 'Total' GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to]
  );
  return rows.map((r) => ({
    bucket: bucketLabel(r.bucket, granularity),
    slaPct: pctToDisplay(r.sla_pct !== null ? Number(r.sla_pct) : null),
    gdPct: pctToDisplay(r.gd_pct !== null ? Number(r.gd_pct) : null),
    mcnPct: pctToDisplay(r.mcn_pct !== null ? Number(r.mcn_pct) : null),
    commitment: r.commitment !== null ? Math.round(Number(r.commitment) * 10) / 10 : null,
    fteDelivered: r.fte_delivered !== null ? Math.round(Number(r.fte_delivered) * 10) / 10 : null,
    docAht: r.doc_aht !== null ? Math.round(Number(r.doc_aht) * 100) / 100 : null,
    poaAht: r.poa_aht !== null ? Math.round(Number(r.poa_aht) * 100) / 100 : null,
  }));
}

export interface GdMcnSlaSlotRow {
  slot: string; slaPct: number | null; gdPct: number | null; mcnPct: number | null; occupancyPct: number | null;
}

/** The client's own ask: slot-wise (hour-of-day) performance, averaged across
 *  every day in range — which hours are weakest, not which day. Excludes the
 *  daily Total row (gmt_slot = 'Total' is not a real hour). */
export async function getGdMcnSlaSlotBreakdown(
  rawFilters: { from?: string; to?: string }
): Promise<GdMcnSlaSlotRow[]> {
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT gmt_slot, AVG(sla_pct) AS sla, AVG(gd_pct) AS gd, AVG(mcn_pct) AS mcn, AVG(occupancy_pct) AS occ
       FROM ${gdMcnSla} WHERE slot_date BETWEEN ? AND ? AND gmt_slot <> 'Total'
       GROUP BY gmt_slot ORDER BY MIN(source_row_no)`,
    [f.from, f.to]
  );
  return rows.map((r) => ({
    slot: r.gmt_slot,
    slaPct: pctToDisplay(r.sla !== null ? Number(r.sla) : null),
    gdPct: pctToDisplay(r.gd !== null ? Number(r.gd) : null),
    mcnPct: pctToDisplay(r.mcn !== null ? Number(r.mcn) : null),
    occupancyPct: pctToDisplay(r.occ !== null ? Number(r.occ) : null),
  }));
}

export interface GdMcnSlaDetailRow {
  date: string; gmt: string; ist: string;
  gdPct: number | null; mcnPct: number | null; deficit: number | null; slaPct: number | null;
  docAht: number | null; poaAht: number | null; commitment: number | null; fteDelivered: number | null;
  apsPct: number | null; occupancyPct: number | null; availPct: number | null;
  isTotal: boolean;
}

/** The full "GD / MCN / SLA / APS Performance" table exactly as the client's sheet lays
 *  it out: one row per day x hourly slot, followed by that day's own Total row, in the
 *  file's own order. Ratios (GD%, SLA%, ...) are returned as stored — the UI formats
 *  them to the sheet's own precision per column. */
export async function getGdMcnSlaDetail(
  rawFilters: { from?: string; to?: string }
): Promise<GdMcnSlaDetailRow[]> {
  const f = readFilters(rawFilters);
  await ensureOnfidoTableColumns(gdMcnSla);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT slot_date, gmt_slot, ist_slot, gd_pct, mcn_pct, deficit, sla_pct, doc_aht, poa_aht,
            commitment, fte_delivered, aps_pct, occupancy_pct, avail_pct
       FROM ${gdMcnSla} WHERE slot_date BETWEEN ? AND ?
      ORDER BY slot_date, source_row_no LIMIT 5000`,
    [f.from, f.to]
  );
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r): GdMcnSlaDetailRow => ({
    date: dateBucketToIso(r.slot_date),
    gmt: String(r.gmt_slot ?? ""),
    ist: String(r.ist_slot ?? ""),
    gdPct: num(r.gd_pct), mcnPct: num(r.mcn_pct), deficit: num(r.deficit), slaPct: num(r.sla_pct),
    docAht: num(r.doc_aht), poaAht: num(r.poa_aht), commitment: num(r.commitment), fteDelivered: num(r.fte_delivered),
    apsPct: num(r.aps_pct), occupancyPct: num(r.occupancy_pct), availPct: num(r.avail_pct),
    isTotal: String(r.gmt_slot ?? "").trim().toLowerCase() === "total",
  }));
}

// ── DOC Raw (per-task volume/AHT, onfido_doc_raw) ───────────────────────────
//
// Distinct from onfido_doc_external_audit_raw (which only ever carries
// *audited* tasks) — this is every processed DOC task, audited or not, so it
// is the real source for total volume/AHT/escalation-rate, the same way the
// old dashboard's own "DOC Raw" sheet was.

export interface DocRawOverview {
  taskCount: KpiValue; avgAht: KpiValue; avgQueueTime: KpiValue; escalationRate: KpiValue;
}

export async function getDocRawOverview(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<DocRawOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const agg = await scalar<RowDataPacket & { n: number; aht: number | null; queue: number | null; esc: number }>(
    `SELECT COUNT(*) AS n, ${DOC_AHT_AVG} AS aht, AVG(queue_time_secs) AS queue, SUM(is_escalated) AS esc
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  const total = Number(agg.n ?? 0);
  return {
    taskCount: kpi("doc_raw_task_count", "DOC Tasks (Raw)", total, "count"),
    avgAht: kpi("doc_raw_aht", "DOC Avg Handling Time", agg.aht !== null ? Math.round(Number(agg.aht)) : null, "seconds"),
    avgQueueTime: kpi("doc_raw_queue", "DOC Avg Queue Time", agg.queue !== null ? Math.round(Number(agg.queue)) : null, "seconds"),
    escalationRate: kpi("doc_raw_escalation_rate", "DOC Escalation Rate", rate1(Number(agg.esc ?? 0), total), "percent", `${agg.esc ?? 0} of ${total}`),
  };
}

export interface DocRawTrendPoint { bucket: string; taskCount: number; avgAht: number | null }

export async function getDocRawTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<DocRawTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_date", granularity)} AS bucket, COUNT(*) AS n, ${DOC_AHT_AVG} AS aht
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => ({
    bucket: bucketLabel(r.bucket, granularity), taskCount: Number(r.n),
    avgAht: r.aht !== null ? Math.round(Number(r.aht)) : null,
  }));
}

export type DocRawDimension = "ims_client_name" | "tl_name" | "am_name" | "task_type";
export interface DocRawBreakdownRow { label: string; taskCount: number; avgAht: number | null; escalationRate: number | null }

// "Task Type Short Name" isn't pulled into its own column (see onfido-report-configs.ts —
// only a handful of DOC_RAW_HEADERS are extracted) — it lives in the raw_data JSON blob,
// so this one dimension reads it via JSON_EXTRACT instead of a bare column name. Added for
// the 2026-09-17 dashboard feedback: the blended "DOC Avg Handling Time" KPI silently mixes
// standard review tasks (~110-120s) with the Labelling_Raw-Ext sub-process (~300s) — this
// breakdown is what makes that visible instead of hiding it in one misleading average.
const DOC_RAW_DIMENSION_EXPR: Record<DocRawDimension, string> = {
  ims_client_name: "ims_client_name",
  tl_name: "tl_name",
  am_name: "am_name",
  task_type: DOC_TASK_TYPE_LABEL_EXPR,
};

export async function getDocRawBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, dimension: DocRawDimension
): Promise<DocRawBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const expr = DOC_RAW_DIMENSION_EXPR[dimension];
  const unassignedLabel = dimension === "task_type" ? "Standard Review (untagged)" : "(unassigned)";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${expr}), ''), ?) AS label,
            COUNT(*) AS total, ${dimension === "task_type" ? "AVG(manual_processing_time_secs)" : DOC_AHT_AVG} AS aht, SUM(is_escalated) AS esc
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? ${clause}
       GROUP BY label ORDER BY total DESC LIMIT 50`,
    [unassignedLabel, f.from, f.to, ...params]
  );
  return rows.map((r): DocRawBreakdownRow => {
    const total = Number(r.total ?? 0);
    return {
      label: r.label, taskCount: total,
      avgAht: r.aht !== null ? Math.round(Number(r.aht)) : null,
      escalationRate: rate1(Number(r.esc ?? 0), total),
    };
  });
}

export interface DocTaskTypeTrendPoint {
  bucket: string;
  byTaskType: Record<string, { taskCount: number; avgAht: number | null }>;
}

/** Task-type-wise monthly Task/AHT trend for the Overview page (2026-09-17
 *  feedback items #2/#3) — one query, pivoted by bucket so the frontend can
 *  read either metric per task type across the same set of buckets. */
export async function getDocTaskTypeTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<DocTaskTypeTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const bucket = bucketExpr("report_date", granularity);
  const taskTypeExpr = DOC_RAW_DIMENSION_EXPR.task_type;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucket} AS bucket,
            COALESCE(NULLIF(TRIM(${taskTypeExpr}), ''), 'Standard Review (untagged)') AS taskType,
            COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? ${clause}
       GROUP BY bucket, taskType ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  const byBucket = new Map<string, Record<string, { taskCount: number; avgAht: number | null }>>();
  for (const r of rows) {
    const key = bucketLabel(r.bucket, granularity);
    const entry = byBucket.get(key) ?? {};
    entry[String(r.taskType)] = {
      taskCount: Number(r.n),
      avgAht: r.aht !== null ? Math.round(Number(r.aht)) : null,
    };
    byBucket.set(key, entry);
  }
  return [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, byTaskType]) => ({ bucket, byTaskType }));
}

// ── POA (onfido_poa_raw + onfido_poa_trial_raw for volume/AHT, ─────────────
//        onfido_poa_quality_raw for error rates) ────────────────────────────
//
// Same per-table-aggregate-then-combine approach as getOverview: POA Raw and
// POA Trial are two file formats for the same real per-report volume/TaT
// (Trial is the client's earlier/thinner export and carries no AHT column of
// its own), and POA Quality is a separate internal-QC export keyed by the
// same TL/AM labels but with no row-level link to the volume tables — so
// breakdown rows are merged by label in application code, not a SQL JOIN.

export interface PoaOverview {
  taskCount: KpiValue; avgAht: KpiValue; errorRate: KpiValue;
  classificationErrorRate: KpiValue; extractionErrorRate: KpiValue; dataComparisonErrorRate: KpiValue;
}

export async function getPoaOverview(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<PoaOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const raw = await scalar<RowDataPacket & { n: number; aht: number | null }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const trial = await scalar<RowDataPacket & { n: number; aht: number | null }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM ${POA_TRIAL_MERGE_SOURCE} WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const poaAhtWeightedSum = (raw.aht !== null ? raw.aht * raw.n : 0) + (trial.aht !== null ? trial.aht * trial.n : 0);
  const poaAhtWeightedCount = (raw.aht !== null ? raw.n : 0) + (trial.aht !== null ? trial.n : 0);
  const poaCombinedAht = poaAhtWeightedCount > 0 ? poaAhtWeightedSum / poaAhtWeightedCount : null;
  const quality = await scalar<RowDataPacket & {
    errN: number; noErrN: number; totalQc: number; classN: number; extN: number; dcN: number;
  }>(
    `SELECT SUM(error_count) AS errN, SUM(no_error_count) AS noErrN, SUM(total_qc) AS totalQc,
            SUM(classification_error) AS classN, SUM(extraction_error) AS extN, SUM(data_comparison_error) AS dcN
       FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  const taskTotal = Number(raw.n ?? 0) + Number(trial.n ?? 0);
  const errDenom = Number(quality.errN ?? 0) + Number(quality.noErrN ?? 0);
  const totalQc = Number(quality.totalQc ?? 0);
  return {
    taskCount: kpi("poa_raw_task_count", "POA Reports Processed", taskTotal, "count",
      Number(trial.n ?? 0) > 0 ? `includes ${trial.n} trial-queue report(s)` : undefined),
    avgAht: kpi("poa_raw_aht", "POA Avg Handling Time", poaCombinedAht !== null ? Math.round(poaCombinedAht) : null, "seconds"),
    errorRate: kpi("poa_raw_error_rate", "POA Audit Error Rate", rate1(Number(quality.errN ?? 0), errDenom), "percent",
      errDenom > 0 ? `${quality.errN} error(s) across ${errDenom} audit(s)` : "no POA audits in range"),
    classificationErrorRate: kpi("poa_raw_class_err", "POA Classification Error Rate", rate1(Number(quality.classN ?? 0), totalQc), "percent",
      totalQc > 0 ? `${quality.classN} of ${totalQc} QC(s)` : undefined),
    extractionErrorRate: kpi("poa_raw_ext_err", "POA Extraction Error Rate", rate1(Number(quality.extN ?? 0), totalQc), "percent",
      totalQc > 0 ? `${quality.extN} of ${totalQc} QC(s)` : undefined),
    dataComparisonErrorRate: kpi("poa_raw_dc_err", "POA Data Comparison Error Rate", rate1(Number(quality.dcN ?? 0), totalQc), "percent",
      totalQc > 0 ? `${quality.dcN} of ${totalQc} QC(s)` : undefined),
  };
}

/** POA's own error-rate trend (errN/(errN+noErrN) per bucket, same formula as
 *  getPoaOverview's errorRate) — the Trends page's "POA Err%" chart
 *  (2026-09-17 feedback), which the reference dashboard's rTrend() renders as
 *  its 5th trend line from a plain POA_Error_Pct field. */
export async function getPoaQualityTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<QualityGranularTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_completed_date", granularity)} AS bucket,
            COALESCE(SUM(error_count),0) AS errN, COALESCE(SUM(no_error_count),0) AS noErrN
       FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => {
    const total = Number(r.errN ?? 0) + Number(r.noErrN ?? 0);
    return { bucket: bucketLabel(r.bucket, granularity), taskCount: total, errorRate: rate1(Number(r.errN ?? 0), total) };
  });
}

export interface PoaTrendPoint { bucket: string; taskCount: number }

/** Volume trend (POA Raw + POA Trial combined count) — count only, same
 *  reasoning as every other trend in this file: AHT/error-rate belong in the
 *  overview tiles and breakdown table, not blended into one bucketed line. */
export async function getPoaTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<PoaTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const expr = bucketExpr("report_completed_date", granularity);
  const [rawRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM onfido_poa_raw
      WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  const [trialRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM ${POA_TRIAL_MERGE_SOURCE}
      WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  const byBucket = new Map<string, number>();
  for (const r of rawRows) byBucket.set(bucketLabel(r.bucket, granularity), Number(r.n));
  for (const r of trialRows) {
    const key = bucketLabel(r.bucket, granularity);
    byBucket.set(key, (byBucket.get(key) ?? 0) + Number(r.n));
  }
  return [...byBucket.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, taskCount]) => ({ bucket, taskCount }));
}

export type PoaDimension = "tl_name" | "am_name";
export interface PoaBreakdownRow { label: string; taskCount: number; avgAht: number | null; errorRate: number | null }

export async function getPoaBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, dimension: PoaDimension
): Promise<PoaBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const label = `COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)')`;

  const [rawRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${label} AS label, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY label`,
    [f.from, f.to, ...params]
  );
  const [trialRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${label} AS label, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht FROM ${POA_TRIAL_MERGE_SOURCE}
      WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY label`,
    [f.from, f.to, ...params]
  );
  const [qualityRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${label} AS label, SUM(error_count) AS errN, SUM(no_error_count) AS noErrN
       FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY label`,
    [f.from, f.to, ...params]
  );

  const byLabel = new Map<string, { taskCount: number; ahtSum: number; ahtN: number; errN: number; errDenom: number }>();
  const get = (l: string) => {
    if (!byLabel.has(l)) byLabel.set(l, { taskCount: 0, ahtSum: 0, ahtN: 0, errN: 0, errDenom: 0 });
    return byLabel.get(l)!;
  };
  for (const r of rawRows) {
    const e = get(r.label);
    e.taskCount += Number(r.n);
    if (r.aht !== null) { e.ahtSum += Number(r.aht) * Number(r.n); e.ahtN += Number(r.n); }
  }
  for (const r of trialRows) {
    const e = get(r.label);
    e.taskCount += Number(r.n);
    if (r.aht !== null) { e.ahtSum += Number(r.aht) * Number(r.n); e.ahtN += Number(r.n); }
  }
  for (const r of qualityRows) {
    const e = get(r.label);
    e.errN += Number(r.errN ?? 0);
    e.errDenom += Number(r.errN ?? 0) + Number(r.noErrN ?? 0);
  }

  return [...byLabel.entries()]
    // A label present only in the quality file (an error rate but zero real
    // volume rows for this range) isn't a real "task breakdown" row — drop it
    // rather than show a confusing 0-task line with a defined error rate.
    .filter(([, e]) => e.taskCount > 0)
    .map(([l, e]): PoaBreakdownRow => ({
      label: l, taskCount: e.taskCount,
      avgAht: e.ahtN > 0 ? Math.round(e.ahtSum / e.ahtN) : null,
      errorRate: rate1(e.errN, e.errDenom),
    }))
    .sort((a, b) => b.taskCount - a.taskCount)
    .slice(0, 50);
}

export type PoaEntityDimension = "tl_name" | "am_name" | "analyst_email";
export interface PoaEntityMonthCell { taskCount: number; avgAht: number | null; poaErrPct: number | null; extPoaErrPct: number | null }
export interface PoaEntityMonthRow { entity: string; byMonth: Record<string, PoaEntityMonthCell> }

/** Entity x month pivot (AM/TL/Analyst Wise POA tables, 2026-09-17 feedback) —
 *  Task+AHT from POA raw+trial, POA Err% from POA quality, Ext POA% from POA
 *  External, merged in application code the same way getClientDocTrend and
 *  getPoaCombinedTrend merge two file formats for one real metric. TL Wise
 *  drops entities with zero POA task (reference dashboard's own rule); Analyst
 *  Wise caps at the top 50 by volume (also the reference's own rule). */
export async function getPoaEntityMonthlyGrid(
  rawFilters: { from?: string; to?: string }, dimension: PoaEntityDimension
): Promise<{ months: string[]; rows: PoaEntityMonthRow[] }> {
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();
  const monthExpr = bucketExpr("report_completed_date", "monthly");
  const entityFilter = `${dimension} IS NOT NULL AND TRIM(${dimension}) <> ''`;

  const [rawRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dimension} AS entity, ${monthExpr} AS month, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? AND ${entityFilter} GROUP BY entity, month`,
    [f.from, f.to]
  );
  const [trialRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dimension} AS entity, ${monthExpr} AS month, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM ${POA_TRIAL_MERGE_SOURCE} WHERE report_completed_date BETWEEN ? AND ? AND ${entityFilter} GROUP BY entity, month`,
    [f.from, f.to]
  );
  const [qualityRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dimension} AS entity, ${monthExpr} AS month,
            COALESCE(SUM(error_count),0) AS errN, COALESCE(SUM(no_error_count),0) AS noErrN
       FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? AND ${entityFilter} GROUP BY entity, month`,
    [f.from, f.to]
  );
  const [extRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dimension} AS entity, ${monthExpr} AS month, COUNT(*) AS n, COALESCE(SUM(error_flag),0) AS errors
       FROM onfido_poa_external_raw WHERE report_completed_date BETWEEN ? AND ? AND ${entityFilter} GROUP BY entity, month`,
    [f.from, f.to]
  );

  type Acc = { taskN: number; ahtSum: number; errN: number; noErrN: number; extN: number; extErr: number };
  const grid = new Map<string, Map<string, Acc>>();
  const monthsSet = new Set<string>();
  function cell(entity: string, month: string): Acc {
    monthsSet.add(month);
    let byMonth = grid.get(entity);
    if (!byMonth) { byMonth = new Map(); grid.set(entity, byMonth); }
    let c = byMonth.get(month);
    if (!c) { c = { taskN: 0, ahtSum: 0, errN: 0, noErrN: 0, extN: 0, extErr: 0 }; byMonth.set(month, c); }
    return c;
  }
  for (const r of [...rawRows, ...trialRows]) {
    const month = bucketLabel(r.month, "monthly");
    const c = cell(String(r.entity).trim(), month);
    const n = Number(r.n ?? 0);
    const aht = r.aht !== null ? Number(r.aht) : null;
    c.taskN += n;
    c.ahtSum += aht !== null ? aht * n : 0;
  }
  for (const r of qualityRows) {
    const month = bucketLabel(r.month, "monthly");
    const c = cell(String(r.entity).trim(), month);
    c.errN += Number(r.errN ?? 0);
    c.noErrN += Number(r.noErrN ?? 0);
  }
  for (const r of extRows) {
    const month = bucketLabel(r.month, "monthly");
    const c = cell(String(r.entity).trim(), month);
    c.extN += Number(r.n ?? 0);
    c.extErr += Number(r.errors ?? 0);
  }

  const months = [...monthsSet].sort();
  let rows: PoaEntityMonthRow[] = [...grid.entries()].map(([entity, byMonth]) => {
    const cells: Record<string, PoaEntityMonthCell> = {};
    for (const [month, c] of byMonth) {
      cells[month] = {
        taskCount: c.taskN,
        avgAht: c.taskN > 0 ? Math.round(c.ahtSum / c.taskN) : null,
        poaErrPct: rate1(c.errN, c.errN + c.noErrN),
        extPoaErrPct: rate1(c.extErr, c.extN),
      };
    }
    return { entity, byMonth: cells };
  });

  const totalTask = (r: PoaEntityMonthRow) => Object.values(r.byMonth).reduce((s, c) => s + c.taskCount, 0);
  if (dimension === "tl_name") rows = rows.filter((r) => totalTask(r) > 0);
  rows.sort((a, b) => totalTask(b) - totalTask(a));
  if (dimension === "analyst_email") rows = rows.slice(0, 50);

  return { months, rows };
}

export interface PoaDayRow {
  date: string; taskCount: number; avgAht: number | null;
  poaAudits: number; poaErrors: number; poaErrPct: number | null;
  extPoaAudits: number; extPoaErrors: number; extPoaErrPct: number | null;
}

/** Day-wise POA detail table (9 columns, 2026-09-17 feedback) — same four-table
 *  merge as getPoaEntityMonthlyGrid, grouped by calendar day instead of entity. */
export async function getPoaDayWiseDetail(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<PoaDayRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const dayExpr = bucketExpr("report_completed_date", "daily");

  const [rawRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dayExpr} AS day, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY day`,
    [f.from, f.to, ...params]
  );
  const [trialRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dayExpr} AS day, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM ${POA_TRIAL_MERGE_SOURCE} WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY day`,
    [f.from, f.to, ...params]
  );
  const [qualityRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dayExpr} AS day, COALESCE(SUM(error_count),0) AS errN, COALESCE(SUM(no_error_count),0) AS noErrN
       FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY day`,
    [f.from, f.to, ...params]
  );
  const [extRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dayExpr} AS day, COUNT(*) AS n, COALESCE(SUM(error_flag),0) AS errors
       FROM onfido_poa_external_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY day`,
    [f.from, f.to, ...params]
  );

  type Acc = { taskN: number; ahtSum: number; errN: number; noErrN: number; extN: number; extErr: number };
  const byDay = new Map<string, Acc>();
  function cell(day: string): Acc {
    let c = byDay.get(day);
    if (!c) { c = { taskN: 0, ahtSum: 0, errN: 0, noErrN: 0, extN: 0, extErr: 0 }; byDay.set(day, c); }
    return c;
  }
  for (const r of [...rawRows, ...trialRows]) {
    const day = bucketLabel(r.day, "daily");
    const c = cell(day);
    const n = Number(r.n ?? 0);
    const aht = r.aht !== null ? Number(r.aht) : null;
    c.taskN += n;
    c.ahtSum += aht !== null ? aht * n : 0;
  }
  for (const r of qualityRows) {
    const day = bucketLabel(r.day, "daily");
    const c = cell(day);
    c.errN += Number(r.errN ?? 0);
    c.noErrN += Number(r.noErrN ?? 0);
  }
  for (const r of extRows) {
    const day = bucketLabel(r.day, "daily");
    const c = cell(day);
    c.extN += Number(r.n ?? 0);
    c.extErr += Number(r.errors ?? 0);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, c]) => ({
      date,
      taskCount: c.taskN,
      avgAht: c.taskN > 0 ? Math.round(c.ahtSum / c.taskN) : null,
      poaAudits: c.errN + c.noErrN,
      poaErrors: c.errN,
      poaErrPct: rate1(c.errN, c.errN + c.noErrN),
      extPoaAudits: c.extN,
      extPoaErrors: c.extErr,
      extPoaErrPct: rate1(c.extErr, c.extN),
    }));
}

// ── POA Trial (onfido_poa_trial_raw, standalone) ────────────────────────────
//
// Unlike the POA tab above (which always combines onfido_poa_raw +
// onfido_poa_trial_raw), this tab is scoped to the trial table alone — the
// client asked for POA Trial to have its own dashboard, not just a silent
// volume add-on inside POA. There is no onfido_poa_trial_quality_raw table
// (no separate error/no-error columns), so "Consider Rate" (from this
// table's own overall_result column: Consider vs Clear) is the quality
// signal here instead of POA's Error Rate/FAR/FRR breakdown.

export interface PoaTrialOverview {
  taskCount: KpiValue; avgAht: KpiValue; considerRate: KpiValue;
}

export async function getPoaTrialOverview(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<PoaTrialOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const agg = await scalar<RowDataPacket & { n: number; aht: number | null; considerN: number }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht,
            SUM(CASE WHEN overall_result = 'Consider' THEN 1 ELSE 0 END) AS considerN
       FROM onfido_poa_trial_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  const n = Number(agg.n ?? 0);
  const considerN = Number(agg.considerN ?? 0);
  return {
    taskCount: kpi("poa_trial_task_count", "POA Trial Reports Processed", n, "count"),
    avgAht: kpi("poa_trial_aht", "POA Trial Avg Handling Time", agg.aht !== null ? Math.round(Number(agg.aht)) : null, "seconds"),
    considerRate: kpi("poa_trial_consider_rate", "POA Trial Consider Rate", rate1(considerN, n), "percent",
      n > 0 ? `${considerN} Consider vs ${n - considerN} Clear` : "no POA Trial reports in range"),
  };
}

export interface PoaTrialTrendPoint { bucket: string; taskCount: number }

export async function getPoaTrialTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<PoaTrialTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const expr = bucketExpr("report_completed_date", granularity);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM onfido_poa_trial_raw
      WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  return rows
    .map((r) => ({ bucket: bucketLabel(r.bucket, granularity), taskCount: Number(r.n) }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export interface PoaCombinedTrendPoint { bucket: string; taskCount: number; avgAht: number | null }

/** POA raw + trial combined, volume-weighted AHT per bucket — the trend-chart
 *  equivalent of getOverview's poaCombinedAht (same two file formats for the
 *  same real queue, so a report from either table counts equally, not each
 *  table's average counting equally regardless of volume). Powers the
 *  Overview page's "Month-wise POA Performance Task & AHT process" card. */
export async function getPoaCombinedTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, granularity: TrendGranularity
): Promise<PoaCombinedTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const expr = bucketExpr("report_completed_date", granularity);
  const [rawRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  const [trialRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM ${POA_TRIAL_MERGE_SOURCE} WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  const byBucket = new Map<string, { n: number; sum: number }>();
  const add = (rows: RowDataPacket[]) => {
    for (const r of rows) {
      const key = bucketLabel(r.bucket, granularity);
      const n = Number(r.n ?? 0);
      const aht = r.aht !== null ? Number(r.aht) : null;
      const prev = byBucket.get(key) ?? { n: 0, sum: 0 };
      byBucket.set(key, { n: prev.n + n, sum: prev.sum + (aht !== null ? aht * n : 0) });
    }
  };
  add(rawRows);
  add(trialRows);
  return [...byBucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({ bucket, taskCount: v.n, avgAht: v.n > 0 ? Math.round(v.sum / v.n) : null }));
}

export type PoaTrialDimension = "tl_name" | "am_name";
export interface PoaTrialBreakdownRow { label: string; taskCount: number; avgAht: number | null; considerRate: number | null }

export async function getPoaTrialBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }, dimension: PoaTrialDimension
): Promise<PoaTrialBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();
  const label = `COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)')`;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${label} AS label, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht,
            SUM(CASE WHEN overall_result = 'Consider' THEN 1 ELSE 0 END) AS considerN
       FROM onfido_poa_trial_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY label`,
    [f.from, f.to, ...params]
  );
  return rows
    .map((r): PoaTrialBreakdownRow => ({
      label: r.label, taskCount: Number(r.n),
      avgAht: r.aht !== null ? Math.round(Number(r.aht)) : null,
      considerRate: rate1(Number(r.considerN ?? 0), Number(r.n)),
    }))
    .sort((a, b) => b.taskCount - a.taskCount)
    .slice(0, 50);
}

// ── Live / Today snapshot ────────────────────────────────────────────────────
//
// Unlike every other tab (which reads whatever date range Executive Filters
// picks), this one is deliberately always "today" / "this month" — it is not
// wired to the range picker at all, same as the reference dashboard's own
// Live Dashboard tab. Every source table here is a batch upload (see the
// module-level comment), so this legitimately shows zero until a same-day
// file is uploaded — that is an honest reading of "no data yet today", not a
// bug, and it starts showing real numbers the moment a current-day/current-
// month file lands.

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export interface LiveOverview {
  docLiveTaskCount: KpiValue; docLiveAht: KpiValue; docLiveAuditCount: KpiValue; docLiveErrorCount: KpiValue;
  poaLiveTaskCount: KpiValue; poaLiveAht: KpiValue;
}

export async function getLiveOverview(): Promise<LiveOverview> {
  const today = todayIso();
  const monthStart = monthStartIso();
  const doc = await scalar<RowDataPacket & { n: number; aht: number | null }>(
    `SELECT COUNT(*) AS n, ${DOC_AHT_AVG} AS aht FROM onfido_doc_raw WHERE report_date = ?`,
    [today]
  );
  const docAudit = await scalar<RowDataPacket & { n: number; errN: number }>(
    `SELECT COUNT(*) AS n, SUM(classification_flag) AS errN FROM onfido_doc_external_audit_raw WHERE report_date = ?`,
    [today]
  );
  const poa = await scalar<RowDataPacket & { n: number; aht: number | null }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht FROM onfido_poa_raw WHERE report_completed_date >= ?`,
    [monthStart]
  );
  const kpi = (key: string, label: string, value: number | null, unit: KpiValue["unit"], note?: string): KpiValue => ({
    key, label, value, unit, availability: value === null ? "no_data" : "ok", note,
  });
  return {
    docLiveTaskCount: kpi("live_doc_task", "DOC Live Task", Number(doc.n ?? 0), "count", "Today"),
    docLiveAht: kpi("live_doc_aht", "DOC Live AHT", doc.aht !== null ? Math.round(Number(doc.aht)) : null, "seconds", "Today"),
    docLiveAuditCount: kpi("live_doc_audit", "DOC Live Audit", Number(docAudit.n ?? 0), "count", "Today date only"),
    docLiveErrorCount: kpi("live_doc_error", "DOC Live Error", Number(docAudit.errN ?? 0), "count", "Classification error = YES, today"),
    poaLiveTaskCount: kpi("live_poa_task", "POA Live Task", Number(poa.n ?? 0), "count", "Current month"),
    poaLiveAht: kpi("live_poa_aht", "POA Live AHT", poa.aht !== null ? Math.round(Number(poa.aht)) : null, "seconds", "Current month"),
  };
}

export type LiveDimension = "tl_name" | "am_name";
export interface LiveBreakdownRow { label: string; taskCount: number; avgAht: number | null }

/** Today's DOC task/AHT by TL or AM — the reference dashboard's "Live Dashboard"
 *  bar charts. Always today; not range-filtered (see module comment above). */
export async function getLiveDocBreakdown(dimension: LiveDimension): Promise<LiveBreakdownRow[]> {
  const today = todayIso();
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label,
            COUNT(*) AS total, ${DOC_AHT_AVG} AS aht
       FROM onfido_doc_raw WHERE report_date = ?
       GROUP BY label ORDER BY total DESC LIMIT 20`,
    [today]
  );
  return rows.map((r): LiveBreakdownRow => ({
    label: r.label, taskCount: Number(r.total ?? 0),
    avgAht: r.aht !== null ? Math.round(Number(r.aht)) : null,
  }));
}

// ── POA SLA Metrics ───────────────────────────────────────────────────────────

export interface PoaSlaBucket { label: string; count: number; pct: number | null }
export interface PoaSlaMetrics {
  total: number;
  sla10: number; sla10Pct: number | null;
  sla20: number; sla20Pct: number | null;
  sla30: number; sla30Pct: number | null;
  gt30: number; gt30Pct: number | null;
  buckets: PoaSlaBucket[];
  dailyTrend: { date: string; total: number; sla10Pct: number | null; sla30Pct: number | null }[];
  weeklyTrend: { bucket: string; total: number; sla10Pct: number | null; sla30Pct: number | null }[];
  analystRows: { analyst: string; tlName: string | null; volume: number; sla10Pct: number | null; sla30Pct: number | null; avgAht: number | null }[];
}

export async function getPoaSlaMetrics(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<PoaSlaMetrics> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();

  const [agg] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN manual_processing_time_secs <= 300 THEN 1 ELSE 0 END) AS b05,
            SUM(CASE WHEN manual_processing_time_secs > 300 AND manual_processing_time_secs <= 600 THEN 1 ELSE 0 END) AS b10,
            SUM(CASE WHEN manual_processing_time_secs > 600 AND manual_processing_time_secs <= 1200 THEN 1 ELSE 0 END) AS b20,
            SUM(CASE WHEN manual_processing_time_secs > 1200 AND manual_processing_time_secs <= 1800 THEN 1 ELSE 0 END) AS b30,
            SUM(CASE WHEN manual_processing_time_secs > 1800 THEN 1 ELSE 0 END) AS bgt30,
            SUM(CASE WHEN manual_processing_time_secs <= 600 THEN 1 ELSE 0 END) AS sla10,
            SUM(CASE WHEN manual_processing_time_secs <= 1200 THEN 1 ELSE 0 END) AS sla20,
            SUM(CASE WHEN manual_processing_time_secs <= 1800 THEN 1 ELSE 0 END) AS sla30
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}
        AND manual_processing_time_secs IS NOT NULL`,
    [f.from, f.to, ...params]
  );
  const row = agg[0] ?? {};
  const total = Number(row.total ?? 0);
  const pct = (n: number): number | null => total > 0 ? Math.round((n / total) * 1000) / 10 : null;
  const sla10 = Number(row.sla10 ?? 0);
  const sla20 = Number(row.sla20 ?? 0);
  const sla30 = Number(row.sla30 ?? 0);
  const gt30 = Number(row.bgt30 ?? 0);
  const buckets: PoaSlaBucket[] = [
    { label: "0 to 5 Min", count: Number(row.b05 ?? 0), pct: pct(Number(row.b05 ?? 0)) },
    { label: "5 to 10 Min", count: Number(row.b10 ?? 0), pct: pct(Number(row.b10 ?? 0)) },
    { label: "11 to 20 Min", count: Number(row.b20 ?? 0), pct: pct(Number(row.b20 ?? 0)) },
    { label: "21 to 30 Min", count: Number(row.b30 ?? 0), pct: pct(Number(row.b30 ?? 0)) },
    { label: "> 30 Min", count: gt30, pct: pct(gt30) },
  ];

  const slaRow = (n: number, vol: number): number | null => vol > 0 ? Math.round((n / vol) * 1000) / 10 : null;

  const [dailyRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE(report_completed_date) AS date, COUNT(*) AS total,
            SUM(CASE WHEN manual_processing_time_secs <= 600 THEN 1 ELSE 0 END) AS sla10,
            SUM(CASE WHEN manual_processing_time_secs <= 1800 THEN 1 ELSE 0 END) AS sla30
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}
        AND manual_processing_time_secs IS NOT NULL
       GROUP BY date ORDER BY date`,
    [f.from, f.to, ...params]
  );
  const [weeklyRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_completed_date", "weekly")} AS bucket, COUNT(*) AS total,
            SUM(CASE WHEN manual_processing_time_secs <= 600 THEN 1 ELSE 0 END) AS sla10,
            SUM(CASE WHEN manual_processing_time_secs <= 1800 THEN 1 ELSE 0 END) AS sla30
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}
        AND manual_processing_time_secs IS NOT NULL
       GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  const [analystRows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email AS analyst,
            COALESCE(NULLIF(TRIM(tl_name),''),'(unassigned)') AS tl_name,
            COUNT(*) AS volume,
            SUM(CASE WHEN manual_processing_time_secs <= 600 THEN 1 ELSE 0 END) AS sla10,
            SUM(CASE WHEN manual_processing_time_secs <= 1800 THEN 1 ELSE 0 END) AS sla30,
            AVG(manual_processing_time_secs) AS avgAht
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}
        AND manual_processing_time_secs IS NOT NULL AND analyst_email IS NOT NULL AND analyst_email <> ''
       GROUP BY analyst, tl_name ORDER BY volume DESC LIMIT 100`,
    [f.from, f.to, ...params]
  );
  return {
    total, sla10, sla10Pct: pct(sla10), sla20, sla20Pct: pct(sla20), sla30, sla30Pct: pct(sla30),
    gt30, gt30Pct: pct(gt30), buckets,
    dailyTrend: dailyRows.map((r) => ({
      date: String(r.date).split("T")[0],
      total: Number(r.total),
      sla10Pct: slaRow(Number(r.sla10), Number(r.total)),
      sla30Pct: slaRow(Number(r.sla30), Number(r.total)),
    })),
    weeklyTrend: weeklyRows.map((r) => ({
      bucket: bucketLabel(r.bucket, "weekly"),
      total: Number(r.total),
      sla10Pct: slaRow(Number(r.sla10), Number(r.total)),
      sla30Pct: slaRow(Number(r.sla30), Number(r.total)),
    })),
    analystRows: analystRows.map((r) => ({
      analyst: r.analyst, tlName: r.tl_name,
      volume: Number(r.volume),
      sla10Pct: slaRow(Number(r.sla10), Number(r.volume)),
      sla30Pct: slaRow(Number(r.sla30), Number(r.volume)),
      avgAht: r.avgAht !== null ? Math.round(Number(r.avgAht)) : null,
    })),
  };
}

// ── Analyst Quality Ranking ───────────────────────────────────────────────────

export interface AnalystQualityRow {
  analyst: string; tlName: string | null;
  intAudits: number; intErrors: number; intErrPct: number | null;
  extAudits: number; extErrors: number; extErrPct: number | null;
  overallErrPct: number | null;
}

export async function getAnalystQualityRanking(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string; analystEmail?: string }
): Promise<AnalystQualityRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName, rawFilters.analystEmail);
  const pool = await getOnfidoPool();

  const [intRows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email AS analyst,
            COALESCE(NULLIF(TRIM(tl_name),''),'(unassigned)') AS tl_name,
            COALESCE(SUM(total_audits),0) AS audits, COALESCE(SUM(total_error),0) AS errors
       FROM onfido_doc_quality_raw
      WHERE task_complete_date BETWEEN ? AND ? ${clause}
        AND analyst_email IS NOT NULL AND analyst_email <> ''
      GROUP BY analyst, tl_name`,
    [f.from, f.to, ...params]
  );
  const [extRows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email AS analyst,
            COALESCE(NULLIF(TRIM(tl_name),''),'(unassigned)') AS tl_name,
            COUNT(*) AS audits, COALESCE(SUM(has_error),0) AS errors
       FROM onfido_doc_external_audit_raw
      WHERE report_date BETWEEN ? AND ? ${clause}
        AND analyst_email IS NOT NULL AND analyst_email <> ''
      GROUP BY analyst, tl_name`,
    [f.from, f.to, ...params]
  );

  const pct = (err: number, tot: number): number | null => tot > 0 ? Math.round((err / tot) * 1000) / 10 : null;
  const map = new Map<string, AnalystQualityRow>();

  for (const r of intRows) {
    const key = String(r.analyst).toLowerCase();
    map.set(key, {
      analyst: r.analyst, tlName: r.tl_name,
      intAudits: Number(r.audits), intErrors: Number(r.errors),
      intErrPct: pct(Number(r.errors), Number(r.audits)),
      extAudits: 0, extErrors: 0, extErrPct: null, overallErrPct: null,
    });
  }
  for (const r of extRows) {
    const key = String(r.analyst).toLowerCase();
    const ex = map.get(key);
    if (ex) {
      ex.extAudits = Number(r.audits); ex.extErrors = Number(r.errors);
      ex.extErrPct = pct(Number(r.errors), Number(r.audits));
    } else {
      map.set(key, {
        analyst: r.analyst, tlName: r.tl_name,
        intAudits: 0, intErrors: 0, intErrPct: null,
        extAudits: Number(r.audits), extErrors: Number(r.errors),
        extErrPct: pct(Number(r.errors), Number(r.audits)),
        overallErrPct: null,
      });
    }
  }
  for (const row of map.values()) {
    const tot = row.intAudits + row.extAudits;
    row.overallErrPct = pct(row.intErrors + row.extErrors, tot);
  }
  return [...map.values()].sort((a, b) => (b.extAudits + b.intAudits) - (a.extAudits + a.intAudits));
}

// ── Analyst Ranking (default leaderboard for Analyst Performance page) ────────

export interface AnalystRankingRow {
  email: string; tlName: string | null; amName: string | null;
  tasks: number; avgAht: number | null; errorRate: number | null; poaTasks: number;
}

export async function getAnalystRanking(
  rawFilters: { from?: string; to?: string }
): Promise<AnalystRankingRow[]> {
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();
  const [docRows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email AS email,
            MAX(tl_name) AS tl_name, MAX(am_name) AS am_name,
            COUNT(*) AS tasks,
            COALESCE(SUM(has_error),0) AS errors,
            AVG(manual_processing_time_secs) AS avgSecs
       FROM onfido_doc_external_audit_raw
      WHERE report_date BETWEEN ? AND ? AND analyst_email IS NOT NULL AND analyst_email <> ''
      GROUP BY email ORDER BY tasks DESC LIMIT 50`,
    [f.from, f.to]
  );
  const [poaRows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email AS email, COUNT(*) AS tasks
       FROM onfido_poa_raw
      WHERE report_completed_date BETWEEN ? AND ? AND analyst_email IS NOT NULL AND analyst_email <> ''
      GROUP BY email`,
    [f.from, f.to]
  );
  const poaMap = new Map(poaRows.map((r) => [String(r.email).toLowerCase(), Number(r.tasks)]));
  const pct = (err: number, tot: number): number | null => tot > 0 ? Math.round((err / tot) * 1000) / 10 : null;
  return docRows.map((r) => ({
    email: r.email, tlName: r.tl_name || null, amName: r.am_name || null,
    tasks: Number(r.tasks),
    avgAht: r.avgSecs !== null ? Math.round(Number(r.avgSecs)) : null,
    errorRate: pct(Number(r.errors), Number(r.tasks)),
    poaTasks: poaMap.get(String(r.email).toLowerCase()) ?? 0,
  }));
}
