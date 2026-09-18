/**
 * POA Internal / POA External / POA Trail dashboard pages.
 *
 * Rebuilds the three "Central Dashboard" reference pages (Internal Quality,
 * External Quality, Trail SLA) from the real onfido_db tables:
 *   - onfido_poa_quality_raw  -> POA Internal (QC audits)
 *   - onfido_poa_external_raw -> POA External (client-reported audits)
 *   - onfido_poa_trial_raw    -> POA Trail SLA
 *
 * The row -> matrix maths (percentages, Grand Total, sort order, Top-10 tables,
 * week-commencing labels, region, external error buckets, SLA classification)
 * lives in small exported pure functions so it can be unit-tested without a DB.
 *
 * FAR / FRR / Manual FAR / Manual FRR are deliberately never computed here
 * (owner constraint).
 */
import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PoaPageFilters {
  from?: string;
  to?: string;
  tlName?: string;
  amName?: string;
}

export interface ResolvedPoaFilters {
  from: string;
  to: string;
  tlName: string | null;
  amName: string | null;
}

/** One un-derived aggregate row (a bucket's raw counts). */
export interface AuditMatrixInput {
  label: string;
  /** Chronological sort key (ISO date) for Date / WC tables. */
  sortKey?: string;
  totalQc: number;
  errors: number;
  /** Denominator of "Total Error %". Defaults to totalQc. Internal: error + no-error. */
  errorBase?: number;
  classificationError: number;
  extractionError: number;
  comparisonError: number;
}

/** Deep-dive matrix row: Particular | Total QC | Error | Total Error % | Classification ... */
export interface AuditMatrixRow {
  particular: string;
  sortKey: string;
  totalQc: number;
  errors: number;
  errorBase: number;
  errorPct: number;
  classificationError: number;
  classificationPct: number;
  extractionError: number;
  extractionPct: number;
  comparisonError: number;
  comparisonPct: number;
  isGrandTotal?: boolean;
}

export interface AuditCards {
  sample: number;
  errors: number;
  accuracy: number;
  errorRate: number;
  classificationError: number;
  extractionError: number;
  comparisonError: number;
}

export interface AuditChartPoint {
  date: string;
  label: string;
  audits: number;
  errors: number;
  errorPct: number;
}

export type Region = "EU" | "CA" | "US";

export interface RegionQualityRow {
  date: string;
  dateLabel: string;
  euQc: number; euError: number; euErrorPct: number;
  caQc: number; caError: number; caErrorPct: number;
  usQc: number; usError: number; usErrorPct: number;
  totalQc: number; totalError: number; totalErrorPct: number;
  isGrandTotal?: boolean;
}

export interface PoaAuditPage {
  filters: ResolvedPoaFilters;
  cards: AuditCards;
  chartDaily: AuditChartPoint[];
  dailyArr: AuditMatrixRow[];
  weeklyArr: AuditMatrixRow[];
  tlArr: AuditMatrixRow[];
  amArr: AuditMatrixRow[];
  analystArr: AuditMatrixRow[];
  clientArr: AuditMatrixRow[];
  docArr: AuditMatrixRow[];
  topAnalysts: AuditMatrixRow[];
  topDefaulters: AuditMatrixRow[];
  /** Internal page only (empty on External). */
  regionQuality: RegionQualityRow[];
  notes: string[];
}

export type SlaClass = "miss" | "notMiss" | "unknown";

export interface TrailFactRow {
  date: string;
  slaStatus: string;
  tasks: number;
  audits: number;
  errors: number;
}

export interface TrailDailyPoint {
  date: string;
  label: string;
  miss: number;
  notMiss: number;
  total: number;
  tasks: number;
  audits: number;
  errors: number;
  errorPct: number;
}

export interface TrailDetailRow {
  date: string;
  dateLabel: string;
  analystEmail: string;
  clientName: string;
  manualProcessingTime: number | null;
  tat10Pct: number | null;
  tat30Pct: number | null;
  slaStatus: string;
  tlName: string;
  amName: string;
  status: string;
  reason: string;
  secondLevel: string;
}

export interface TrailCards {
  total: number;
  miss: number;
  notMiss: number;
  missPct: number;
}

