import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Appreciate Health's "Inbound" CDR export -- writes into the SAME
 * already-live db_masmis.aw_inbound table (107 real rows, uploaded_by=7,
 * upload_batch_id populated -- inserted by the separate My Dashboards tool;
 * confirmed no existing HRMS2 code path writes here yet).
 *
 * No real Excel export has been seen for this upload type, so header
 * matching is normalized rather than alias-listed: every incoming key and
 * every DB column name is lowercased with all non-alphanumeric characters
 * stripped before matching ("Call ID", "call_id", "CallID" all reduce to
 * "callid"). See aw-mandate-bulk.service.ts's own comment for the full
 * reasoning -- same helper duplicated here per this module's existing
 * per-file convention.
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

export async function importAwInboundBatch(
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

    const callId = getByColumn(data, "call_id");
    if (!callId) {
      const msg = `Row ${row.row_no}: "call_id" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        callId, n(data, "call_type"), n(data, "campaign"), n(data, "location"),
        n(data, "caller_no"), n(data, "caller_e164"), n(data, "skill"), n(data, "call_date"),
        n(data, "queue_time"), n(data, "start_time"), n(data, "time_to_answer"), n(data, "end_time"),
        n(data, "talk_time"), n(data, "hold_time"), n(data, "duration"), n(data, "call_flow"),
        n(data, "dialed_number"), n(data, "agent"), n(data, "disposition"), n(data, "wrapup_duration"),
        n(data, "handling_time"), n(data, "status"), n(data, "dial_status"),
        n(data, "customer_dial_status"), n(data, "agent_dial_status"), n(data, "hangup_by"),
        n(data, "transfer_details"), n(data, "uui"), n(data, "comments"), n(data, "feedback"),
        n(data, "customer_ring_time"), n(data, "recording_url"), n(data, "agent_id"),
        n(data, "ratings"), n(data, "rating_comments"), n(data, "dynamic_did"), n(data, "did"),
        n(data, "dial_count"), n(data, "dial_did"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.aw_inbound
       (call_id, call_type, campaign, location, caller_no, caller_e164, skill, call_date,
        queue_time, start_time, time_to_answer, end_time, talk_time, hold_time, duration,
        call_flow, dialed_number, agent, disposition, wrapup_duration, handling_time, status,
        dial_status, customer_dial_status, agent_dial_status, hangup_by, transfer_details,
        uui, comments, feedback, customer_ring_time, recording_url, agent_id, ratings,
        rating_comments, dynamic_did, did, dial_count, dial_did, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'aw_inbound', ?, ?, NULL)`,
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
