import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { markRowsImported } from "./batch-row-status.js";
import { ingestReceived } from "../bla-bli-blu-dashboard/bbb-uploads.service.js";
import { cleanText, parseDate, parseNullableInt } from "./bla-bli-blu-overall-sales-bulk.service.js";

/**
 * Bla Bli Blu abandon-cart "Received Data" sheet (BLA_BLI_BLU_Dashboard_Calculation workbook): the daily data
 * allocation the BLA / BLI / BLU Sales Dashboard reads for Fresh Base, Workable, DND, attempts and connects.
 * Lands in bla_dash_received. One row per date + mobile number (a repeat for the same date is rejected as a duplicate),
 * Fresh / NC derived from the previous 1-3 days, one trashable batch per file: see bbb-uploads.service.ts.
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

  // The same rules as the dashboard's own uploader (one row per date + number, Fresh/NC derived, one batch per
  // file): both paths call ingestReceived so they cannot drift apart.
  const incoming = batchRows.map((row) => {
    const data = typeof row.normalized_data === "string"
      ? JSON.parse(row.normalized_data)
      : ((row.normalized_data ?? {}) as Record<string, unknown>);
    return {
      date: parseDate(pick(data, "Date")),
      phone: pick(data, "Phone", "Mobile", "Mobile Number", "Customer Number", "Customer Mobile"),
      lob: cleanText(pick(data, "LOB")),
      sourceDataType: cleanText(pick(data, "Data Type", "Data_Type")),
      workable: cleanText(pick(data, "Workable")),
      callAnswer: cleanText(pick(data, "Call Answer With in Same Day", "Call Answer Within Same Day")),
      sameDayAttempt: Math.max(0, parseNullableInt(pick(data, "Same Day Attempt")) ?? 0),
      finalDispo: cleanText(pick(data, "Final Dispo")),
      empId: cleanText(pick(data, "Emp Id", "Emp ID", "EMP_ID")),
      empName: cleanText(pick(data, "Emp Name", "Emp_Name")),
    };
  });
  const result = await ingestReceived(incoming, batchId, importedByUserId);
  const reject = (indexes: number[], reason: (rowNo: number) => string) => {
    for (const i of indexes) { const r = batchRows[i]; const msg = reason(r.row_no); errors.push(msg); errorUpdates.push({ rowId: r.id, message: msg }); }
  };
  reject(result.noDateIndexes, (n) => `Row ${n}: "Date" is required`);
  reject(result.noNumberIndexes, (n) => `Row ${n}: a 10-digit mobile number is required (it is what makes a row unique for its date)`);
  reject(result.duplicateIndexes, (n) => `Row ${n}: this number is already uploaded for this date, so it was not added again`);

  const rejected = new Set(errorUpdates.map((e) => e.rowId));
  const importedRows = result.inserted;
  const errorRows = errorUpdates.length;
  if (importedRows > 0) await markRowsImported(batchRows.filter((r) => !rejected.has(r.id)).map((r) => r.id));
  for (let i = 0; i < errorUpdates.length; i += 500) {
    const part = errorUpdates.slice(i, i + 500);
    const cases = part.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
    const ids = part.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...part.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
    );
  }

  const finalStatus = errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );
  return { importedRows, errorRows, errors: errors.slice(0, 200) };
}