export interface PoaTrailPage {
  filters: ResolvedPoaFilters;
  cards: TrailCards;
  dailyArr: TrailDailyPoint[];
  detailRows: TrailDetailRow[];
  notes: string[];
}

// ── Pure helpers ────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_WINDOW_DAYS = 90;
export const TOP_ANALYST_LIMIT = 10;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

/** "2026-07-06" -> "06-Jul-26" (the reference's dateLbl). Non-ISO input is returned unchanged. */
export function formatDateLabel(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}-${MONTHS[Number(m) - 1] ?? m}-${y.slice(2)}`;
}

/** Monday (week commencing) of the week containing an ISO date, as ISO. Pure UTC maths, no host-timezone. */
export function weekCommencingIso(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const daysSinceMonday = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - daysSinceMonday);
  return t.toISOString().slice(0, 10);
}

/** Week-commencing display label for an ISO date, e.g. "2026-07-31" -> "27-Jul-26". */
export function weekCommencingLabel(iso: string): string {
  return formatDateLabel(weekCommencingIso(iso));
}

/** Fills the derived percentage columns of one matrix row. */
export function finalizeMatrixRow(input: AuditMatrixInput, isGrandTotal = false): AuditMatrixRow {
  const errorBase = input.errorBase ?? input.totalQc;
  const row: AuditMatrixRow = {
    particular: input.label,
    sortKey: input.sortKey ?? input.label,
    totalQc: input.totalQc,
    errors: input.errors,
    errorBase,
    errorPct: pct(input.errors, errorBase),
    classificationError: input.classificationError,
    classificationPct: pct(input.classificationError, input.totalQc),
    extractionError: input.extractionError,
    extractionPct: pct(input.extractionError, input.totalQc),
    comparisonError: input.comparisonError,
    comparisonPct: pct(input.comparisonError, input.totalQc),
  };
  return isGrandTotal ? { ...row, isGrandTotal: true } : row;
}

export function sumMatrixInputs(inputs: readonly AuditMatrixInput[], label = "Grand Total"): AuditMatrixInput {
  return inputs.reduce<AuditMatrixInput>(
    (acc, x) => ({
      label,
      totalQc: acc.totalQc + x.totalQc,
      errors: acc.errors + x.errors,
      errorBase: (acc.errorBase ?? 0) + (x.errorBase ?? x.totalQc),
      classificationError: acc.classificationError + x.classificationError,
      extractionError: acc.extractionError + x.extractionError,
      comparisonError: acc.comparisonError + x.comparisonError,
    }),
    { label, totalQc: 0, errors: 0, errorBase: 0, classificationError: 0, extractionError: 0, comparisonError: 0 },
  );
}

const compareRanked = (a: AuditMatrixRow, b: AuditMatrixRow): number =>
  b.errors - a.errors || b.errorPct - a.errorPct || b.totalQc - a.totalQc || a.particular.localeCompare(b.particular);

/**
 * Reference auditMatrixRows_: Date / WC tables sort chronologically by sortKey,
 * every other table sorts by errors desc, error % desc, volume desc, name asc.
 * A Grand Total row is appended (last) when there is at least one row.
 */
export function buildMatrixRows(
  inputs: readonly AuditMatrixInput[],
  mode: "chronological" | "ranked",
  addGrandTotal = true,
): AuditMatrixRow[] {
  const kept = inputs.filter((x) => x.label !== "" || x.totalQc > 0 || x.errors > 0);
  const rows = kept.map((x) => finalizeMatrixRow(x));
  rows.sort(mode === "chronological" ? (a, b) => a.sortKey.localeCompare(b.sortKey) : compareRanked);
  if (addGrandTotal && rows.length > 0) rows.push(finalizeMatrixRow(sumMatrixInputs(kept), true));
  return rows;
}

/**
 * Reference topAuditAnalysts_. Top 10 Analyst = lowest error % first; Top 10
 * Defaulter = most errors first. Analysts with no volume or the "Blank" bucket
 * are excluded. Grand Total is never included.
 */
export function topAnalysts(inputs: readonly AuditMatrixInput[], defaulter: boolean): AuditMatrixRow[] {
  const rows = buildMatrixRows(inputs, "ranked", false).filter(
    (r) => r.totalQc > 0 && r.particular.toLowerCase() !== "blank",
  );
  rows.sort(
    defaulter
      ? (a, b) => b.errors - a.errors || b.errorPct - a.errorPct || b.totalQc - a.totalQc
      : (a, b) => a.errorPct - b.errorPct || a.errors - b.errors || b.totalQc - a.totalQc,
  );
  return rows.slice(0, TOP_ANALYST_LIMIT);
}

export function computeAuditCards(inputs: readonly AuditMatrixInput[]): AuditCards {
  const t = sumMatrixInputs(inputs);
  const base = t.errorBase ?? 0;
  const errorRate = pct(t.errors, base);
  return {
    sample: base,
    errors: t.errors,
    // No audits yet -> 0 (not a misleading 100%) so the card reads as "no data".
    accuracy: base > 0 ? 100 - errorRate : 0,
    errorRate,
    classificationError: t.classificationError,
    extractionError: t.extractionError,
    comparisonError: t.comparisonError,
  };
}

export function buildChartPoints(daily: readonly AuditMatrixRow[]): AuditChartPoint[] {
  return daily
    .filter((r) => !r.isGrandTotal)
    .map((r) => ({
      date: r.sortKey,
      label: r.particular,
      audits: r.errorBase,
      errors: r.errors,
      errorPct: r.errorPct,
    }));
}

/**
 * Region for the Internal "Day Wise - EU / CA / US" table. The data carries an
 * ISO-3 issuing country, not a region: USA -> US, CAN -> CA, everything else
 * (including blank) -> EU. The assumption is shown in the UI subtitle.
 */
export function regionFromCountry(country: string | null | undefined): Region {
  const c = (country ?? "").trim().toUpperCase();
  if (c === "USA" || c === "US") return "US";
  if (c === "CAN" || c === "CA") return "CA";
  return "EU";
}

export interface RegionFact {
  date: string;
  country: string | null;
  qc: number;
  errors: number;
}

type RegionCells = Record<Region, { qc: number; err: number }>;
const emptyRegionCells = (): RegionCells => ({ EU: { qc: 0, err: 0 }, CA: { qc: 0, err: 0 }, US: { qc: 0, err: 0 } });

function toRegionRow(date: string, label: string, b: RegionCells, isGrandTotal: boolean): RegionQualityRow {
  const totalQc = b.EU.qc + b.CA.qc + b.US.qc;
  const totalError = b.EU.err + b.CA.err + b.US.err;
  const row: RegionQualityRow = {
    date, dateLabel: label,
    euQc: b.EU.qc, euError: b.EU.err, euErrorPct: pct(b.EU.err, b.EU.qc),
    caQc: b.CA.qc, caError: b.CA.err, caErrorPct: pct(b.CA.err, b.CA.qc),
    usQc: b.US.qc, usError: b.US.err, usErrorPct: pct(b.US.err, b.US.qc),
    totalQc, totalError, totalErrorPct: pct(totalError, totalQc),
  };
  return isGrandTotal ? { ...row, isGrandTotal: true } : row;
}

export function buildRegionRows(facts: readonly RegionFact[]): RegionQualityRow[] {
  const byDate = new Map<string, RegionCells>();
  for (const f of facts) {
    const cells = byDate.get(f.date) ?? emptyRegionCells();
    const cell = cells[regionFromCountry(f.country)];
    cell.qc += f.qc;
    cell.err += f.errors;
    byDate.set(f.date, cells);
  }
  if (byDate.size === 0) return [];
  const rows = [...byDate.keys()].sort().map((d) => toRegionRow(d, formatDateLabel(d), byDate.get(d)!, false));
  const grand = emptyRegionCells();
  for (const cells of byDate.values()) {
    for (const r of ["EU", "CA", "US"] as const) {
      grand[r].qc += cells[r].qc;
      grand[r].err += cells[r].err;
    }
  }
  return [...rows, toRegionRow("Grand Total", "Grand Total", grand, true)];
}

export type ExternalErrorBucket = "classification" | "extraction" | "comparison" | "other";

/**
 * Splits an External error (error_yes_no = 'Yes') into the reference's three
 * error types. Mapping derived from the real distinct Reason / 2nd-level values
 * in "POA External Data till 7-Sep-26.xlsx" (146 error rows):
 *   Reason "Classification"                        -> classification (Incorrect / Unsupported document type, country)
 *   Reason "Extraction Error"                      -> extraction     (Address, Issuing date, Issuer name, First/Last name, Expiry ...)
 *   Reason "Data Comparison"                       -> comparison     (Address, First Name)
 *   Any other Reason falls back to the 2nd level:
 *     "incorrect / unsupported / document type"    -> classification (e.g. "Other Language || Incorrect document type")
 *     "comparison"                                 -> comparison
 *     "issue/issuing date, issuer, expiry, address" -> extraction
 *   Everything else (Possible fraud, Image Quality) -> "other": counted in Error
 *   but in none of the three error-type columns.
 * Matching is case-insensitive ("Extraction error" / "Extraction Error" both occur).
 */
export function classifyExternalError(reason: string | null | undefined, secondLevel: string | null | undefined): ExternalErrorBucket {
  const r = (reason ?? "").trim().toLowerCase();
  const s = (secondLevel ?? "").trim().toLowerCase();
  if (r.includes("classification")) return "classification";
  if (r.includes("comparison")) return "comparison";
  if (r.includes("extraction")) return "extraction";
  if (/incorrect|unsupported|document type/.test(s)) return "classification";
  if (s.includes("comparison")) return "comparison";
  if (/issu|expiry|address/.test(s)) return "extraction";
  return "other";
}

export interface ExternalGroupRow {
  label: string;
  sortKey?: string;
  reason: string | null;
  secondLevel: string | null;
  audits: number;
  errors: number;
}

/** Merges SQL groups (label x reason x 2nd level) into one input per label, splitting errors by bucket. */
export function buildExternalInputs(rows: readonly ExternalGroupRow[]): AuditMatrixInput[] {
  const byLabel = new Map<string, AuditMatrixInput>();
  for (const row of rows) {
    const cur = byLabel.get(row.label) ?? {
      label: row.label, sortKey: row.sortKey, totalQc: 0, errors: 0,
      classificationError: 0, extractionError: 0, comparisonError: 0,
    };
    const bucket = row.errors > 0 ? classifyExternalError(row.reason, row.secondLevel) : "other";
    byLabel.set(row.label, {
      ...cur,
      totalQc: cur.totalQc + row.audits,
      errors: cur.errors + row.errors,
      classificationError: cur.classificationError + (bucket === "classification" ? row.errors : 0),
      extractionError: cur.extractionError + (bucket === "extraction" ? row.errors : 0),
      comparisonError: cur.comparisonError + (bucket === "comparison" ? row.errors : 0),
    });
  }
  return [...byLabel.values()];
}

/**
 * Trail SLA classification from the trial table's own "SLA" column, which holds
 * "Less Then 10 Min" / "Less Then 30 Min" / "Greater than 30 Min".
 * Miss SLA = "Greater than 30 Min" (report TaT beyond the 30-minute SLA);
 * Not Miss SLA = either "Less Then" bucket. Blank/other -> unknown (not counted).
 */
export function classifySla(slaText: string | null | undefined): SlaClass {
  const s = (slaText ?? "").trim().toLowerCase();
  if (s === "") return "unknown";
  if (s.startsWith("greater") || s.startsWith("more") || s.startsWith("above") || s.includes(">")) return "miss";
  if (s.startsWith("less") || s.includes("<")) return "notMiss";
  return "unknown";
}

/** "100.00%" -> 100 ; "" / junk -> null. */
export function parsePercentText(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace("%", "").replace(/,/g, "").trim();
  if (s === "" || s.toLowerCase() === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function buildTrailDaily(facts: readonly TrailFactRow[]): TrailDailyPoint[] {
  const byDate = new Map<string, TrailDailyPoint>();
  for (const f of facts) {
    const cur = byDate.get(f.date) ?? {
      date: f.date, label: formatDateLabel(f.date), miss: 0, notMiss: 0, total: 0,
      tasks: 0, audits: 0, errors: 0, errorPct: 0,
    };
    const cls = classifySla(f.slaStatus);
    byDate.set(f.date, {
      ...cur,
      miss: cur.miss + (cls === "miss" ? 1 : 0),
      notMiss: cur.notMiss + (cls === "notMiss" ? 1 : 0),
      total: cur.total + (cls === "unknown" ? 0 : 1),
      tasks: cur.tasks + f.tasks,
      audits: cur.audits + f.audits,
      errors: cur.errors + f.errors,
    });
  }
  return [...byDate.values()]
    .map((p) => ({ ...p, errorPct: pct(p.errors, p.audits) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function computeTrailCards(daily: readonly TrailDailyPoint[]): TrailCards {
  const miss = daily.reduce((s, d) => s + d.miss, 0);
  const notMiss = daily.reduce((s, d) => s + d.notMiss, 0);
  const total = miss + notMiss;
  return { total, miss, notMiss, missPct: pct(miss, total) };
}

/** Date-range defaults (trailing 90 days) + ISO validation. Host-local calendar date, like the sibling service. */
export function resolveFilters(raw: PoaPageFilters, today: Date = new Date()): ResolvedPoaFilters {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const start = new Date(today);
  start.setDate(start.getDate() - DEFAULT_WINDOW_DAYS);
  return {
    from: raw.from && ISO_DATE.test(raw.from) ? raw.from : iso(start),
    to: raw.to && ISO_DATE.test(raw.to) ? raw.to : iso(today),
    tlName: raw.tlName?.trim() ? raw.tlName.trim() : null,
    amName: raw.amName?.trim() ? raw.amName.trim() : null,
  };
}

// ── SQL ─────────────────────────────────────────────────────────────────────

const DATE_COL = "report_completed_date";
const ISO_DATE_SQL = `DATE_FORMAT(${DATE_COL}, '%Y-%m-%d')`;
const WEEK_START_SQL = `DATE_FORMAT(DATE_SUB(${DATE_COL}, INTERVAL WEEKDAY(${DATE_COL}) DAY), '%Y-%m-%d')`;
const jsonText = (key: string) => `JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."${key}"'))`;
const labelOrBlank = (expr: string) => `COALESCE(NULLIF(TRIM(${expr}), ''), 'Blank')`;

