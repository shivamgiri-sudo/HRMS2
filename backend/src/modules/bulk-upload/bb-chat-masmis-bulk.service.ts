import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Bellavita's real "Chat" (Chatwoot ticket) export -- writes into the SAME
 * already-live db_masmis.bb_chat table (154,399 real rows) the separate
 * My Dashboards tool already uses. Live schema matches the doc exactly.
 */

/** Lowercase, strip everything but letters/digits -- same convention as every other importer
 * in this module. Needed because the uploader sends the file's literal header text as keys, and
 * an exact-string lookup silently fails on any casing/spacing variant of a real header even
 * when the column is right there in the sheet (confirmed live for bb_apr/bb_sale). */
function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function get(data: Record<string, unknown>, ...keys: string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const k of keys) {
    const v = normalized[normalizeKey(k)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
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
  if (batchRows.length === 0) {
    const [staged] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ?`,
      [batchId],
    );
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
  // See bb-sale-masmis-bulk.service.ts's own comment: was a per-row for-loop, one INSERT + one
  // status-UPDATE round trip per row -- fine on a local DB, painfully slow across production's
  // real network link, and this table's real files run to six figures of rows. Validate first,
  // batch-insert second.
  const toInsert: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const ticketId = get(data, "ticket_id", "Ticket ID");
    if (!ticketId) {
      const msg = `Row ${row.row_no}: "ticket_id" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        ticketId, n(data, "inbox_id"), n(data, "inbox_name"), n(data, "ticket_status"),
        n(data, "agent_name"), n(data, "email_1"), n(data, "phone_number"),
        n(data, "created_at"), n(data, "assigned_at"), n(data, "agent_frt_at"),
        n(data, "frt_1"), n(data, "resolution_time_at"), n(data, "resolution_time"),
        n(data, "average_wait_time"), n(data, "is_resolved"), n(data, "is_outside_working_hrs"),
        n(data, "level1_tags"), n(data, "level2_tags"), n(data, "level3_tags"),
        n(data, "system_tags"), n(data, "chat_link"), n(data, "repeat_status"),
        n(data, "repeat_status_on_assign"), n(data, "time_1406"), n(data, "resolution_time_min"),
        n(data, "frt_tat"), n(data, "resolution_tat"), n(data, "phone_number1"),
        n(data, "current_agent"), n(data, "email_2"), n(data, "chat_date"), n(data, "emp_id"),
        n(data, "lob"), n(data, "week"), parseNullableDecimal(get(data, "count_1")),
        n(data, "time_slot"), parseNullableInt(get(data, "hour")), n(data, "tl_name"),
        n(data, "disposition"), n(data, "day_shift_night_shift"), n(data, "unique_id"),
        n(data, "froud"), n(data, "frt_2"), n(data, "user_type"),
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
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  const failedIds = new Set(inserted.errorUpdates.map((u) => u.rowId));
  const importedIds = toInsert.filter((r) => !failedIds.has(r.rowId)).map((r) => r.rowId);
  for (let i = 0; i < importedIds.length; i += 1000) {
    const slice = importedIds.slice(i, i + 1000);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported' WHERE id IN (${slice.map(() => "?").join(",")})`,
      slice,
    );
  }

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

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
