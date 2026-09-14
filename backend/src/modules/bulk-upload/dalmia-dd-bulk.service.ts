import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

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

export function parseDateTime(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const days = Math.floor(raw);
    const secondsOfDay = Math.round((raw - days) * 86400);
    const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000 + secondsOfDay * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  const d2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (d2) return `${d2[0]} 00:00:00`;
  return null;
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
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "Dalmia Cement" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const callId = parseNullableInt(data["Call Id"]);
    const callDate = parseDateTime(data["CallDate"]);
    if (callId === null || !callDate) {
      const msg = `Row ${row.row_no}: "Call Id" and "CallDate" are both required -- Call Id is this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO dalmia_dd_raw
           (id, process_id, call_id, report_date, in_call_from, scenario, sub_scenario_1,
            sub_scenario_2, sub_scenario_3, caller_type, suggestion_feedback, status, nftr_ftr,
            source_of_lead, mobile_no, alternate_number, pincode, no_of_bags, region,
            customer_name, firm_name, gstin_number, city, district, state, customer_remarks,
            email_id, when_cement_required, call_date, call_action, closer_date, call_created,
            closer_time, type_of_leads, leads, mt, converted,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            call_action = VALUES(call_action),
            closer_date = VALUES(closer_date)`,
        [
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
          batchId,
          importedByUserId,
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

  if (errorUpdates.length) {
    const cases = errorUpdates.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
    );
  }

  return { importedRows, errorRows, errors };
}
