import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import { ONFIDO_REPORT_CONFIGS } from "../bulk-upload/onfido-report-configs.js";

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
export async function getOverview(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }) {
  const f = readFilters(rawFilters);
  const amName = rawFilters.amName || null;
  const tlClause = f.tlName ? "AND tl_name = ?" : "";
  const tlParam = f.tlName ? [f.tlName] : [];
  const amClause = amName ? "AND am_name = ?" : "";
  const amParam = amName ? [amName] : [];
  const filterClause = `${tlClause} ${amClause}`;
  const filterParams = [...tlParam, ...amParam];

  const docVolume = await scalar<RowDataPacket & { n: number; aht: number | null; esc: number }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht, SUM(is_escalated) AS esc
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
  const cre = await scalar<RowDataPacket & { line_count: number; reports: number }>(
    `SELECT COUNT(*) AS line_count, COUNT(DISTINCT ims_report_url) AS reports
       FROM onfido_doc_escalation_cre_raw WHERE report_completed_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );
  const crq = await scalar<RowDataPacket & { line_count: number; reports: number }>(
    `SELECT COUNT(*) AS line_count, COUNT(DISTINCT ims_report_url) AS reports
       FROM onfido_doc_escalation_crq_raw WHERE report_completed_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );

  const poaVolume = await scalar<RowDataPacket & { n: number; aht: number | null }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );
  const poaTrial = await scalar<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM onfido_poa_trial_raw WHERE report_completed_date BETWEEN ? AND ? ${filterClause}`,
    [f.from, f.to, ...filterParams]
  );
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
    },
    poa: {
      volume: kpi("poa_volume", "POA Reports Processed", (poaVolume.n ?? 0) + (poaTrial.n ?? 0), "count",
        poaTrial.n > 0 ? `includes ${poaTrial.n} trial-queue report(s)` : undefined),
      avgAht: kpi("poa_aht", "POA Avg Handling Time", poaVolume.aht !== null ? Math.round(poaVolume.aht) : null, "seconds"),
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
}

/** Per-TL rollup for the same date range — the table the KPI cards drill into. */
export async function getTlBreakdown(rawFilters: { from?: string; to?: string }): Promise<TlBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();

  const [docRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name,
            COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht, SUM(is_escalated) AS esc
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
       FROM onfido_doc_escalation_cre_raw WHERE report_completed_date BETWEEN ? AND ?
       GROUP BY tl_name`,
    [f.from, f.to]
  );
  const [crqRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name, COUNT(*) AS n
       FROM onfido_doc_escalation_crq_raw WHERE report_completed_date BETWEEN ? AND ?
       GROUP BY tl_name`,
    [f.from, f.to]
  );

  const qualityByTl = new Map(qualityRows.map((r) => [r.tl_name, r]));
  const escByTl = new Map<string, number>();
  for (const r of [...creRows, ...crqRows]) {
    escByTl.set(r.tl_name, (escByTl.get(r.tl_name) ?? 0) + Number(r.n));
  }

  return docRows.map((r): TlBreakdownRow => {
    const q = qualityByTl.get(r.tl_name);
    const audits = q ? Number(q.audits) : 0;
    const errors = q ? Number(q.errors) : 0;
    return {
      tlName: r.tl_name,
      docVolume: Number(r.n),
      docAvgAht: r.aht !== null ? Math.round(Number(r.aht)) : null,
      docEscalations: Number(r.esc ?? 0),
      docAuditErrorRate: audits > 0 ? Math.round((errors / audits) * 1000) / 10 : null,
      escalationLines: escByTl.get(r.tl_name) ?? 0,
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
  numeratorExpr?: string;   // for kind: "rate"
  denominatorExpr?: string; // for kind: "rate"
  recordFilter?: string;    // WHERE fragment narrowing level-3 records to what this metric counts
}

const METRIC_DEFS: Record<string, MetricDef> = {
  doc_volume: { key: "doc_volume", table: "onfido_doc_raw", dateColumn: "report_date", kind: "count" },
  doc_aht: {
    key: "doc_aht", table: "onfido_doc_raw", dateColumn: "report_date", kind: "avg",
    column: "manual_processing_time_secs",
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
    key: "doc_client_escalations", table: "onfido_doc_escalation_cre_raw", dateColumn: "report_completed_date", kind: "count",
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
    def.kind === "avg" ? `AVG(${def.column}) AS value` :
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
function resolveTable(tableKey: string): string {
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
  "docupedia_document_name", "error_category",
  // has_error powers the "errors only" raw-table view (a real, standalone table
  // of just the failed audits, not a grouped breakdown) — same generic
  // filterColumn/filterValue mechanism, just a boolean flag instead of a label.
  "has_error",
]);

export interface RecordListFilters {
  from?: string; to?: string; tlName?: string; amName?: string; search?: string;
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
async function queryTableRecords(table: string, extraCondition: string | null, filters: RecordListFilters) {
  const pool = await getOnfidoPool();
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const offset = Math.max(0, filters.cursor ?? 0);

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
  if (filters.filterColumn && filters.filterValue !== undefined) {
    if (!ALLOWED_FILTER_COLUMNS.has(filters.filterColumn)) {
      throw Object.assign(new Error(`Unknown filter column '${filters.filterColumn}'`), { statusCode: 400 });
    }
    if (filters.filterValue === "(unassigned)") {
      where.push(`(${filters.filterColumn} IS NULL OR TRIM(${filters.filterColumn}) = '')`);
    } else {
      where.push(`${filters.filterColumn} = ?`); params.push(filters.filterValue);
    }
  }
  if (filters.search) {
    where.push("(analyst_email LIKE ? OR raw_data LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

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
function bucketExpr(dateCol: string, granularity: TrendGranularity): string {
  return granularity === "daily" ? `DATE(${dateCol})`
    : granularity === "weekly" ? `DATE_SUB(${dateCol}, INTERVAL WEEKDAY(${dateCol}) DAY)`
    : `DATE_FORMAT(${dateCol}, '%Y-%m-01')`;
}
function bucketLabel(d: unknown, granularity: TrendGranularity): string {
  const iso = dateBucketToIso(d);
  return granularity === "monthly" ? iso.slice(0, 7) : iso;
}

/** Same DOC+POA volume rollup as getMonthlyTrend, generalised to daily/weekly buckets
 *  for the Trends view's granularity toggle — this is a re-aggregation of the same
 *  two real tables, not a new data source. */
export async function getVolumeTrend(rawFilters: { from?: string; to?: string }, granularity: TrendGranularity) {
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();

  const [docRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_date", granularity)} AS bucket, COUNT(*) AS n
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to]
  );
  const [poaRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_completed_date", granularity)} AS bucket, COUNT(*) AS n
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to]
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
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, granularity: TrendGranularity
): Promise<EtmGranularTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
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
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, granularity: TrendGranularity
): Promise<TaskSkipGranularTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
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
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, granularity: TrendGranularity
): Promise<QualityGranularTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
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

export interface AttritionGranularTrendPoint { bucket: string; attritionCount: number }

/** Attrition tab's trend chart, daily/weekly/monthly — exit COUNT only, not a
 *  rate: an attrition rate needs a real calendar month's opening/closing HC
 *  (see getAttritionMonthlyDetail), so daily/weekly buckets only ever show the
 *  count here, never a %, to avoid resurrecting the same noisy-denominator
 *  problem that produced 3000%+ rates before that fix. */
export async function getAttritionTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, granularity: TrendGranularity
): Promise<AttritionGranularTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
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

  const agg = await scalar<RowDataPacket & { total: number; errors: number; farN: number; frrN: number; avgSecs: number | null }>(
    `SELECT COUNT(*) AS total, SUM(has_error) AS errors, SUM(manual_far_flag) AS farN,
            SUM(manual_frr_flag) AS frrN, AVG(manual_processing_time_secs) AS avgSecs
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
  const poaTotal = Number(poaQ.errors ?? 0) + Number(poaQ.noErrors ?? 0);

  return {
    email,
    tlName: identity.tl_name,
    amName: identity.am_name,
    qaName: identity.qa_name,
    totalTasks: kpi("analyst_total_tasks", "Total Tasks", total, "count"),
    avgManualProcessingTime: kpi("analyst_avg_time", "Avg Handling Time", agg.avgSecs !== null ? Math.round(Number(agg.avgSecs)) : null, "seconds"),
    overallErrorRate: kpi("analyst_overall_err", "Overall Error Rate", rate(errors, total), "percent", `${errors} of ${total}`),
    manualFarRate: kpi("analyst_far", "Manual FAR Rate", rate(farN, total), "percent", `${farN} of ${total}`),
    manualFrrRate: kpi("analyst_frr", "Manual FRR Rate", rate(frrN, total), "percent", `${frrN} of ${total}`),
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
  metric: "Overall Error %" | "Manual FAR %" | "Manual FRR %" | "POA Error %";
  value: number;
  threshold: number;
  severity: "high" | "medium";
}

function severityFor(value: number, threshold: number): "high" | "medium" {
  return value >= threshold * 1.5 ? "high" : "medium";
}

/** Every analyst currently over a quality threshold, for the selected range. */
export async function listAlerts(rawFilters: { from?: string; to?: string }, thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS): Promise<AlertRow[]> {
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();

  const [auditRows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email, COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name,
            COUNT(*) AS total, SUM(has_error) AS errors, SUM(manual_far_flag) AS farN, SUM(manual_frr_flag) AS frrN
       FROM onfido_doc_external_audit_raw
      WHERE report_date BETWEEN ? AND ? AND analyst_email IS NOT NULL AND analyst_email <> ''
      GROUP BY analyst_email, tl_name`,
    [f.from, f.to]
  );
  const [poaRows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email, COALESCE(NULLIF(TRIM(tl_name), ''), '(unassigned)') AS tl_name,
            COALESCE(SUM(error_count),0) AS errors, COALESCE(SUM(no_error_count),0) AS noErrors
       FROM onfido_poa_quality_raw
      WHERE report_completed_date BETWEEN ? AND ? AND analyst_email IS NOT NULL AND analyst_email <> ''
      GROUP BY analyst_email, tl_name`,
    [f.from, f.to]
  );

  const alerts: AlertRow[] = [];
  const round1 = (n: number) => Math.round(n * 10) / 10;

  for (const r of auditRows) {
    const total = Number(r.total);
    if (total === 0) continue;
    const overallPct = round1((Number(r.errors ?? 0) / total) * 100);
    const farPct = round1((Number(r.farN ?? 0) / total) * 100);
    const frrPct = round1((Number(r.frrN ?? 0) / total) * 100);
    if (overallPct > thresholds.overallErrorPct) {
      alerts.push({ analystEmail: r.analyst_email, tlName: r.tl_name, metric: "Overall Error %", value: overallPct, threshold: thresholds.overallErrorPct, severity: severityFor(overallPct, thresholds.overallErrorPct) });
    }
    if (farPct > thresholds.farPct) {
      alerts.push({ analystEmail: r.analyst_email, tlName: r.tl_name, metric: "Manual FAR %", value: farPct, threshold: thresholds.farPct, severity: severityFor(farPct, thresholds.farPct) });
    }
    if (frrPct > thresholds.frrPct) {
      alerts.push({ analystEmail: r.analyst_email, tlName: r.tl_name, metric: "Manual FRR %", value: frrPct, threshold: thresholds.frrPct, severity: severityFor(frrPct, thresholds.frrPct) });
    }
  }
  for (const r of poaRows) {
    const total = Number(r.errors ?? 0) + Number(r.noErrors ?? 0);
    if (total === 0) continue;
    const poaPct = round1((Number(r.errors ?? 0) / total) * 100);
    if (poaPct > thresholds.poaErrorPct) {
      alerts.push({ analystEmail: r.analyst_email, tlName: r.tl_name, metric: "POA Error %", value: poaPct, threshold: thresholds.poaErrorPct, severity: severityFor(poaPct, thresholds.poaErrorPct) });
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
export async function getFilterOptions(): Promise<{ tlNames: string[]; amNames: string[] }> {
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
  return { tlNames: tlRows.map((r) => r.name as string), amNames: amRows.map((r) => r.name as string) };
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
/** Same as rate1, but withholds a rate whose numerator exceeds its own denominator
 *  (more exits/UL-days than the group's average headcount/scheduled-days is not a
 *  real ratio — see getAttritionBreakdown's note on transient buckets like Training). */
const rate1Guarded = (n: number, d: number) => (n <= d ? rate1(n, d) : null);

/**
 * Shared TL/AM filter builder for every Attrition/Quality/ETM/Task Skip
 * function below — the Executive Filters bar's TL/AM dropdowns apply across
 * every tab, the same way the reference dashboard's own filter bar does, not
 * just the Overview tab. Every one of these tables really does carry both
 * tl_name and am_name columns, so this is safe to reuse unconditionally.
 */
function tlAmFilter(tlName?: string, amName?: string): { clause: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (tlName) { parts.push("tl_name = ?"); params.push(tlName); }
  if (amName) { parts.push("am_name = ?"); params.push(amName); }
  return { clause: parts.length > 0 ? `AND ${parts.join(" AND ")}` : "", params };
}

/**
 * One correctly-scoped row per real calendar month overlapping [from, to].
 *
 * avgHc is the mean of every day's real headcount across the whole month, not
 * a naive (openingHc + closingHc) / 2 — confirmed live that the two-point
 * version breaks down badly at TL/AM granularity: a transient bucket like the
 * "Training" TL can show 1-2 people on its first/last day of a month while 50+
 * people rotate through it that same month, so two-point "avg HC" of ~1-2
 * against 50+ exits produced a 3775% shrinkage rate. Averaging the real daily
 * HC across every day in the month is still 100% derived from the source
 * file — no fabrication — it is just a materially less noisy sample than two
 * arbitrary single days, and matches how "average headcount for the period"
 * is normally defined in workforce reporting.
 */
export async function getAttritionMonthlyDetail(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }): Promise<AttritionMonthRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();

  const [dayRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(work_date, '%Y-%m') AS ym, work_date, SUM(hc) AS hc
       FROM onfido_agent_daily_raw WHERE work_date BETWEEN ? AND ? ${clause}
       GROUP BY ym, work_date ORDER BY ym, work_date`,
    [f.from, f.to, ...params]
  );
  const hcByMonth = new Map<string, { opening: number; closing: number; sum: number; days: number }>();
  for (const r of dayRows) {
    const ym = r.ym as string;
    const hc = Number(r.hc ?? 0);
    const entry = hcByMonth.get(ym);
    if (!entry) hcByMonth.set(ym, { opening: hc, closing: hc, sum: hc, days: 1 });
    else { entry.closing = hc; entry.sum += hc; entry.days += 1; }
  }

  const [aggRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(work_date, '%Y-%m') AS ym,
            COALESCE(SUM(attrition_flag),0) AS attrition, COALESCE(SUM(scheduled),0) AS scheduled,
            COALESCE(SUM(unplanned_leave),0) AS ul, COALESCE(SUM(actual_ul),0) AS actualUl
       FROM onfido_agent_daily_raw WHERE work_date BETWEEN ? AND ? ${clause}
       GROUP BY ym ORDER BY ym`,
    [f.from, f.to, ...params]
  );

  return aggRows.map((r): AttritionMonthRow => {
    const hcInfo = hcByMonth.get(r.ym) ?? { opening: 0, closing: 0, sum: 0, days: 0 };
    const avgHc = hcInfo.days > 0 ? Math.round((hcInfo.sum / hcInfo.days) * 10) / 10 : 0;
    const attrition = Number(r.attrition ?? 0);
    const scheduled = Number(r.scheduled ?? 0);
    return {
      month: r.ym, openingHc: hcInfo.opening, closingHc: hcInfo.closing, avgHc,
      attritionCount: attrition, attritionRate: rate1(attrition, avgHc),
      scheduled, unplannedLeave: Number(r.ul ?? 0), actualUl: Number(r.actualUl ?? 0),
      ulShrinkageRate: rate1Guarded(Number(r.ul ?? 0), scheduled),
      actualShrinkageRate: rate1Guarded(Number(r.actualUl ?? 0), scheduled),
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

export async function getAttritionOverview(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }): Promise<AttritionOverview> {
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
  attritionCount: number;
  attritionRate: number | null;
  ulShrinkageRate: number | null;
  note?: string;
}

/** Same per-month scoping as getAttritionOverview, grouped by AM/TL/AON/Location. */
export async function getAttritionBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, dimension: AttritionDimension
): Promise<AttritionBreakdownRow[]> {
  const months = await getAttritionMonthlyDetail(rawFilters);
  const targetMonth = months[months.length - 1]?.month;
  if (!targetMonth) return [];

  const pool = await getOnfidoPool();
  const col = dimension;
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);

  // Same fix as getAttritionMonthlyDetail: average every day's HC across the
  // month for this group, not just its first/last day — a transient bucket
  // (e.g. TL "Training") can carry very few people on any single day while
  // dozens rotate through it across the month, so a two-point average against
  // a whole month's exits produced rates over 3000%.
  const [dayRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${col}), ''), '(unassigned)') AS label, work_date, SUM(hc) AS hc
       FROM onfido_agent_daily_raw WHERE DATE_FORMAT(work_date, '%Y-%m') = ? ${clause}
       GROUP BY label, work_date ORDER BY label, work_date`,
    [targetMonth, ...params]
  );
  const hcByLabel = new Map<string, { sum: number; days: number }>();
  for (const r of dayRows) {
    const label = r.label as string;
    const hc = Number(r.hc ?? 0);
    const entry = hcByLabel.get(label);
    if (!entry) hcByLabel.set(label, { sum: hc, days: 1 });
    else { entry.sum += hc; entry.days += 1; }
  }

  const [aggRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${col}), ''), '(unassigned)') AS label,
            COALESCE(SUM(attrition_flag),0) AS attrition, COALESCE(SUM(scheduled),0) AS scheduled,
            COALESCE(SUM(unplanned_leave),0) AS ul
       FROM onfido_agent_daily_raw WHERE DATE_FORMAT(work_date, '%Y-%m') = ? ${clause}
       GROUP BY label`,
    [targetMonth, ...params]
  );

  return aggRows
    .map((r): AttritionBreakdownRow => {
      const hcInfo = hcByLabel.get(r.label) ?? { sum: 0, days: 0 };
      const avgHc = hcInfo.days > 0 ? hcInfo.sum / hcInfo.days : 0;
      const attrition = Number(r.attrition ?? 0);
      // A bucket whose average headcount is smaller than its own exit count
      // for the month cannot be a real, stable team — that combination only
      // shows up for transient placeholder buckets like TL "Training" or
      // "Support" (onboarding washouts / floaters get tagged there, not a
      // person who was ever really "on" that team's daily roster). Rather
      // than publish a >100%-style rate for those, the rate is withheld with
      // a note — the same way the reference dashboard's own TL Wise table
      // omits "Training"/"Support" from its attrition-rate rows entirely.
      const rateIsMeaningful = avgHc >= attrition;
      return {
        label: r.label,
        attritionCount: attrition,
        attritionRate: rateIsMeaningful ? rate1(attrition, avgHc) : null,
        ulShrinkageRate: rate1Guarded(Number(r.ul ?? 0), Number(r.scheduled ?? 0)),
        note: rateIsMeaningful ? undefined : `Avg HC (${Math.round(avgHc * 10) / 10}) is smaller than exits — likely a transient bucket, not a stable team`,
      };
    })
    .sort((a, b) => b.attritionCount - a.attritionCount);
}

export interface AttritionExitRow {
  id: string;
  empId: string; empName: string; analystEmail: string; tlName: string; amName: string;
  exitDate: string; reason: string | null; attritionType: string | null;
}

/** Every real exit row in range — the record-level drill-down behind the count.
 *  Carries `id` so the frontend can open the same full-record drawer every
 *  other table's rows do (GET /records/ONFIDO_AGENT_DAILY/:id). */
export async function listAttritionExits(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }): Promise<AttritionExitRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
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

