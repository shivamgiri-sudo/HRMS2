/**
 * Quality tab (Overall / Internal / External) data.
 *
 * Internal numbers come ONLY from the internal audit tables (onfido_doc_quality_raw for DOC,
 * onfido_poa_quality_raw for POA) and external numbers ONLY from the external ones
 * (onfido_doc_external_audit_raw for DOC, onfido_poa_external_raw for POA). The two sides are
 * returned as separate objects; only the Overall page shows them next to each other.
 *
 * Columns used (all verified against onfido-report-configs.ts `extract` maps):
 *   onfido_doc_quality_raw        task_complete_date, analyst_email, tl_name, am_name, ims_url,
 *                                 total_audits, total_error; everything else (client, document
 *                                 type, task type, per-stage Yes/No) is only in raw_data JSON.
 *   onfido_doc_external_audit_raw report_date, analyst_email, tl_name, am_name, has_error,
 *                                 ims_client_name, docupedia_document_name,
 *                                 <stage>_flag / <stage>_total; "Task Type" only in raw_data JSON.
 *   onfido_poa_quality_raw        report_completed_date, error_count, no_error_count
 *   onfido_poa_external_raw       report_completed_date, error_flag
 * Labelling has an internal source (Lab EWYS) but NO external one -> N/A on the external side.
 */
import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import {
  bucketExpr,
  bucketLabel,
  tlAmFilter,
  type TrendGranularity,
} from "./onfido-process-dashboard.service.js";
import {
  EXTERNAL_STAGES,
  INTERNAL_STAGES,
  jsonNumberExpr,
} from "./onfido-quality-stages.js";

export interface QualityPageFilters {
  from?: string;
  to?: string;
  tlName?: string;
  amName?: string;
  analystEmail?: string;
}

export type QualitySide = "internal" | "external";

export interface StageCell {
  key: string;
  label: string;
  /** false = this side has no data source for the stage (render N/A, never 0). */
  available: boolean;
  errors: number | null;
  audits: number | null;
  errorPct: number | null;
}

export interface SideSummary {
  audits: number;
  errors: number;
  errorPct: number | null;
  poaAudits: number;
  poaErrors: number;
  stages: StageCell[];
}

/** Display order of the scorecard stages. */
export const STAGE_ORDER = [
  { key: "overall", label: "Overall" },
  { key: "extraction", label: "Extraction" },
  { key: "rawExtraction", label: "Raw / EWS Extraction" },
  { key: "labelling", label: "Labeling" },
  { key: "poa", label: "POA" },
  { key: "classification", label: "Classification" },
] as const;

/** Error % to two decimals (the 0.75% / 1% thresholds need more than one). */
export function pct2(errors: number, audits: number): number | null {
  return audits > 0 ? Math.round((errors / audits) * 10000) / 100 : null;
}

export function stageCell(
  key: string,
  label: string,
  errors: number | null,
  audits: number | null,
): StageCell {
  if (errors === null || audits === null) {
    return { key, label, available: false, errors: null, audits: null, errorPct: null };
  }
  return { key, label, available: true, errors, audits, errorPct: pct2(errors, audits) };
}

type Row = Record<string, unknown>;
const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

function resolveRange(f: QualityPageFilters): { from: string; to: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 90);
  return { from: f.from || iso(start), to: f.to || iso(today) };
}

// ── Internal ────────────────────────────────────────────────────────────────

const INT_TABLE = "onfido_doc_quality_raw";
const INT_DATE = "task_complete_date";
const INT_STAGE_KEYS = ["classification", "extraction", "ewys", "labelling"] as const;

const INT_METRICS_SELECT = `COALESCE(SUM(total_audits),0) AS audits, COALESCE(SUM(total_error),0) AS errors, ${INT_STAGE_KEYS.map(
  (k) => {
    const s = INTERNAL_STAGES.find((x) => x.key === k)!;
    return `SUM(${jsonNumberExpr(s.errHeader)}) AS s_${k}_err, SUM(${jsonNumberExpr(s.okHeader)}) AS s_${k}_ok`;
  },
).join(", ")}`;

function intStage(r: Row, k: (typeof INT_STAGE_KEYS)[number]): { e: number; t: number } {
  const e = n(r[`s_${k}_err`]);
  return { e, t: e + n(r[`s_${k}_ok`]) };
}

/** Stage cells for one aggregated internal row (POA cell filled in by the caller). */
export function internalStageCells(r: Row, poa: { errors: number; audits: number }): StageCell[] {
  const cls = intStage(r, "classification");
  const ext = intStage(r, "extraction");
  const raw = intStage(r, "ewys");
  const lab = intStage(r, "labelling");
  return [
    stageCell("overall", "Overall", n(r.errors), n(r.audits)),
    stageCell("extraction", "Extraction", ext.e, ext.t),
    stageCell("rawExtraction", "Raw / EWS Extraction", raw.e, raw.t),
    stageCell("labelling", "Labeling", lab.e, lab.t),
    stageCell("poa", "POA", poa.errors, poa.audits),
    stageCell("classification", "Classification", cls.e, cls.t),
  ];
}