/** Normalises whatever the driver returns for a date-ish value into YYYY-MM-DD (host-local getters, see dateBucketToIso in the sibling service). */
function isoText(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return String(v ?? "").slice(0, 10);
}

function scope(f: ResolvedPoaFilters): { where: string; params: string[] } {
  const parts = [`${DATE_COL} BETWEEN ? AND ?`];
  const params = [f.from, f.to];
  if (f.tlName) { parts.push("tl_name = ?"); params.push(f.tlName); }
  if (f.amName) { parts.push("am_name = ?"); params.push(f.amName); }
  return { where: parts.join(" AND "), params };
}

type DimensionKey = "dailyArr" | "weeklyArr" | "tlArr" | "amArr" | "analystArr" | "clientArr" | "docArr";
interface Dimension { key: DimensionKey; expr: string }
type DimensionInputs = Record<DimensionKey, AuditMatrixInput[]>;

function assemblePage(
  filters: ResolvedPoaFilters,
  inputs: DimensionInputs,
  regionQuality: RegionQualityRow[],
  notes: string[],
): PoaAuditPage {
  // Date / WC buckets arrive as ISO keys; the visible label is dd-Mon-yy, the sort key stays ISO.
  const relabel = (xs: AuditMatrixInput[]) => xs.map((x) => ({ ...x, sortKey: x.label, label: formatDateLabel(x.label) }));
  const dailyArr = buildMatrixRows(relabel(inputs.dailyArr), "chronological");
  return {
    filters,
    cards: computeAuditCards(inputs.dailyArr),
    chartDaily: buildChartPoints(dailyArr),
    dailyArr,
    weeklyArr: buildMatrixRows(relabel(inputs.weeklyArr), "chronological"),
    tlArr: buildMatrixRows(inputs.tlArr, "ranked"),
    amArr: buildMatrixRows(inputs.amArr, "ranked"),
    analystArr: buildMatrixRows(inputs.analystArr, "ranked"),
    clientArr: buildMatrixRows(inputs.clientArr, "ranked"),
    docArr: buildMatrixRows(inputs.docArr, "ranked"),
    topAnalysts: topAnalysts(inputs.analystArr, false),
    topDefaulters: topAnalysts(inputs.analystArr, true),
    regionQuality,
    notes,
  };
}

