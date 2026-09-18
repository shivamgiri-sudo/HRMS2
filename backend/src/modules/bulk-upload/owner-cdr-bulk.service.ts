import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Housing Owner's "Owner CDR" export -- writes into db_masmis.Owner_cdr
 * (sql/1766). Despite the name, the real file (the user supplied
 * Owner_Cdrapr.xlsx -- "Cdrapr", CDR+APR, not a coincidence) is NOT
 * per-call records: it is an agent-level DAILY AGGREGATE report (Average
 * Calls/Day, Call Handling Rate, Available/Break/In-Call Duration, etc.),
 * with no call_id column anywhere. The first version of this service
 * assumed a generic per-call CDR shape with no sample to check against and
 * was wrong -- confirmed live when a real upload showed every one of these
 * 35 real headers in its "Columns actually found in this file" error.
 * "UID" (a composite like "46266Videsh kumar MCN" -- date-serial +
 * agent -- in the one real sample seen) is the row's own identity.
 * Deliberately separate from the existing CR_housing_owner (2,122 real
 * rows, a different telephony-specific shape), per explicit user
 * confirmation.
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

export async function importOwnerCdrBatch(
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

    const uid = getByColumn(data, "UID");
    if (!uid) {
      const msg = `Row ${row.row_no}: "UID" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        uid, n(data, "Date", "report_date"), n(data, "Agent"), n(data, "Email ID"),
        n(data, "Intercom ID"), n(data, "Group"), n(data, "Department"),
        n(data, "Login Based Calling"), n(data, "Average Calls/Day"),
        n(data, "Average C2C Calls/Day - Outbound Answered"), n(data, "Average Inbound Calls/Day"),
        n(data, "Call Handling Rate"), n(data, "Total Calls"), n(data, "Inbound Calls Offered"),
        n(data, "Outbound Click to Call Attempted"), n(data, "Calls Handled"),
        n(data, "Inbound Calls Answered"), n(data, "Inbound Calls Missed"),
        n(data, "Outbound Click to Call Answered"), n(data, "Available Duration"),
        n(data, "In-Call Duration"), n(data, "Break Duration"), n(data, "Inbound In-Call Duration"),
        n(data, "Outbound In-Call Duration"), n(data, "Average Call Handling Duration"),
        n(data, "Average Inbound Call Handling Duration"),
        n(data, "Average Outbound Call Handling Duration"), n(data, "Not Connected"),
        n(data, "Connected"), n(data, "TL Name"), n(data, "Average Talk time"),
        n(data, "Month"), n(data, "Day"), n(data, "last"), n(data, "AM"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.Owner_cdr
       (uid, report_date, agent, email_id, intercom_id, group_name, department,
        login_based_calling, avg_calls_per_day, avg_c2c_calls_per_day_outbound_answered,
        avg_inbound_calls_per_day, call_handling_rate, total_calls, inbound_calls_offered,
        outbound_click_to_call_attempted, calls_handled, inbound_calls_answered,
        inbound_calls_missed, outbound_click_to_call_answered, available_duration,
        in_call_duration, break_duration, inbound_in_call_duration, outbound_in_call_duration,
        avg_call_handling_duration, avg_inbound_call_handling_duration,
        avg_outbound_call_handling_duration, not_connected, connected, tl_name,
        avg_talk_time, month, day, last_val, am, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'Owner_cdr', ?, ?, NULL)`,
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