// ── External ────────────────────────────────────────────────────────────────

const EXT_TABLE = "onfido_doc_external_audit_raw";
const EXT_DATE = "report_date";
const EXT_STAGE_KEYS = ["classification", "extraction", "ewys"] as const;

const EXT_METRICS_SELECT = `COUNT(*) AS audits, COALESCE(SUM(has_error),0) AS errors, ${EXTERNAL_STAGES.filter(
  (s) => (EXT_STAGE_KEYS as readonly string[]).includes(s.key),
)
  .map(
    (s) =>
      `COALESCE(SUM(${s.flagColumn}),0) AS x_${s.key}_err, COALESCE(SUM(${s.totalColumn}),0) AS x_${s.key}_tot`,
  )
  .join(", ")}`;

export function externalStageCells(r: Row, poa: { errors: number; audits: number }): StageCell[] {
  const st = (k: (typeof EXT_STAGE_KEYS)[number]) => ({ e: n(r[`x_${k}_err`]), t: n(r[`x_${k}_tot`]) });
  const cls = st("classification");
  const ext = st("extraction");
  const raw = st("ewys");
  return [
    stageCell("overall", "Overall", n(r.errors), n(r.audits)),
    stageCell("extraction", "Extraction", ext.e, ext.t),
    stageCell("rawExtraction", "Raw / EWS Extraction", raw.e, raw.t),
    // No labelling column exists in the external audit export -> N/A, not 0.
    stageCell("labelling", "Labeling", null, null),
    stageCell("poa", "POA", poa.errors, poa.audits),
    stageCell("classification", "Classification", cls.e, cls.t),
  ];
}

// ── Queries ─────────────────────────────────────────────────────────────────

async function poaTotals(
  side: QualitySide,
  range: { from: string; to: string },
  filters: QualityPageFilters,
): Promise<{ errors: number; audits: number }> {
  const { clause, params } = tlAmFilter(filters.tlName, filters.amName, filters.analystEmail);
  const pool = await getOnfidoPool();
  if (side === "internal") {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(error_count),0) AS errors, COALESCE(SUM(error_count),0) + COALESCE(SUM(no_error_count),0) AS audits
         FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
      [range.from, range.to, ...params],
    );
    return { errors: n(rows[0]?.errors), audits: n(rows[0]?.audits) };
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(error_flag),0) AS errors, COUNT(*) AS audits
       FROM onfido_poa_external_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}`,
    [range.from, range.to, ...params],
  );
  return { errors: n(rows[0]?.errors), audits: n(rows[0]?.audits) };
}

export async function getQualitySideSummary(
  side: QualitySide,
  filters: QualityPageFilters,
): Promise<SideSummary> {
  const range = resolveRange(filters);
  const { clause, params } = tlAmFilter(filters.tlName, filters.amName, filters.analystEmail);
  const pool = await getOnfidoPool();
  const internal = side === "internal";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${internal ? INT_METRICS_SELECT : EXT_METRICS_SELECT}
       FROM ${internal ? INT_TABLE : EXT_TABLE} WHERE ${internal ? INT_DATE : EXT_DATE} BETWEEN ? AND ? ${clause}`,
    [range.from, range.to, ...params],
  );
  const r = (rows[0] ?? {}) as Row;
  const poa = await poaTotals(side, range, filters);
  const stages = internal ? internalStageCells(r, poa) : externalStageCells(r, poa);
  return {
    audits: n(r.audits),
    errors: n(r.errors),
    errorPct: pct2(n(r.errors), n(r.audits)),
    poaAudits: poa.audits,
    poaErrors: poa.errors,
    stages,
  };
}

export interface QualitySideTrendPoint {
  bucket: string;
  audits: number;
  errors: number;
  /** keyed by stage key; null when no audits in the bucket or the stage is N/A for the side. */
  pct: Record<string, number | null>;
}

/** Per-bucket stage error % (POA is a different table, so it is not part of this trend). */
export async function getQualitySideTrend(
  side: QualitySide,
  filters: QualityPageFilters,
  granularity: TrendGranularity,
): Promise<QualitySideTrendPoint[]> {
  const range = resolveRange(filters);
  const { clause, params } = tlAmFilter(filters.tlName, filters.amName, filters.analystEmail);
  const pool = await getOnfidoPool();
  const internal = side === "internal";
  const dateCol = internal ? INT_DATE : EXT_DATE;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr(dateCol, granularity)} AS bucket, ${internal ? INT_METRICS_SELECT : EXT_METRICS_SELECT}
       FROM ${internal ? INT_TABLE : EXT_TABLE} WHERE ${dateCol} BETWEEN ? AND ? ${clause}
       GROUP BY bucket ORDER BY bucket`,
    [range.from, range.to, ...params],
  );
  return rows.map((raw) => {
    const r = raw as Row;
    const cells = (internal ? internalStageCells : externalStageCells)(r, { errors: 0, audits: 0 });
    const pct: Record<string, number | null> = {};
    for (const c of cells) if (c.key !== "poa") pct[c.key] = c.errorPct;
    return { bucket: bucketLabel(r.bucket, granularity), audits: n(r.audits), errors: n(r.errors), pct };
  });
}

export type QualityBreakdownDimension = "client" | "documentType" | "taskType" | "tl" | "am";
export const QUALITY_BREAKDOWN_DIMENSIONS: readonly QualityBreakdownDimension[] = [
  "client",
  "documentType",
  "taskType",
  "tl",
  "am",
];

const jsonText = (header: string): string => {
  if (/['"\\]/.test(header)) throw new Error(`Unsafe JSON header: ${header}`);
  return `JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."${header}"'))`;
};
const labelOf = (expr: string): string => `COALESCE(NULLIF(TRIM(${expr}), ''), '(unassigned)')`;

