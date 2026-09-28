import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * lp_feedback_apr -- writes into db_masmis.lp_feedback_apr (sql/1772). Source: LP Feedback APR.xlsx.
 * Columns confirmed directly against the real file, not guessed.
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

export async function importLpFeedbackAprBatch(
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

    const requiredVal = getByColumn(data, "LoginId");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "LoginId" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        n(data, "CalLDate"),
        n(data, "Interval"),
        n(data, "Agent"),
        requiredVal,
        n(data, "Total_Calls"),
        n(data, "Dialer_Calls"),
        n(data, "Outbound_Calls"),
        n(data, "Manual_Calls"),
        n(data, "Transfered_Calls"),
        n(data, "Login_Time"),
        n(data, "Net_LoginTime"),
        n(data, "Break_Count"),
        n(data, "Tea"),
        n(data, "Lunch"),
        n(data, "Meeting"),
        n(data, "BIO_Break"),
        n(data, "Unsolicted"),
        n(data, "Total_Break_Duration"),
        n(data, "Handle_Duration"),
        n(data, "Average_Handle_Duration"),
        n(data, "Idle_Duration"),
        n(data, "Average_Idle_Duration"),
        n(data, "Idle_Block_Duration"),
        n(data, "Ring_Duration"),
        n(data, "Average_Ring_Duration"),
        n(data, "Talk_Duration"),
        n(data, "Average_Talk_Duration"),
        n(data, "Hold_Duration"),
        n(data, "Average_Hold_Duration"),
        n(data, "Wrapup_Duration"),
        n(data, "Average_Wrapup_Duration"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.lp_feedback_apr
       (report_date, interval_val, agent, login_id, total_calls, dialer_calls, outbound_calls, manual_calls, transfered_calls, login_time, net_login_time, break_count, tea, lunch, meeting, bio_break, unsolicited, total_break_duration, handle_duration, avg_handle_duration, idle_duration, avg_idle_duration, idle_block_duration, ring_duration, avg_ring_duration, talk_duration, avg_talk_duration, hold_duration, avg_hold_duration, wrapup_duration, avg_wrapup_duration, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'lp_feedback_apr', ?, ?, NULL)`,
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