function zipDimensions(dims: Dimension[], results: AuditMatrixInput[][]): DimensionInputs {
  return Object.fromEntries(dims.map((d, i) => [d.key, results[i]])) as DimensionInputs;
}

// ── Internal ────────────────────────────────────────────────────────────────

const INTERNAL_DIMENSIONS: Dimension[] = [
  { key: "dailyArr", expr: ISO_DATE_SQL },
  { key: "weeklyArr", expr: WEEK_START_SQL },
  { key: "tlArr", expr: labelOrBlank("tl_name") },
  { key: "amArr", expr: labelOrBlank("am_name") },
  { key: "analystArr", expr: labelOrBlank("analyst_email") },
  { key: "clientArr", expr: labelOrBlank(jsonText("Client - IMS IMS Client Name")) },
  // "Document Type" in the QC export holds English / Non English.
  { key: "docArr", expr: labelOrBlank(jsonText("Document Type")) },
];

async function queryInternalDimension(expr: string, f: ResolvedPoaFilters): Promise<AuditMatrixInput[]> {
  const pool = await getOnfidoPool();
  const { where, params } = scope(f);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS label,
            COALESCE(SUM(total_qc), 0) AS qc,
            COALESCE(SUM(error_count), 0) AS err,
            COALESCE(SUM(error_count), 0) + COALESCE(SUM(no_error_count), 0) AS base,
            COALESCE(SUM(classification_error), 0) AS cl,
            COALESCE(SUM(extraction_error), 0) AS ex,
            COALESCE(SUM(data_comparison_error), 0) AS dc
       FROM onfido_poa_quality_raw WHERE ${where} GROUP BY label`,
    params,
  );
  return rows.map((r) => ({
    label: String(r.label ?? ""),
    totalQc: num(r.qc),
    errors: num(r.err),
    errorBase: num(r.base),
    classificationError: num(r.cl),
    extractionError: num(r.ex),
    comparisonError: num(r.dc),
  }));
}

async function queryRegionFacts(f: ResolvedPoaFilters): Promise<RegionFact[]> {
  const pool = await getOnfidoPool();
  const { where, params } = scope(f);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ISO_DATE_SQL} AS d, ${jsonText("Report Properties Proof of Address Issuing Country")} AS country,
            COALESCE(SUM(total_qc), 0) AS qc, COALESCE(SUM(error_count), 0) AS err
       FROM onfido_poa_quality_raw WHERE ${where} GROUP BY d, country`,
    params,
  );
  return rows.map((r) => ({
    date: isoText(r.d),
    country: r.country === null || r.country === undefined ? null : String(r.country),
    qc: num(r.qc),
    errors: num(r.err),
  }));
}

