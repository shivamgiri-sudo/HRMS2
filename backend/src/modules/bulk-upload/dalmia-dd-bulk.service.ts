import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { flushDalmiaRows } from "./dalmia-chunk-import.js";
import type { ChunkInsertRow } from "./masmis-chunked-insert.js";
import { canonicalizeRow, parseFlexibleDateTime } from "./dalmia-import-helpers.js";

/**
 * Dalmia Cement's own "DD Raw" (Disposition Detail) sheet -- a dealer/
 * customer lead management log. See sql/1731's own comment for the
 * cross-schema check that confirmed this has no DB backing anywhere.
 */

export const DALMIA_DD_HEADERS = [
  "IN CALL FROM", "Call Id", "SCENARIO", "SUB SCENARIO 1", "SUB SCENARIO 2", "SUB SCENARIO 3",
  "Caller Type", "Suggestion/Feedback", "Status", "NFTR/FTR", "Source of Lead", "Mobile No",
  "Alternate Number", "Pincode", "No. Of Bags", "Region", "Customer Name", "Firm Name",
  "GSTIN NUMBER", "City", "District", "State", "Customer Remarks", "E-Mail ID",
  "When cement is Required", "CallDate", "Call Action", "Closer Date", "Call Created",
  "Closer Time", "Type Of Leads", "Leads", "MT", "Converted",
] as const;

/** Accepts ISO, Excel serials and the text Excel displays ("7/1/2026 10:12", "1-Jul-26") -- see dalmia-import-helpers.ts. */
export function parseDateTime(raw: unknown): string | null {
  return parseFlexibleDateTime(raw);
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

export async function importDalmiaDdBatch(
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
      DALMIA_DD_HEADERS,
    );

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "Dalmia Cement" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    const callId = parseNullableInt(data["Call Id"]);
    const callDate = parseDateTime(data["CallDate"]);
    if (callId === null || !callDate) {
      const msg = `Row ${row.row_no}: "Call Id" and "CallDate" are both required -- Call Id is this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(), processId, callId, callDate.slice(0, 10),
        cleanText(data["IN CALL FROM"]),
        cleanText(data["SCENARIO"]),
        cleanText(data["SUB SCENARIO 1"]),
        cleanText(data["SUB SCENARIO 2"]),
        cleanText(data["SUB SCENARIO 3"]),
        cleanText(data["Caller Type"]),
        cleanText(data["Suggestion/Feedback"]),
        cleanText(data["Status"]),
        cleanText(data["NFTR/FTR"]),
        cleanText(data["Source of Lead"]),
        cleanText(data["Mobile No"]),
        cleanText(data["Alternate Number"]),
        cleanText(data["Pincode"]),
        cleanText(data["No. Of Bags"]),
        cleanText(data["Region"]),
        cleanText(data["Customer Name"]),
        cleanText(data["Firm Name"]),
        cleanText(data["GSTIN NUMBER"]),
        cleanText(data["City"]),
        cleanText(data["District"]),
        cleanText(data["State"]),
        cleanText(data["Customer Remarks"]),
        cleanText(data["E-Mail ID"]),
        cleanText(data["When cement is Required"]),
        callDate,
        cleanText(data["Call Action"]),
        parseDateTime(data["Closer Date"]),
        cleanText(data["Call Created"]),
        parseDateTime(data["Closer Time"]),
        cleanText(data["Type Of Leads"]),
        cleanText(data["Leads"]),
        cleanText(data["MT"]),
        cleanText(data["Converted"]),
        "bulk_upload", batchId, importedByUserId,
      ],
    });
  }

  const columns = ["id","process_id","call_id","report_date","in_call_from","scenario","sub_scenario_1","sub_scenario_2","sub_scenario_3","caller_type","suggestion_feedback","status","nftr_ftr","source_of_lead","mobile_no","alternate_number","pincode","no_of_bags","region","customer_name","firm_name","gstin_number","city","district","state","customer_remarks","email_id","when_cement_required","call_date","call_action","closer_date","call_created","closer_time","type_of_leads","leads","mt","converted","data_source","source_reference","created_by"];
  return flushDalmiaRows({
    batchId, table: "dalmia_dd_raw", columns,
    suffix: "ON DUPLICATE KEY UPDATE status = VALUES(status), call_action = VALUES(call_action), closer_date = VALUES(closer_date)",
    rows: insertRows, errorUpdates, errors,
  });
}
