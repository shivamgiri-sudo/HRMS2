import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Bla Bli Blu's real Smartping CDR export -- captures ONLY the outcome
 * fields dialer_db.cdr_bla_bli_blu's live sync never fills (disposition
 * is 0% populated). See sql/1744 for the full cross-schema check and the
 * confirmed Session Id = call_uuid join key.
 */

export const BLA_BLI_BLU_CALL_DISPOSITION_HEADERS = [
  "Session Id", "Date & Time", "Customer Number", "Agent ID", "Agent Name",
  "Campaign Name", "Queue", "Campaign Type", "Disposition - L1", "Disposition - L2",
  "Disposition - L3", "Disposition - L4", "Remarks", "Recording", "Team Lead",
  "Call Rating", "Recording Rating", "Recording Remarks", "Evaluation Form",
  "Script", "Knowledge Base", "CRM Form",
] as const;

export function cleanText(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

/** "DD-Mon-YY HH:MM" (e.g. "08-09-26 18:50") -> "YYYY-MM-DD HH:MM:00".
 * Day/month/hour/minute accept 1-2 digits, not just 2: a single-digit day (e.g. "8-9-26 8:50"
 * for 8 Sep) is exactly the shape that silently broke bb_apr/bb_sale's own date parsers -- same
 * bug class, fixed here proactively rather than waiting for a real file to hit it. */
export function parseDateTime(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{1,2})-(\d{1,2})-(\d{2})\s+(\d{1,2}):(\d{1,2})/.exec(v);
  if (m) {
    const year = parseInt(m[3], 10) < 50 ? `20${m[3]}` : `19${m[3]}`;
    return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")} ${m[4].padStart(2, "0")}:${m[5].padStart(2, "0")}:00`;
  }
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importBlaBliBluCallDispositionBatch(
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

    const callUuid = cleanText(data["Session Id"]);
    if (!callUuid) {
      const msg = `Row ${row.row_no}: "Session Id" is required -- it is this row's identity (matches dialer_db.cdr_bla_bli_blu.call_uuid)`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(), processId, callUuid,
        parseDateTime(data["Date & Time"]),
        cleanText(data["Customer Number"]),
        cleanText(data["Agent ID"]),
        cleanText(data["Agent Name"]),
        cleanText(data["Campaign Name"]),
        cleanText(data["Queue"]),
        cleanText(data["Campaign Type"]),
        cleanText(data["Disposition - L1"]),
        cleanText(data["Disposition - L2"]),
        cleanText(data["Disposition - L3"]),
        cleanText(data["Disposition - L4"]),
        cleanText(data["Remarks"]),
        cleanText(data["Recording"]),
        cleanText(data["Team Lead"]),
        cleanText(data["Call Rating"]),
        cleanText(data["Recording Rating"]),
        cleanText(data["Recording Remarks"]),
        cleanText(data["Evaluation Form"]),
        cleanText(data["Script"]),
        cleanText(data["Knowledge Base"]),
        cleanText(data["CRM Form"]),
        batchId,
        importedByUserId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO bla_bli_blu_call_disposition_raw
           (id, process_id, call_uuid, call_date_time, customer_number, agent_code, agent_name,
            campaign_name, queue_name, campaign_type, disposition_l1, disposition_l2, disposition_l3,
            disposition_l4, remarks, recording_url, team_lead, call_rating, recording_rating,
            recording_remarks, evaluation_form, script, knowledge_base, crm_form,
            data_source, source_reference, created_by)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)",
    insertSuffix: `ON DUPLICATE KEY UPDATE
            disposition_l1 = VALUES(disposition_l1),
            disposition_l2 = VALUES(disposition_l2),
            disposition_l3 = VALUES(disposition_l3),
            disposition_l4 = VALUES(disposition_l4),
            remarks = VALUES(remarks),
            call_rating = VALUES(call_rating)`,
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
