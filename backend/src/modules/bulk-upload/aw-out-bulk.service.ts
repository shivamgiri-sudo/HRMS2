import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Appreciate Health's "Outbound" (agent productivity/conversion) export --
 * writes into the SAME already-live db_masmis.aw_out table (34 real rows,
 * uploaded_by=7, upload_batch_id populated -- inserted by the separate My
 * Dashboards tool; confirmed no existing HRMS2 code path writes here yet).
 *
 * No real Excel export has been seen for this upload type, so header
 * matching is normalized rather than alias-listed -- see
 * aw-mandate-bulk.service.ts's own comment for the full reasoning.
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

export async function importAwOutBatch(
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

    const requiredVal = getByColumn(data, "agent_id");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "agent_id" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        n(data, "call_date"),
        requiredVal,
        n(data, "agent_name"),
        n(data, "total_calls"),
        n(data, "connected_calls"),
        n(data, "not_connected_calls"),
        n(data, "total_talk_time"),
        n(data, "total_wrapup_time"),
        n(data, "total_pause_time"),
        n(data, "total_idle_time"),
        n(data, "pickup_time"),
        n(data, "total_login_time"),
        n(data, "first_login_time"),
        n(data, "last_logout_time"),
        n(data, "customer_disconnect"),
        n(data, "uuid"),
        n(data, "emp_id"),
        n(data, "lob"),
        n(data, "sub_lob"),
        n(data, "centre_mcn_or_enser"),
        n(data, "week"),
        n(data, "month"),
        n(data, "call_date_agent_id"),
        n(data, "bio"),
        n(data, "lunch"),
        n(data, "tea"),
        n(data, "meeting_aux"),
        n(data, "training"),
        n(data, "sip_disconnected"),
        n(data, "sip_unregistered"),
        n(data, "technical_issue_dialer"),
        n(data, "technical_issue_cc"),
        n(data, "change_mode"),
        n(data, "technical_issue_crm"),
        n(data, "qa_feedback"),
        n(data, "unused_col"),
        n(data, "net_login_hrs"),
        n(data, "actual_mandays"),
        n(data, "conversion_target"),
        n(data, "conversion"),
        n(data, "shift_time"),
        n(data, "roster_count"),
        n(data, "shift_start_time"),
        n(data, "late_login_status"),
        n(data, "ontime_login_status"),
        n(data, "late_login_count"),
        n(data, "ontime_login_count"),
        n(data, "acht_with_picked_up_time"),
        n(data, "acht"),
        n(data, "occupancy_on_calls"),
        n(data, "calling_target"),
        n(data, "break_exceed_count"),
        n(data, "net_occupancy"),
        n(data, "idle_on_manual"),
        n(data, "idle_on_blended"),
        n(data, "agent_disconnect"),
        n(data, "wrap_exceed_count"),
        n(data, "lrs_target"),
        n(data, "lrs_count"),
        n(data, "lrs_amount"),
        n(data, "trade_target"),
        n(data, "trade_count"),
        n(data, "trade_amount"),
        n(data, "mf_target"),
        n(data, "mf_count"),
        n(data, "mf_amount"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.aw_out
       (call_date, agent_id, agent_name, total_calls, connected_calls, not_connected_calls, total_talk_time, total_wrapup_time, total_pause_time, total_idle_time, pickup_time, total_login_time, first_login_time, last_logout_time, customer_disconnect, uuid, emp_id, lob, sub_lob, centre_mcn_or_enser, week, month, call_date_agent_id, bio, lunch, tea, meeting_aux, training, sip_disconnected, sip_unregistered, technical_issue_dialer, technical_issue_cc, change_mode, technical_issue_crm, qa_feedback, unused_col, net_login_hrs, actual_mandays, conversion_target, conversion, shift_time, roster_count, shift_start_time, late_login_status, ontime_login_status, late_login_count, ontime_login_count, acht_with_picked_up_time, acht, occupancy_on_calls, calling_target, break_exceed_count, net_occupancy, idle_on_manual, idle_on_blended, agent_disconnect, wrap_exceed_count, lrs_target, lrs_count, lrs_amount, trade_target, trade_count, trade_amount, mf_target, mf_count, mf_amount, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'aw_out', ?, ?, NULL)`,
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