export interface EtmOverview {
  docCount: KpiValue;
  poaCount: KpiValue;
}

export async function getEtmOverview(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }): Promise<EtmOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const doc = await scalar<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM onfido_doc_etm_raw WHERE report_date BETWEEN ? AND ? ${clause}`, [f.from, f.to, ...params]
  );
  const poa = await scalar<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM onfido_poa_etm_raw WHERE report_date BETWEEN ? AND ? ${clause}`, [f.from, f.to, ...params]
  );
  const kpi = (key: string, label: string, value: number): KpiValue => ({
    key, label, value, unit: "count", availability: "ok",
  });
  return {
    docCount: kpi("etm_doc_count", "DOC ETM Count", Number(doc.n ?? 0)),
    poaCount: kpi("etm_poa_count", "POA ETM Count", Number(poa.n ?? 0)),
  };
}

export interface EtmTrendPoint { month: string; doc: number; poa: number }

export async function getEtmMonthlyTrend(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }): Promise<EtmTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
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
export type EtmDimension = "tl_name" | "am_name" | "escalated_by_email";

export interface EtmBreakdownRow { label: string; count: number }

export async function getEtmBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, queue: EtmQueue, dimension: EtmDimension
): Promise<EtmBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
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

// ── Task Skip — onfido_task_skip_raw ────────────────────────────────────────

