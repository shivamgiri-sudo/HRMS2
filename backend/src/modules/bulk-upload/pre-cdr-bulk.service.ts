import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Housing Premium's "Premium CDR" export -- writes into db_masmis.Pre_cdr
 * (sql/1766). Genuinely per-call (unlike its Owner sibling, which turned
 * out to be an APR-style aggregate -- see owner-cdr-bulk.service.ts), but
 * with real columns confirmed against the file the user supplied
 * (C:\Users\MAS60358\Desktop\Housing Premium\Premium_CDR.xlsx): CALLER,
 * MEMBER, End Time, DURATION, STATUS, Routing Numbers, Routing Status,
 * Talk Duration, Ringing Duration, Start Time, Time, Date, TL Name, Count,
 * Unique Count, Date row Count, V+W, Talk Time, TL. No call_id column
 * exists in the real file -- CALLER (the phone number) is the row's own
 * identity, confirmed by the sample data. Deliberately separate from the
 * existing CR_housing_premium (1,549 real rows, a different
 * routing/leg-specific shape), per explicit user confirmation.
 */

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getByColumn(data: Record<string, unknown>, ...columnNames: string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const col of columnNames) {
    const v = normalized[normalizeKey(col)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function n(data: Record<string, unknown>, ...columnNames: string[]): string | null {
  const v = getByColumn(data, ...columnNames);
  return v || null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importPreCdrBatch(
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

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const insertRows: ChunkInsertRow[] = [];

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const caller = getByColumn(data, "CALLER");
    if (!caller) {
      const msg = `Row ${row.row_no}: "CALLER" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        caller, n(data, "MEMBER"), n(data, "End Time"), n(data, "DURATION"), n(data, "STATUS"),
        n(data, "Routing Numbers"), n(data, "Routing Status"), n(data, "Talk Duration"),
        n(data, "Ringing Duration"), n(data, "Start Time"), n(data, "Time"), n(data, "Date"),
        n(data, "TL Name"), n(data, "Count"), n(data, "Unique Count"), n(data, "Date row Count"),
        n(data, "V+W"), n(data, "Talk Time"), n(data, "TL"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.Pre_cdr
       (caller, member, end_time, duration, status, routing_numbers, routing_status,
        talk_duration, ringing_duration, start_time, time_value, report_date, tl_name,
        call_count, unique_count, date_row_count, v_plus_w, talk_time, tl,
        uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'Pre_cdr', ?, ?, NULL)`,
      [batchId, `HRMS2 upload by ${importedByUserId}`, importedRows],
    );
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

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