export async function getPoaInternalPage(raw: PoaPageFilters): Promise<PoaAuditPage> {
  const filters = resolveFilters(raw);
  await getOnfidoPool(); // warm the pool once so the parallel queries below share it
  const [results, regionFacts] = await Promise.all([
    Promise.all(INTERNAL_DIMENSIONS.map((d) => queryInternalDimension(d.expr, filters))),
    queryRegionFacts(filters),
  ]);
  return assemblePage(filters, zipDimensions(INTERNAL_DIMENSIONS, results), buildRegionRows(regionFacts), []);
}

// ── External ────────────────────────────────────────────────────────────────

const EXTERNAL_AUDITED = "UPPER(TRIM(error_yes_no)) IN ('YES', 'NO')";
const EXTERNAL_DIMENSIONS: Dimension[] = [
  { key: "dailyArr", expr: ISO_DATE_SQL },
  { key: "weeklyArr", expr: WEEK_START_SQL },
  { key: "tlArr", expr: labelOrBlank("tl_name") },
  { key: "amArr", expr: labelOrBlank("am_name") },
  { key: "analystArr", expr: labelOrBlank("analyst_email") },
  { key: "clientArr", expr: labelOrBlank("ims_client_name") },
  { key: "docArr", expr: labelOrBlank("COALESCE(NULLIF(TRIM(poa_document_type), ''), document_type_full_name)") },
];