export interface TaskSkipOverview { count: KpiValue }

export async function getTaskSkipOverview(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }): Promise<TaskSkipOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const agg = await scalar<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM onfido_task_skip_raw WHERE skip_date BETWEEN ? AND ? ${clause}`, [f.from, f.to, ...params]
  );
  return { count: { key: "taskskip_count", label: "Task Skip Count", value: Number(agg.n ?? 0), unit: "count", availability: "ok" } };
}

export interface TaskSkipTrendPoint { month: string; count: number }

export async function getTaskSkipMonthlyTrend(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }): Promise<TaskSkipTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
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
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, dimension: TaskSkipDimension
): Promise<TaskSkipBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label, COUNT(*) AS n
       FROM onfido_task_skip_raw WHERE skip_date BETWEEN ? AND ? ${clause}
       GROUP BY label ORDER BY n DESC LIMIT 30`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => ({ label: r.label, count: Number(r.n) }));
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

export async function getQualityOverview(rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }): Promise<QualityOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
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
  const rate = (n: number) => rate1(n, total);
  return {
    taskCount: kpi("quality_task_count", "Tasks Audited", total, "count"),
    overallErrorRate: kpi("quality_overall_err", "Overall Error Rate", rate(Number(agg.errors ?? 0)), "percent", `${agg.errors ?? 0} of ${total}`),
    farRate: kpi("quality_far", "Manual FAR Rate", rate(Number(agg.farN ?? 0)), "percent", `${agg.farN ?? 0} of ${total}`),
    frrRate: kpi("quality_frr", "Manual FRR Rate", rate(Number(agg.frrN ?? 0)), "percent", `${agg.frrN ?? 0} of ${total}`),
    classificationErrorRate: kpi("quality_class", "Classification Error Rate", rate(Number(agg.classN ?? 0)), "percent", `${agg.classN ?? 0} of ${total}`),
    extractionErrorRate: kpi("quality_ext", "Extraction Error Rate", rate(Number(agg.extN ?? 0)), "percent", `${agg.extN ?? 0} of ${total}`),
    addExtractionErrorRate: kpi("quality_add_ext", "Add. Extraction Error Rate", rate(Number(agg.addExtN ?? 0)), "percent", `${agg.addExtN ?? 0} of ${total}`),
    rawExtractionErrorRate: kpi("quality_raw_ext", "Raw Extraction Error Rate", rate(Number(agg.rawExtN ?? 0)), "percent", `${agg.rawExtN ?? 0} of ${total}`),
  };
}

