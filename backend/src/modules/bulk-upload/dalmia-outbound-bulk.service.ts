import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { flushDalmiaRows } from "./dalmia-chunk-import.js";
import type { ChunkInsertRow } from "./masmis-chunked-insert.js";
import { canonicalizeRow, parseFlexibleDate, parseFlexibleDateTime } from "./dalmia-import-helpers.js";

/**
 * Dalmia Cement's own "Outbound " sheet -- website/careers enquiry log for
 * outbound follow-up calling. See sql/1732's own comment for the
 * cross-schema check that confirmed this has no DB backing anywhere.
 */

export const DALMIA_OUTBOUND_HEADERS = [
  "ID", "Name", "Email", "Mobile", "Enquiry For", "Message", "Date", "Status", "Remarks",
  "Calling Date", "Source of lead",
] as const;

/** Accepts ISO, Excel serials and displayed text ("9/2/2026", "31-08-2026") -- see dalmia-import-helpers.ts. */
export function parseDate(raw: unknown): string | null {
  return parseFlexibleDate(raw);
}

export function parseNullableInt(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
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

export async function importDalmiaOutboundBatch(
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
      DALMIA_OUTBOUND_HEADERS,
    );

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "Dalmia Cement" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    const sourceRowId = parseNullableInt(data["ID"]);
    const callingDate = parseDate(data["Calling Date"]);
    if (sourceRowId === null || !callingDate) {
      const msg = `Row ${row.row_no}: "ID" and "Calling Date" are both required -- ID is this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(), processId, sourceRowId, callingDate,
        cleanText(data["Name"]),
        cleanText(data["Email"]),
        cleanText(data["Mobile"]),
        cleanText(data["Enquiry For"]),
        cleanText(data["Message"]),
        parseFlexibleDateTime(data["Date"]) ?? cleanText(data["Date"]),
        cleanText(data["Status"]),
        cleanText(data["Remarks"]),
        cleanText(data["Source of lead"]),
        "bulk_upload", batchId, importedByUserId,
      ],
    });
  }

  return flushDalmiaRows({
    batchId, table: "dalmia_outbound_raw",
    columns: ["id","process_id","source_row_id","report_date","customer_name","email","mobile","enquiry_for","message","enquiry_date","status","remarks","source_of_lead","data_source","source_reference","created_by"],
    suffix: "ON DUPLICATE KEY UPDATE status = VALUES(status), remarks = VALUES(remarks)",
    rows: insertRows, errorUpdates, errors,
  });
}
