import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import { buildRecordFilter, resolveTable, tlAmFilter, type RecordListFilters } from "./onfido-process-dashboard.service.js";

/** Hard ceiling so one click can never pull a multi-GB table through the API process. */
export const EXPORT_MAX_ROWS = 100_000;
const CHUNK_ROWS = 2_000;
const JSON_BLOB_COLUMN = "raw_data";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** One CSV cell. Dates print as ISO (local getters - mysql2 returns host-tz Dates), and a
 *  leading = + - @ is neutralised so a spreadsheet never runs a cell from source data as a formula. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) {
    const day = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    const hasTime = value.getHours() + value.getMinutes() + value.getSeconds() > 0;
    text = hasTime ? `${day} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}` : day;
  } else {
    text = String(value);
  }
  if (/^[=+\-@]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

function startCsv(res: Response, filename: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/[^A-Za-z0-9_.-]/g, "_")}"`);
  res.setHeader("Cache-Control", "no-store");
  res.write("\uFEFF"); // BOM so Excel reads UTF-8 names correctly
}

/** Streams a raw table, honouring the same date / TL / AM / drill-down filters as the on-screen list. */
export async function streamRecordsCsv(res: Response, tableKey: string, filters: RecordListFilters): Promise<void> {
  const table = resolveTable(tableKey);
  const pool = await getOnfidoPool();
  const { whereSql, params } = await buildRecordFilter(pool, table, null, filters);

  let header: string[] | null = null;
  let written = 0;
  while (written < EXPORT_MAX_ROWS) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM ${table} ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
      [...params, Math.min(CHUNK_ROWS, EXPORT_MAX_ROWS - written), written]
    );
    if (rows.length === 0) break;
    if (!header) {
      header = Object.keys(rows[0]).filter((c) => c !== JSON_BLOB_COLUMN);
      startCsv(res, `${table}_${filters.from ?? "start"}_${filters.to ?? "end"}.csv`);
      res.write(csvLine(header));
    }
    for (const row of rows) res.write(csvLine(header.map((c) => row[c])));
    written += rows.length;
    if (rows.length < CHUNK_ROWS) break;
  }
  if (!header) {
    startCsv(res, `${table}_empty.csv`);
    res.write("No rows match the selected filters\r\n");
  }
  res.end();
}

/** Analyst-wise attrition: one line per exited analyst in range (same source as the on-screen list, no 500-row cap). */
export async function streamAttritionExitsCsv(
  res: Response, filters: { from?: string; to?: string; tlName?: string; amName?: string }
): Promise<void> {
  const pool = await getOnfidoPool();
  const { clause, params } = tlAmFilter(filters.tlName, filters.amName);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT emp_id, emp_name, analyst_email, tl_name, am_name, work_date AS exit_date, attrition_type, attrition_reason
       FROM onfido_agent_daily_raw WHERE attrition_flag = 1 AND work_date BETWEEN ? AND ? ${clause}
       ORDER BY work_date DESC LIMIT ?`,
    [filters.from ?? "1970-01-01", filters.to ?? "2999-12-31", ...params, EXPORT_MAX_ROWS]
  );
  startCsv(res, `onfido_attrition_${filters.from ?? "start"}_${filters.to ?? "end"}.csv`);
  res.write(csvLine(["Emp ID", "Employee", "Analyst email", "TL", "AM", "Exit date", "Type", "Reason"]));
  for (const r of rows) {
    res.write(csvLine([r.emp_id, r.emp_name, r.analyst_email, r.tl_name, r.am_name, r.exit_date, r.attrition_type, r.attrition_reason]));
  }
  res.end();
}