export type QualityDimension = "ims_client_name" | "docupedia_document_name" | "tl_name" | "am_name";

export interface QualityBreakdownRow {
  label: string; taskCount: number; overallErrorRate: number | null; farRate: number | null; frrRate: number | null;
}

export async function getQualityBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, dimension: QualityDimension
): Promise<QualityBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
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

const escCre = "onfido_doc_escalation_cre_raw";
const escCrq = "onfido_doc_escalation_crq_raw";

export interface EscalationOverview {
  totalLines: KpiValue;
  creLines: KpiValue;
  crqLines: KpiValue;
  distinctReports: KpiValue;
}

export async function getEscalationOverview(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }
): Promise<EscalationOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const cre = await scalar<RowDataPacket & { n: number; reports: number }>(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT ims_report_url) AS reports
       FROM ${escCre} WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const crq = await scalar<RowDataPacket & { n: number; reports: number }>(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT ims_report_url) AS reports
       FROM ${escCrq} WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
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

export interface EscalationTrendPoint { bucket: string; count: number; }

export async function getEscalationTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, granularity: TrendGranularity
): Promise<EscalationTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const expr = bucketExpr("report_completed_date", granularity);
  const [creRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM ${escCre}
      WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  const [crqRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM ${escCrq}
      WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  const byBucket = new Map<string, number>();
  for (const r of creRows) byBucket.set(bucketLabel(r.bucket, granularity), Number(r.n));
  for (const r of crqRows) {
    const key = bucketLabel(r.bucket, granularity);
    byBucket.set(key, (byBucket.get(key) ?? 0) + Number(r.n));
  }
  return [...byBucket.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, count]) => ({ bucket, count }));
}