/** SQL expression for one dimension on one side. Internal has no client/document/task-type
 *  columns, so those three read the raw_data JSON header the export carries. */
export function dimensionExpr(side: QualitySide, dim: QualityBreakdownDimension): string {
  switch (dim) {
    case "tl":
      return labelOf("tl_name");
    case "am":
      return labelOf("am_name");
    case "client":
      return labelOf(side === "internal" ? jsonText("IMS Client Name") : "ims_client_name");
    case "documentType":
      return labelOf(
        side === "internal" ? jsonText("Docupedia - Full Document Name") : "docupedia_document_name",
      );
    case "taskType":
      return labelOf(jsonText("Task Type"));
  }
}

export interface QualityBreakdownRow {
  label: string;
  audits: number;
  errors: number;
  errorPct: number | null;
}

export async function getQualitySideBreakdown(
  side: QualitySide,
  dim: QualityBreakdownDimension,
  filters: QualityPageFilters,
): Promise<QualityBreakdownRow[]> {
  const range = resolveRange(filters);
  const { clause, params } = tlAmFilter(filters.tlName, filters.amName, filters.analystEmail);
  const pool = await getOnfidoPool();
  const internal = side === "internal";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dimensionExpr(side, dim)} AS label,
            ${internal ? "COALESCE(SUM(total_audits),0)" : "COUNT(*)"} AS audits,
            ${internal ? "COALESCE(SUM(total_error),0)" : "COALESCE(SUM(has_error),0)"} AS errors
       FROM ${internal ? INT_TABLE : EXT_TABLE} WHERE ${internal ? INT_DATE : EXT_DATE} BETWEEN ? AND ? ${clause}
       GROUP BY label ORDER BY audits DESC LIMIT 100`,
    [range.from, range.to, ...params],
  );
  return rows.map((r) => ({
    label: String(r.label),
    audits: n(r.audits),
    errors: n(r.errors),
    errorPct: pct2(n(r.errors), n(r.audits)),
  }));
}

export type AnalystQualityMode =
  | "daily"
  | "weekly"
  | "monthly"
  | "document"
  | "client"
  | "documentType"
  | "taskType";
export const ANALYST_QUALITY_MODES: readonly AnalystQualityMode[] = [
  "daily",
  "weekly",
  "monthly",
  "document",
  "client",
  "documentType",
  "taskType",
];

export interface InternalAnalystRow {
  analyst: string;
  tlName: string;
  group: string;
  audits: number;
  errors: number;
  errorPct: number | null;
}

/** Internal analyst quality, grouped by period or by document / client / document type / task type. */
export async function getInternalAnalystQuality(
  mode: AnalystQualityMode,
  filters: QualityPageFilters,
): Promise<InternalAnalystRow[]> {
  const range = resolveRange(filters);
  const { clause, params } = tlAmFilter(filters.tlName, filters.amName, filters.analystEmail);
  const period = mode === "daily" || mode === "weekly" || mode === "monthly";
  const groupExpr = period
    ? bucketExpr(INT_DATE, mode)
    : mode === "document"
      ? labelOf("ims_url")
      : dimensionExpr("internal", mode);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT analyst_email AS analyst, COALESCE(NULLIF(TRIM(MAX(tl_name)),''),'(unassigned)') AS tl,
            ${groupExpr} AS grp,
            COALESCE(SUM(total_audits),0) AS audits, COALESCE(SUM(total_error),0) AS errors
       FROM ${INT_TABLE}
      WHERE ${INT_DATE} BETWEEN ? AND ? ${clause}
        AND analyst_email IS NOT NULL AND analyst_email <> ''
      GROUP BY analyst, grp
      ORDER BY ${period ? "grp DESC, audits DESC" : "errors DESC, audits DESC"}
      LIMIT 1000`,
    [range.from, range.to, ...params],
  );
  return rows.map((r) => ({
    analyst: String(r.analyst),
    tlName: String(r.tl),
    group: period ? bucketLabel(r.grp, mode as TrendGranularity) : String(r.grp),
    audits: n(r.audits),
    errors: n(r.errors),
    errorPct: pct2(n(r.errors), n(r.audits)),
  }));
}
