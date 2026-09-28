import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  chunkedMasmisInsert,
  type ChunkInsertRow,
} from "./masmis-chunked-insert.js";

/**
 * Appreciate Wealth Chat -- writes into db_masmis.appreciate_chat (sql/1862).
 * Source: the chat / conversation export whose header row the user supplied
 * (Date, Member Assigned At, Resolution Time, Conversation id, ... FRT In
 * time). Headers are matched after normalising case, spaces and separators,
 * so "Handle/not handle" and "handle_not_handle" resolve to the same column.
 */

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getByColumn(
  data: Record<string, unknown>,
  ...columnNames: string[]
): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const col of columnNames) {
    const v = normalized[normalizeKey(col)];
    if (v !== undefined && v !== null && String(v).trim() !== "")
      return String(v).trim();
  }
  return "";
}
function n(
  data: Record<string, unknown>,
  ...columnNames: string[]
): string | null {
  const v = getByColumn(data, ...columnNames);
  return v || null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importAwChatBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0)
    return { importedRows: 0, errorRows: 0, errors: [] };

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const insertRows: ChunkInsertRow[] = [];

  const uploadedByInt = /^\d+$/.test(importedByUserId)
    ? Number(importedByUserId)
    : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const conversationId = getByColumn(data, "Conversation id");
    if (!conversationId) {
      const msg = `Row ${row.row_no}: "Conversation id" is required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        n(data, "Date"),
        n(data, "Member Assigned At"),
        n(data, "Resolution Time"),
        conversationId,
        n(data, "First Response Time Chrs"),
        n(data, "Initiated At"),
        n(data, "Assigned Agent name"),
        n(data, "Conversation status"),
        n(data, "User properties Name"),
        n(data, "User properties Email"),
        n(data, "User properties Phone number"),
        n(data, "Issue Re-opened"),
        n(data, "Response due type"),
        n(data, "Status"),
        n(data, "Interaction Time"),
        n(data, "Issue Resolved"),
        n(data, "Label category"),
        n(data, "Label subcategory"),
        n(data, "Resolved At"),
        n(data, "Csat Score"),
        n(data, "CSAT received by"),
        n(data, "C-SAT"),
        n(data, "Handle/not handle"),
        n(data, "FRT in sec"),
        n(data, "FRT In time"),
        uploadedByInt,
        batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO appreciate_chat
       (report_date, member_assigned_at, resolution_time, conversation_id, first_response_time, initiated_at,
        assigned_agent_name, conversation_status, user_name, user_email, user_phone_number, issue_reopened,
        response_due_type, status, interaction_time, issue_resolved, label_category, label_subcategory,
        resolved_at, csat_score, csat_received_by, c_sat, handle_status, frt_in_sec, frt_in_time,
        uploaded_by, upload_batch_id)`,
    placeholderGroup:
      "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'appreciate_chat', ?, ?, NULL)`,
      [batchId, `HRMS2 upload by ${importedByUserId}`, importedRows],
    );
  }

  if (errorUpdates.length) {
    const cases = errorUpdates
      .map(() => "WHEN ? THEN CAST(? AS JSON)")
      .join(" ");
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      [
        ...errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]),
        ...ids,
      ],
    );
  }

  const finalStatus =
    errorRows === 0
      ? "imported"
      : importedRows === 0
        ? "validation_failed"
        : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
