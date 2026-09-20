import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Bla Bli Blu's real "Auto Call Back CDR Inbound.xls" export -- see
 * sql/1742 for the cross-schema check confirming this is a distinct
 * callback-attempt log, not a duplicate of the completed-call CDR
 * already live in dialer_db.cdr_in_10_4. Plain "YYYY-MM-DD HH:MM:SS"
 * text -- an HTML export off a website, not a real Excel workbook.
 */

export const BLA_BLI_BLU_AUTO_CALLBACK_HEADERS = [
  "Agent", "Phone Number", "Call Date", "Call Code", "Start Time", "End Time",
  "Length (Sec)", "Length (Min)", "Campaign", "Reason",
] as const;

export function cleanText(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

export function parseDateTime(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  return null;
}

export function parseDateOnly(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? m[0] : null;
}

export function parseNullableInt(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importBlaBliBluAutoCallbackBatch(
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

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Bla Bli Blu' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];

  const toInsert: ChunkInsertRow[] = [];
  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "Bla Bli Blu" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    const agent = cleanText(data["Agent"]);
    const phone = cleanText(data["Phone Number"]);
    const startTime = parseDateTime(data["Start Time"]);
    if (!agent || !phone || !startTime) {
      const msg = `Row ${row.row_no}: "Agent", "Phone Number" and "Start Time" are all required -- together they are this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(), processId, agent, phone,
        parseDateOnly(data["Call Date"]),
        cleanText(data["Call Code"]),
        startTime,
        parseDateTime(data["End Time"]),
        parseNullableInt(data["Length (Sec)"]),
        cleanText(data["Campaign"]),
        cleanText(data["Reason"]),
        batchId,
        importedByUserId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO bla_bli_blu_auto_callback_raw
           (id, process_id, agent_code, phone_number, call_date, call_code, start_time, end_time,
            length_seconds, campaign, reason, data_source, source_reference, created_by)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)",
    insertSuffix: `ON DUPLICATE KEY UPDATE
            call_code = VALUES(call_code),
            end_time = VALUES(end_time),
            length_seconds = VALUES(length_seconds)`,
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    const failedRowIds = new Set(inserted.errorUpdates.map((e) => e.rowId));
    const successRowIds = toInsert.filter((r) => !failedRowIds.has(r.rowId)).map((r) => r.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported' WHERE id IN (${successRowIds.map(() => "?").join(",")})`,
      successRowIds as never[],
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
