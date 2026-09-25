import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { flushDalmiaRows } from "./dalmia-chunk-import.js";
import type { ChunkInsertRow } from "./masmis-chunked-insert.js";
import { canonicalizeRow, parseFlexibleDateTime, cleanPhone } from "./dalmia-import-helpers.js";

/**
 * Dalmia Cement's own "After Hour Data" sheet -- calls received outside
 * working hours. See sql/1734's own comment for the cross-schema check
 * that confirmed this has no DB backing anywhere.
 */

/** "Number" is the same phone number again; Excel often shows "Contact No" as 9.18235E+11 (digits lost) while "Number" keeps them. */
export const DALMIA_AFTER_HOUR_HEADERS = ["Date", "Contact No", "Number"] as const;

/** Accepts ISO, Excel serials and displayed text ("9/1/2026 19:03") -- see dalmia-import-helpers.ts. */
export function parseDateTime(raw: unknown): string | null {
  return parseFlexibleDateTime(raw);
}

export function cleanText(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importDalmiaAfterHourBatch(
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

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Dalmia Cement' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const insertRows: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data = canonicalizeRow(
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>),
      DALMIA_AFTER_HOUR_HEADERS,
    );

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "Dalmia Cement" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    const callDateTime = parseDateTime(data["Date"]);
    // "Contact No" first; if Excel has rounded it to 9.18235E+11, the sheet's own "Number" column keeps the real digits.
    const contactNumber = cleanPhone(data["Contact No"], data["Number"]);
    if (!callDateTime || !contactNumber) {
      const msg = `Row ${row.row_no}: a readable "Date" and a usable "Contact No" (or "Number") are both required -- together they are this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(), processId, callDateTime, callDateTime.slice(0, 10), contactNumber,
        "bulk_upload", batchId, importedByUserId,
      ],
    });
  }

  return flushDalmiaRows({
    batchId, table: "dalmia_after_hour_raw",
    columns: ["id","process_id","call_datetime","report_date","contact_number","data_source","source_reference","created_by"],
    suffix: "ON DUPLICATE KEY UPDATE contact_number = VALUES(contact_number)",
    rows: insertRows, errorUpdates, errors,
  });
}