export type EscalationDimension = "ims_client_name" | "error_category" | "tl_name" | "am_name";

export interface EscalationBreakdownRow { label: string; count: number; }

export async function getEscalationBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, dimension: EscalationDimension
): Promise<EscalationBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const side = (table: string) =>
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label, COUNT(*) AS cnt
       FROM ${table} WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY label`;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT label, SUM(cnt) AS total FROM (${side(escCre)} UNION ALL ${side(escCrq)}) t
      GROUP BY label ORDER BY total DESC LIMIT 50`,
    [f.from, f.to, ...params, f.from, f.to, ...params]
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
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string },
  dimension: EscalationDimension,
  value: string,
  limit = 50
): Promise<{ rows: EscalationRecordRow[]; total: number }> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const dimCond = value === "(unassigned)" ? `(${dimension} IS NULL OR TRIM(${dimension}) = '')` : `${dimension} = ?`;
  const valParams = value === "(unassigned)" ? [] : [value];

  const [creRows] = await pool.query<RowDataPacket[]>(
    `SELECT *, 'CRE' AS escalation_source FROM ${escCre}
      WHERE report_completed_date BETWEEN ? AND ? ${clause} AND ${dimCond}
      ORDER BY report_completed_date DESC LIMIT ?`,
    [f.from, f.to, ...params, ...valParams, limit]
  );
  const [crqRows] = await pool.query<RowDataPacket[]>(
    `SELECT *, 'CRQ' AS escalation_source FROM ${escCrq}
      WHERE report_completed_date BETWEEN ? AND ? ${clause} AND ${dimCond}
      ORDER BY report_completed_date DESC LIMIT ?`,
    [f.from, f.to, ...params, ...valParams, limit]
  );
  const rows = [...creRows, ...crqRows]
    .sort((a, b) => new Date(b.report_completed_date as string).getTime() - new Date(a.report_completed_date as string).getTime())
    .slice(0, limit) as EscalationRecordRow[];

  const [[creCount]] = await pool.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM ${escCre} WHERE report_completed_date BETWEEN ? AND ? ${clause} AND ${dimCond}`,
    [f.from, f.to, ...params, ...valParams]
  );
  const [[crqCount]] = await pool.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM ${escCrq} WHERE report_completed_date BETWEEN ? AND ? ${clause} AND ${dimCond}`,
    [f.from, f.to, ...params, ...valParams]
  );
  return { rows, total: Number(creCount.n) + Number(crqCount.n) };
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
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }
): Promise<DocRawOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const agg = await scalar<RowDataPacket & { n: number; aht: number | null; queue: number | null; esc: number }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht, AVG(queue_time_secs) AS queue, SUM(is_escalated) AS esc
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
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, granularity: TrendGranularity
): Promise<DocRawTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr("report_date", granularity)} AS bucket, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [f.from, f.to, ...params]
  );
  return rows.map((r) => ({
    bucket: bucketLabel(r.bucket, granularity), taskCount: Number(r.n),
    avgAht: r.aht !== null ? Math.round(Number(r.aht)) : null,
  }));
}

