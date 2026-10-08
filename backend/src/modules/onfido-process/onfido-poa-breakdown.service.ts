/**
 * POA Internal / External breakdown tables (TL / AM / AON / Client / Document wise).
 *
 * Internal: workload + AHT from onfido_poa_raw, error % from onfido_poa_quality_raw
 *   (SUM(error_count) / (SUM(error_count) + SUM(no_error_count)) — same rule as getPoaBreakdown).
 *   Neither table has an AON column: onfido_poa_raw carries it only inside raw_data ("AON"), and
 *   onfido_poa_quality_raw not at all, so AON error % is attributed through the analyst's AON.
 * External: everything from onfido_poa_external_raw (aon_bucket, ims_client_name, tl_name, am_name,
 *   poa_document_type / document_type_full_name are real columns there).
 */
import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import {
  buildAnalystAonMap,
  mergePoaInternalBreakdown,
  normaliseAon,
  normaliseAonVolume,
  qualityByAon,
  sortAonRows,
  type PoaBreakdownOut,
} from "./onfido-poa-breakdown.pure.js";
import { readFilters, tlAmFilter } from "./onfido-process-dashboard.service.js";

export type PoaInternalBreakdownDimension = "tl_name" | "am_name" | "aon" | "client";
export type PoaExternalBreakdownDimension =
  | "ims_client_name"
  | "tl_name"
  | "am_name"
  | "aon"
  | "document";

export const POA_INTERNAL_BREAKDOWN_DIMENSIONS = new Set<string>(["tl_name", "am_name", "aon", "client"]);
export const POA_EXTERNAL_BREAKDOWN_DIMENSIONS = new Set<string>([
  "ims_client_name",
  "tl_name",
  "am_name",
  "aon",
  "document",
]);

export interface PoaBreakdownFilters {
  from?: string;
  to?: string;
  tlName?: string;
  amName?: string;
}

const blank = (expr: string) => `COALESCE(NULLIF(TRIM(${expr}), ''), '(unassigned)')`;
const jsonKey = (key: string) => `JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."${key}"'))`;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function getPoaInternalBreakdown(
  rawFilters: PoaBreakdownFilters,
  dimension: PoaInternalBreakdownDimension,
): Promise<PoaBreakdownOut[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const base = [f.from, f.to, ...params];

  const volQuery = (labelExpr: string) =>
    pool.query<RowDataPacket[]>(
      `SELECT ${labelExpr} AS label, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
         FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY label`,
      base,
    );
  const qualQuery = (labelExpr: string) =>
    pool.query<RowDataPacket[]>(
      `SELECT ${labelExpr} AS label, SUM(error_count) AS errN, SUM(no_error_count) AS noErrN
         FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} GROUP BY label`,
      base,
    );
  const toVol = (rows: RowDataPacket[]) =>
    rows.map((r) => ({
      label: String(r.label),
      n: num(r.n),
      aht: r.aht === null || r.aht === undefined ? null : num(r.aht),
    }));
  const toQual = (rows: RowDataPacket[]) =>
    rows.map((r) => ({ label: String(r.label), errors: num(r.errN), noErrors: num(r.noErrN) }));

  if (dimension === "aon") {
    const [[volRows], [analystAon], [qualRows]] = await Promise.all([
      volQuery(blank(jsonKey("AON"))),
      pool.query<RowDataPacket[]>(
        `SELECT analyst_email AS analyst, ${blank(jsonKey("AON"))} AS aon, COUNT(*) AS n
           FROM onfido_poa_raw
          WHERE report_completed_date BETWEEN ? AND ? ${clause}
            AND analyst_email IS NOT NULL AND analyst_email <> ''
          GROUP BY analyst_email, aon`,
        base,
      ),
      pool.query<RowDataPacket[]>(
        `SELECT analyst_email AS analyst, SUM(error_count) AS errN, SUM(no_error_count) AS noErrN
           FROM onfido_poa_quality_raw
          WHERE report_completed_date BETWEEN ? AND ? ${clause}
            AND analyst_email IS NOT NULL AND analyst_email <> ''
          GROUP BY analyst_email`,
        base,
      ),
    ]);
    const map = buildAnalystAonMap(
      analystAon.map((r) => ({ analyst: String(r.analyst), aon: String(r.aon), n: num(r.n) })),
    );
    const merged = mergePoaInternalBreakdown(
      normaliseAonVolume(toVol(volRows)),
      qualityByAon(
        qualRows.map((r) => ({ analyst: String(r.analyst), errors: num(r.errN), noErrors: num(r.noErrN) })),
        map,
      ),
      200,
    );
    return sortAonRows(merged);
  }

  const volExpr = dimension === "client" ? blank("ims_client_name") : blank(dimension);
  const qualExpr =
    dimension === "client" ? blank(jsonKey("Client - IMS IMS Client Name")) : blank(dimension);
  const [[volRows], [qualRows]] = await Promise.all([volQuery(volExpr), qualQuery(qualExpr)]);
  return mergePoaInternalBreakdown(toVol(volRows), toQual(qualRows), dimension === "client" ? 100 : 50);
}

export async function getPoaExternalBreakdownV2(
  rawFilters: PoaBreakdownFilters,
  dimension: PoaExternalBreakdownDimension,
): Promise<PoaBreakdownOut[]> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const expr =
    dimension === "aon"
      ? blank("aon_bucket")
      : dimension === "document"
        ? blank("COALESCE(NULLIF(TRIM(poa_document_type), ''), document_type_full_name)")
        : blank(dimension);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${expr} AS label, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht,
            COALESCE(SUM(error_flag), 0) AS errors
       FROM onfido_poa_external_raw WHERE report_completed_date BETWEEN ? AND ? ${clause}
      GROUP BY label`,
    [f.from, f.to, ...params],
  );
  type Acc = { n: number; ahtSum: number; ahtN: number; err: number };
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const label = dimension === "aon" ? normaliseAon(String(r.label) === "(unassigned)" ? "" : String(r.label)) : String(r.label);
    const e = acc.get(label) ?? { n: 0, ahtSum: 0, ahtN: 0, err: 0 };
    const n = num(r.n);
    e.n += n;
    e.err += num(r.errors);
    if (r.aht !== null && r.aht !== undefined) {
      e.ahtSum += num(r.aht) * n;
      e.ahtN += n;
    }
    acc.set(label, e);
  }
  const out = [...acc.entries()].map(([label, e]): PoaBreakdownOut => ({
    label,
    taskCount: e.n,
    avgAht: e.ahtN > 0 ? Math.round(e.ahtSum / e.ahtN) : null,
    errorRate: e.n > 0 ? Math.round((e.err / e.n) * 1000) / 10 : null,
  }));
  if (dimension === "aon") return sortAonRows(out);
  return out.sort((a, b) => b.taskCount - a.taskCount).slice(0, dimension === "document" ? 200 : 50);
}
