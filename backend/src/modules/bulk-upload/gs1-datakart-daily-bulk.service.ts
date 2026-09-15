import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * GS1 India — DataKart task processing daily actuals.
 *
 * Each row captures one analyst's DataKart task activity for a given day:
 * task count, GTINs touched, whether the TAT target was met, actual TAT,
 * and the process type (e.g. New, Amendment, Image-only).
 *
 * Upload type: GS1_DATAKART_DAILY
 * Target table: gs1_datakart_daily_actual
 * UNIQUE key: (process_id, report_date, analyst_name, task_date)
 */

export const GS1_DATAKART_DAILY_HEADERS = [
  "Report Date",
  "Analyst Name",
  "Task Date",
  "Task Count",
  "GTIN Count",
  "Within TAT",
  "TAT Minutes",
  "Process Type",
] as const;

export function parseDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export function parseCount(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export function parseDecimal(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function parseWithinTat(raw: unknown): number {
  const v = String(raw ?? "").trim().toUpperCase();
  return v === "YES" || v === "1" || v === "TRUE" ? 1 : 0;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importGs1DatakartDailyBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name LIKE '%GS1%' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    if (!processId) {
      const msg = `Row ${row.row_no}: no active GS1 process found in process_master`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const reportDate = parseDate(data["Report Date"]);
    if (!reportDate) {
      const msg = `Row ${row.row_no}: "Report Date" is required and could not be parsed`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const analystName = String(data["Analyst Name"] ?? "").trim();
    if (!analystName) {
      const msg = `Row ${row.row_no}: "Analyst Name" is required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const taskDate = parseDate(data["Task Date"]);
    if (!taskDate) {
      const msg = `Row ${row.row_no}: "Task Date" is required and could not be parsed`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    try {
      await db.execute(
        `INSERT INTO gs1_datakart_daily_actual
           (id, process_id, report_date, analyst_name, task_date,
            task_count, gtin_count, within_tat, tat_minutes, process_type,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            task_count   = VALUES(task_count),
            gtin_count   = VALUES(gtin_count),
            within_tat   = VALUES(within_tat),
            tat_minutes  = VALUES(tat_minutes),
            process_type = VALUES(process_type)`,
        [
          randomUUID(), processId, reportDate, analystName, taskDate,
          parseCount(data["Task Count"]),
          parseCount(data["GTIN Count"]),
          parseWithinTat(data["Within TAT"]),
          parseDecimal(data["TAT Minutes"]),
          String(data["Process Type"] ?? "").trim() || null,
          batchId,
          importedByUserId,
        ] as never[],
      );
      importedRows++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${row.row_no}: ${msg}`);
      errorUpdates.push({ rowId: row.id, message: msg.slice(0, 500) });
      errorRows++;
    }
  }

  if (errorUpdates.length) {
    const cases = errorUpdates.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
    );
  }

  return { importedRows, errorRows, errors };
}