async function queryExternalDimension(expr: string, f: ResolvedPoaFilters): Promise<AuditMatrixInput[]> {
  const pool = await getOnfidoPool();
  const { where, params } = scope(f);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS label, reason, second_level,
            COUNT(*) AS audits,
            SUM(CASE WHEN UPPER(TRIM(error_yes_no)) = 'YES' THEN 1 ELSE 0 END) AS errors
       FROM onfido_poa_external_raw
      WHERE ${where} AND ${EXTERNAL_AUDITED}
      GROUP BY label, reason, second_level`,
    params,
  );
  return buildExternalInputs(
    rows.map((r) => ({
      label: String(r.label ?? ""),
      reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
      secondLevel: r.second_level === null || r.second_level === undefined ? null : String(r.second_level),
      audits: num(r.audits),
      errors: num(r.errors),
    })),
  );
}

export async function getPoaExternalPage(raw: PoaPageFilters): Promise<PoaAuditPage> {
  const filters = resolveFilters(raw);
  await getOnfidoPool(); // warm the pool once so the parallel queries below share it
  const results = await Promise.all(EXTERNAL_DIMENSIONS.map((d) => queryExternalDimension(d.expr, filters)));
  const inputs = zipDimensions(EXTERNAL_DIMENSIONS, results);
  const notes = inputs.dailyArr.length === 0
    ? ["No POA External audit rows (Yes / No) found for the selected filters. Total Audits counts only Yes + No; Error counts only Yes."]
    : [];
  return assemblePage(filters, inputs, [], notes);
}

// ── Trail ───────────────────────────────────────────────────────────────────

const TRAIL_ROW_LIMIT = 5000;

const trailInt = (v: unknown): number => Math.max(0, Math.round(num(v)));
const trailText = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s.toLowerCase() === "null" ? "" : s;
};

export async function getPoaTrailPage(raw: PoaPageFilters): Promise<PoaTrailPage> {
  const filters = resolveFilters(raw);
  const pool = await getOnfidoPool();
  const { where, params } = scope(filters);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ISO_DATE_SQL} AS d, analyst_email, tl_name, am_name, manual_processing_time_secs AS mp,
            ${jsonText("Client - IMS IMS Client Name")} AS client,
            ${jsonText("SLA")} AS sla, ${jsonText("Status")} AS status,
            ${jsonText("Reason")} AS reason, ${jsonText("2nd level")} AS second_level,
            ${jsonText("Report % Report TaT < 10m")} AS tat10, ${jsonText("Report % Report TaT < 30m")} AS tat30,
            ${jsonText("Total Task")} AS tasks, ${jsonText("Audits")} AS audits, ${jsonText("Error")} AS errors
       FROM onfido_poa_trial_raw WHERE ${where}
      ORDER BY d, analyst_email LIMIT ${TRAIL_ROW_LIMIT}`,
    params,
  );

  const facts: TrailFactRow[] = rows.map((r) => ({
    date: isoText(r.d),
    slaStatus: trailText(r.sla),
    tasks: trailInt(r.tasks),
    audits: trailInt(r.audits),
    errors: trailInt(r.errors),
  }));
  const detailRows: TrailDetailRow[] = rows.map((r) => ({
    date: isoText(r.d),
    dateLabel: formatDateLabel(isoText(r.d)),
    analystEmail: trailText(r.analyst_email),
    clientName: trailText(r.client),
    manualProcessingTime: r.mp === null || r.mp === undefined ? null : num(r.mp),
    tat10Pct: parsePercentText(r.tat10),
    tat30Pct: parsePercentText(r.tat30),
    slaStatus: trailText(r.sla),
    tlName: trailText(r.tl_name),
    amName: trailText(r.am_name),
    status: trailText(r.status),
    reason: trailText(r.reason),
    secondLevel: trailText(r.second_level),
  }));
  const dailyArr = buildTrailDaily(facts);
  const notes = rows.length >= TRAIL_ROW_LIMIT ? [`Detail table capped at ${TRAIL_ROW_LIMIT.toLocaleString("en-IN")} rows.`] : [];
  return { filters, cards: computeTrailCards(dailyArr), dailyArr, detailRows, notes };
}