export type DocRawDimension = "ims_client_name" | "tl_name" | "am_name";
export interface DocRawBreakdownRow { label: string; taskCount: number; avgAht: number | null; escalationRate: number | null }

export async function getDocRawBreakdown(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, dimension: DocRawDimension
): Promise<DocRawBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)') AS label,
            COUNT(*) AS total, AVG(manual_processing_time_secs) AS aht, SUM(is_escalated) AS esc
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? ${clause}
       GROUP BY label ORDER BY total DESC LIMIT 50`,
    [f.from, f.to, ...params]
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
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }
): Promise<PoaOverview> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const raw = await scalar<RowDataPacket & { n: number; aht: number | null }>(
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
  const trial = await scalar<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM onfido_poa_trial_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params]
  );
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
    avgAht: kpi("poa_raw_aht", "POA Avg Handling Time", raw.aht !== null ? Math.round(Number(raw.aht)) : null, "seconds"),
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

export interface PoaTrendPoint { bucket: string; taskCount: number }

/** Volume trend (POA Raw + POA Trial combined count) — count only, same
 *  reasoning as every other trend in this file: AHT/error-rate belong in the
 *  overview tiles and breakdown table, not blended into one bucketed line. */
export async function getPoaTrend(
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, granularity: TrendGranularity
): Promise<PoaTrendPoint[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const expr = bucketExpr("report_completed_date", granularity);
  const [rawRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM onfido_poa_raw
      WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY bucket`,
    [f.from, f.to, ...params]
  );
  const [trialRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS bucket, COUNT(*) AS n FROM onfido_poa_trial_raw
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
  rawFilters: { from?: string; to?: string; tlName?: string; amName?: string }, dimension: PoaDimension
): Promise<PoaBreakdownRow[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const label = `COALESCE(NULLIF(TRIM(${dimension}), ''), '(unassigned)')`;

  const [rawRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${label} AS label, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
       FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY label`,
    [f.from, f.to, ...params]
  );
  const [trialRows] = await pool.query<RowDataPacket[]>(
    `SELECT ${label} AS label, COUNT(*) AS n FROM onfido_poa_trial_raw
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
  for (const r of trialRows) { get(r.label).taskCount += Number(r.n); }
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
    `SELECT COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht FROM onfido_doc_raw WHERE report_date = ?`,
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
            COUNT(*) AS total, AVG(manual_processing_time_secs) AS aht
       FROM onfido_doc_raw WHERE report_date = ?
       GROUP BY label ORDER BY total DESC LIMIT 20`,
    [today]
  );
  return rows.map((r): LiveBreakdownRow => ({
    label: r.label, taskCount: Number(r.total ?? 0),
    avgAht: r.aht !== null ? Math.round(Number(r.aht)) : null,
  }));
}
