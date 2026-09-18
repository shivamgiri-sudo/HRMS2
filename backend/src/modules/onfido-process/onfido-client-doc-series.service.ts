import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import {
  DOC_AHT_AVG,
  DOC_TASK_TYPE_LABEL_EXPR,
  bucketExpr,
  bucketLabel,
  readFilters,
  tlAmFilter,
} from "./onfido-process-dashboard.service.js";

/**
 * Client & Document Report page (2026-09-18 owner feedback): DOC / POA slicer, and for each of
 * "Document-wise" and "Client-wise" a Task Type dropdown ("Task Information Task Type Old"),
 * a Monthly/Weekly slicer, a Task+AHT chart and a ranking table.
 *
 * Task type exists only on DOC rows (it lives in onfido_doc_raw.raw_data); POA has no such field,
 * so the POA queue returns no task-type options and ignores a task-type filter.
 */

export type ClientDocQueue = "DOC" | "POA";
export type ClientDocGroupBy = "document" | "client";
export type ClientDocGranularity = "monthly" | "weekly";

export interface ClientDocSeriesFilters {
  from?: string;
  to?: string;
  tlName?: string;
  amName?: string;
  queue: ClientDocQueue;
  groupBy: ClientDocGroupBy;
  /** Selected document / client; empty = all. */
  value?: string;
  /** Selected task type (DOC only); empty = all. */
  taskType?: string;
}

const QUEUE_SOURCE: Record<ClientDocQueue, { table: string; dateCol: string }> = {
  DOC: { table: "onfido_doc_raw", dateCol: "report_date" },
  POA: { table: "onfido_poa_raw", dateCol: "report_completed_date" },
};

const GROUP_COLUMN: Record<ClientDocGroupBy, string> = {
  document: "document_name",
  client: "ims_client_name",
};

const UNSPECIFIED = "(unspecified)";
const MAX_RANKING_ROWS = 200;
const MAX_OPTIONS = 500;

export interface ClientDocSeriesPoint { bucket: string; taskCount: number; avgAht: number | null }
export interface ClientDocRankingRow { label: string; taskCount: number; avgAht: number | null }

interface SqlPart { clause: string; params: string[] }

function scopeClauses(f: ClientDocSeriesFilters): SqlPart {
  const parts: string[] = [];
  const params: string[] = [];
  const tlAm = tlAmFilter(f.tlName, f.amName);
  if (tlAm.clause) { parts.push(tlAm.clause); params.push(...tlAm.params); }
  if (f.value) {
    const col = GROUP_COLUMN[f.groupBy];
    if (f.value === UNSPECIFIED) parts.push(`AND (${col} IS NULL OR TRIM(${col}) = '')`);
    else { parts.push(`AND ${col} = ?`); params.push(f.value); }
  }
  if (f.queue === "DOC" && f.taskType) {
    parts.push(`AND ${DOC_TASK_TYPE_LABEL_EXPR} = ?`);
    params.push(f.taskType);
  }
  return { clause: parts.join(" "), params };
}

/** AHT expression: the DOC average excludes the labelling task type (owner's rule) unless the user
 *  picked a specific task type — then it is that task type's own plain average. */
function ahtExpr(f: ClientDocSeriesFilters): string {
  if (f.queue === "POA") return "AVG(manual_processing_time_secs)";
  return f.taskType ? "AVG(manual_processing_time_secs)" : DOC_AHT_AVG;
}

const roundAht = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function getClientDocSeries(
  f: ClientDocSeriesFilters,
  granularity: ClientDocGranularity
): Promise<ClientDocSeriesPoint[]> {
  const range = readFilters(f);
  const { table, dateCol } = QUEUE_SOURCE[f.queue];
  const scope = scopeClauses(f);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${bucketExpr(dateCol, granularity)} AS bucket, COUNT(*) AS n, ${ahtExpr(f)} AS aht
       FROM ${table} WHERE ${dateCol} BETWEEN ? AND ? ${scope.clause}
      GROUP BY bucket ORDER BY bucket`,
    [range.from, range.to, ...scope.params]
  );
  return rows.map((r): ClientDocSeriesPoint => ({
    bucket: bucketLabel(r.bucket, granularity),
    taskCount: Number(r.n),
    avgAht: roundAht(r.aht),
  }));
}

/** Every document (or client) with its volume/AHT for the selected queue and task type. The
 *  `value` filter is deliberately ignored here so the table stays a full ranking to pick from. */
export async function getClientDocRanking(f: ClientDocSeriesFilters): Promise<ClientDocRankingRow[]> {
  const range = readFilters(f);
  const { table, dateCol } = QUEUE_SOURCE[f.queue];
  const col = GROUP_COLUMN[f.groupBy];
  const scope = scopeClauses({ ...f, value: undefined });
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(${col}), ''), '${UNSPECIFIED}') AS label, COUNT(*) AS n, ${ahtExpr(f)} AS aht
       FROM ${table} WHERE ${dateCol} BETWEEN ? AND ? ${scope.clause}
      GROUP BY label ORDER BY n DESC LIMIT ${MAX_RANKING_ROWS}`,
    [range.from, range.to, ...scope.params]
  );
  return rows.map((r): ClientDocRankingRow => ({ label: String(r.label), taskCount: Number(r.n), avgAht: roundAht(r.aht) }));
}

/** Real observed task types for the DOC queue in the range — the closed set the dropdown offers. */
export async function getClientDocTaskTypeOptions(
  raw: { from?: string; to?: string; queue: ClientDocQueue }
): Promise<string[]> {
  if (raw.queue !== "DOC") return [];
  const range = readFilters(raw);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${DOC_TASK_TYPE_LABEL_EXPR} AS task_type, COUNT(*) AS n
       FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ?
      GROUP BY task_type HAVING task_type IS NOT NULL ORDER BY n DESC LIMIT ${MAX_OPTIONS}`,
    [range.from, range.to]
  );
  return rows.map((r) => String(r.task_type));
}

/** Real client names for the queue's Client-wise dropdown. */
export async function getClientDocClientOptions(
  raw: { from?: string; to?: string; queue: ClientDocQueue }
): Promise<string[]> {
  const range = readFilters(raw);
  const { table, dateCol } = QUEUE_SOURCE[raw.queue];
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ims_client_name AS label, COUNT(*) AS n FROM ${table}
      WHERE ${dateCol} BETWEEN ? AND ? AND ims_client_name IS NOT NULL AND TRIM(ims_client_name) <> ''
      GROUP BY ims_client_name ORDER BY n DESC LIMIT ${MAX_OPTIONS}`,
    [range.from, range.to]
  );
  return rows.map((r) => String(r.label)).sort((a, b) => a.localeCompare(b));
}

/** Real document names for the queue's Document-wise dropdown. */
export async function getClientDocDocumentOptionsForQueue(
  raw: { from?: string; to?: string; queue: ClientDocQueue }
): Promise<string[]> {
  const range = readFilters(raw);
  const { table, dateCol } = QUEUE_SOURCE[raw.queue];
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT document_name AS label, COUNT(*) AS n FROM ${table}
      WHERE ${dateCol} BETWEEN ? AND ? AND document_name IS NOT NULL AND TRIM(document_name) <> ''
      GROUP BY document_name ORDER BY n DESC LIMIT ${MAX_OPTIONS}`,
    [range.from, range.to]
  );
  return rows.map((r) => String(r.label)).sort((a, b) => a.localeCompare(b));
}
