import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
Clovia's Chat transcript export (cl_chat.xlsx, 31 real columns).
 * "Chat" holds the full raw transcript (TEXT) -- confirmed a real sample
 * runs to several KB of timestamped agent/customer/bot lines.
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

export async function importClChatBatch(
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
  let importedRows = 0;
  let errorRows = 0;

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const requiredVal = getByColumn(data, "Chat_Id");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "Chat_Id" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.cl_chat
           (report_date, uid, chat_id, phone_number, chat_transcript, username, name, surname, channel, dept, chat_flow, date_time, chat_duration, accepted_time, wait_time, star_rating_value, issue_solved, total_chat, web, wp, rating_received, response_rcv, issue_resolved_yes, issue_resolved_no, actual_agent_on_chat, tl_name, week, mas_id, user_name, hours, min_slot_15, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n(data, "Date"),
          n(data, "UID"),
          requiredVal,
          n(data, "Phone_Number"),
          n(data, "Chat"),
          n(data, "Username"),
          n(data, "Name"),
          n(data, "Surname"),
          n(data, "Channel"),
          n(data, "Dept"),
          n(data, "Chat Flow"),
          n(data, "Date & Time"),
          n(data, "chat_duration"),
          n(data, "accepted_time"),
          n(data, "wait_time"),
          n(data, "star_rating_value"),
          n(data, "issue_solved"),
          n(data, "Total Chat"),
          n(data, "WEB"),
          n(data, "WP"),
          n(data, "Rating Received (Yes/No)"),
          n(data, "Response Rcv"),
          n(data, "Issue Resolved (Yes)"),
          n(data, "Issue Resolved (No)"),
          n(data, "Actual Agent on Chat"),
          n(data, "TL Name"),
          n(data, "Week"),
          n(data, "Mas id"),
          n(data, "User Name"),
          n(data, "Hours"),
          n(data, "15 Min Slot"),
          uploadedByInt, batchId,
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

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'cl_chat', ?, ?, NULL)`,
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
