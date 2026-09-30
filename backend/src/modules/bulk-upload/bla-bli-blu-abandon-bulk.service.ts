import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { markRowsImported } from "./batch-row-status.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";
import { cleanText, parseDate, parseNullableInt } from "./bla-bli-blu-overall-sales-bulk.service.js";

/**
 * Bla Bli Blu abandon-cart "Received Data" sheet (BLA_BLI_BLU_Dashboard_Calculation workbook): the daily data
 * allocation the BLA / BLI / BLU Sales Dashboard reads for Fresh Base, Workable, DND, attempts and connects.
 * Lands in bla_dash_received (migration 1910). That table has no natural key, so re-uploading a date REPLACES that
 * date's rows (the same rule the dashboard page's own uploader applies) instead of appending duplicates.
 */

export const BLA_BLI_BLU_ABANDON_REQUIRED = ["Date", "LOB", "Data Type"] as const;

/** First non-empty value among the header spellings the workbook has used. */
function pick(data: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    const v = data[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importBlaBliBluAbandonBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) {
    const [staged] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ?`, [batchId]);
    if (Number((staged as RowDataPacket[])[0]?.n ?? 0) === 0) {
      await db.execute(
        `UPDATE upload_batch SET batch_status = 'validation_failed',
            error_summary = 'No rows were staged for this batch -- the upload''s row-staging step likely failed or timed out. Re-upload the file.',
            updated_at = NOW()
         WHERE id = ?`,
        [batchId],
      );
    }
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const toInsert: ChunkInsertRow[] = [];
  const dates = new Set<string>();

  for (const row of batchRows) {
    const data = typeof row.normalized_data === "string"
      ? JSON.parse(row.normalized_data)
      : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const reportDate = parseDate(pick(data, "Date"));
    if (!reportDate) {
      const msg = `Row ${row.row_no}: "Date" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    dates.add(reportDate);
    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        batchId, reportDate,
        cleanText(pick(data, "LOB")),
        cleanText(pick(data, "Data Type", "Data_Type")),
        cleanText(pick(data, "Workable")),
        cleanText(pick(data, "Call Answer With in Same Day", "Call Answer Within Same Day")),
        Math.max(0, parseNullableInt(pick(data, "Same Day Attempt")) ?? 0),
        cleanText(pick(data, "Final Dispo")),
        cleanText(pick(data, "Emp Id", "Emp ID", "EMP_ID")),
        cleanText(pick(data, "Emp Name", "Emp_Name")),
        cleanText(pick(data, "Phone")),
        importedByUserId,
      ],
    });
  }

  // Replace, not append: drop the dates this file carries just before inserting them.
  if (toInsert.length > 0 && dates.size > 0) {
    const list = [...dates];
    await db.execute(`DELETE FROM bla_dash_received WHERE report_date IN (${list.map(() => "?").join(",")})`, list);
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO bla_dash_received
           (upload_batch_id, report_date, lob, data_type, workable, call_answer, same_day_attempt,
            final_dispo, emp_id, emp_name, phone, created_by)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    const failed = new Set(inserted.errorUpdates.map((e) => e.rowId));
    await markRowsImported(toInsert.filter((r) => !failed.has(r.rowId)).map((r) => r.rowId));
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

  const finalStatus = errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );
  return { importedRows, errorRows, errors };
}
