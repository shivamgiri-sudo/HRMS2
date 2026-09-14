import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Bellavita's real "Chat" (Chatwoot ticket) export -- writes into the SAME
 * already-live db_masmis.bb_chat table (154,399 real rows) the separate
 * My Dashboards tool already uses. Live schema matches the doc exactly.
 */

function get(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") {
      return String(data[k]).trim();
    }
  }
  return "";
}
function n(data: Record<string, unknown>, ...keys: string[]): string | null {
  const v = get(data, ...keys);
  return v || null;
}
function parseNullableInt(v: string): number | null {
  const num = parseInt(v, 10);
  return Number.isFinite(num) ? num : null;
}
function parseNullableDecimal(v: string): number | null {
  const num = parseFloat(v);
  return Number.isFinite(num) ? num : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importBbChatMasmisBatch(
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

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const ticketId = get(data, "Ticket ID", "ticket_id");
    if (!ticketId) {
      const msg = `Row ${row.row_no}: "ticket_id" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        ticketId, n(data, "inbox_id"), n(data, "Inbox Name", "inbox_name"), n(data, "Ticket Status", "ticket_status"),
        n(data, "Assigned Agent", "agent_name"), n(data, "Contact Email", "email_1"), n(data, "Contact Phone Number", "phone_number"),
        n(data, "Conversation Created At", "created_at"), n(data, "Assigned At", "assigned_at"), n(data, "First Response By Agent At", "agent_frt_at"),
        n(data, "First Response Time", "frt_1"), n(data, "Resolution Time At", "resolution_time_at"), n(data, "Resolution Time", "resolution_time"),
        n(data, "Average Response Time", "average_wait_time"), n(data, "Is Resolved", "is_resolved"), n(data, "Is Outside Business Hours", "is_outside_working_hrs"),
        n(data, "level1_tags"), n(data, "level2_tags"), n(data, "level3_tags"),
        n(data, "system_tags"), n(data, "Chat Transcript Link", "chat_link"), n(data, "Repeat Status", "repeat_status"),
        n(data, "Repeat Status On Assign", "repeat_status_on_assign"), n(data, "time_1406"), n(data, "Resolution Time In Minutes", "resolution_time_min"),
        n(data, "FRT TAT", "frt_tat"), n(data, "Resolution TAT", "resolution_tat"), n(data, "Phone Number 1", "phone_number1"),
        n(data, "Current Agent", "current_agent"), n(data, "email_2"), n(data, "Chat Date", "chat_date"), n(data, "Emp ID", "emp_id"),
        n(data, "LOB", "lob"), n(data, "Week", "week"), parseNullableDecimal(get(data, "Count", "count_1")),
        n(data, "Time Slot", "time_slot"), parseNullableInt(get(data, "Hour", "hour")), n(data, "TL Name", "tl_name"),
        n(data, "Disposition", "disposition"), n(data, "Day Shift/Night Shift", "day_shift_night_shift"), n(data, "Unique ID", "unique_id"),
        n(data, "Fraud", "froud"), n(data, "FRT 2", "frt_2"), n(data, "User Type", "user_type"),
        null, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.bb_chat
       (ticket_id, inbox_id, inbox_name, ticket_status, agent_name, email_1, phone_number,
        created_at, assigned_at, agent_frt_at, frt_1, resolution_time_at, resolution_time,
        average_wait_time, is_resolved, is_outside_working_hrs, level1_tags, level2_tags,
        level3_tags, system_tags, chat_link, repeat_status, repeat_status_on_assign,
        time_1406, resolution_time_min, frt_tat, resolution_tat, phone_number1,
        current_agent, email_2, chat_date, emp_id, lob, week, count_1, time_slot, hour,
        tl_name, disposition, day_shift_night_shift, unique_id, froud, frt_2, user_type,
        uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'bb_chat', ?, ?, NULL)`,
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

  // Same convention as every other importer in this module (e.g. employee-master-bulk.service.ts)
  // -- this was missing here, which is why a completed batch stayed stuck at 'importing' forever
  // regardless of outcome instead of ever reaching a terminal status.
  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
