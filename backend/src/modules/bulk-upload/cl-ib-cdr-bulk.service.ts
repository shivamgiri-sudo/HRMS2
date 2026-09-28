import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
Clovia's Inbound CDR export (cl_ib_cdr.xlsx, 29 real columns).
 * No existing Clovia equivalent in this codebase. The real file has "Count"
 * TWICE (positions 20 and 28) -- SheetJS's sheet_to_json dedupes the second
 * occurrence to "Count_1" (confirmed live earlier this session against this
 * project's installed xlsx@0.18.5, same pattern as GNC Sale Raw's LOB/LOB_1),
 * so count_2 aliases "Count_1", not "Count" again.
 *
 * No real Excel export was known ahead of time for most of this session's
 * uploaders, but this one WAS confirmed directly against the real file --
 * every header below is read off it verbatim, not normalized-matched
 * blind. Still using normalized (case/space/separator-stripped) matching
 * as the mechanism, since it costs nothing and only adds tolerance.
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

export async function importClIbCdrBatch(
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

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  const toInsert: ChunkInsertRow[] = [];
  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const requiredVal = getByColumn(data, "Agent Id");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "Agent Id" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({ rowId: row.id, rowNo: row.row_no, values: [
      n(data, "CallDate"),
      n(data, "Time"),
      n(data, "CallTime"),
      requiredVal,
      n(data, "Name"),
      n(data, "Calltype"),
      n(data, "Campname"),
      n(data, "Phone Number"),
      n(data, "Disposition"),
      n(data, "Disconn.By"),
      n(data, "Callduration"),
      n(data, "Queue Duration"),
      n(data, "Hold Time"),
      n(data, "Acwduration (Wrapup or Dispo time)"),
      n(data, "Hours Slot"),
      n(data, "Total Handled Time"),
      n(data, "Call 20 Sec (SL)"),
      n(data, "End Time"),
      n(data, "Status"),
      n(data, "Count"),
      n(data, "Unique/Repeat"),
      n(data, "Call 10 Sec (SL)"),
      n(data, "Abn"),
      n(data, "Short Calls"),
      n(data, "Slot Time"),
      n(data, "Count1"),
      n(data, "15 Min Slot"),
      n(data, "Count_1"),
      n(data, "U/R"),
      uploadedByInt, batchId,
    ] });
  }
  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.cl_ib_cdr (call_date, time_val, call_time, agent_id, name, call_type, camp_name, phone_number, disposition, disconn_by, call_duration, queue_duration, hold_time, acw_duration, hours_slot, total_handled_time, call_20_sec_sl, end_time, status, count_val, unique_repeat, call_10_sec_sl, abn, short_calls, slot_time, count1, min_slot_15, count_2, u_r, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'cl_ib_cdr', ?, ?, NULL)`,
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
