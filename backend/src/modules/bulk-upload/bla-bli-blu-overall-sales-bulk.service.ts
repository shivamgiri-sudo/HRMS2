import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Bla Bli Blu's own "B-3 Dashboard" workbook family's "Overall Sales Raw"
 * sheet -- agent-attributed order-level sales data with no DB backing
 * anywhere (see sql/1729's own comment for the cross-schema check that
 * confirmed this). Row identity is the sheet's own "OrderID" column.
 */

export const BLA_BLI_BLU_OVERALL_SALES_HEADERS = [
  "Week", "Date", "EMP ID", "Emp_Name", "Customer Number", "Payment Status",
  "Amount", "OrderID", "Campaign", "Calling Status", "Discount Code", "Count",
  "Current Status", "Lineitem sku", "New sold line item", "Created By",
  "Order Creation time", "Call Date & Time", "Call Duration",
  "Countifs of calls", "Lead_Line_Item", "Source", "Business",
  "New sold line item Categoty", "Alternate number", "Recording Link",
] as const;

/** Plain integer Excel serial -> "YYYY-MM-DD". */
export function parseDate(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  return null;
}

/**
 * FRACTIONAL Excel serial (date + time-of-day) -> "YYYY-MM-DD HH:MM:SS",
 * floored per this session's clovia-crm-disposition-bulk.service.ts
 * convention (also reused for clovia_rechurn_calls_raw).
 */
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
  return null;
}

/**
 * "Call Duration" is stored as a fraction-of-a-day (e.g. 0.006018518... =
 * ~520 seconds), the same unit family as the date/time columns above --
 * NOT a day-count and NOT already-seconds, so parseSecondsFlexible's
 * ambiguity heuristic does not apply here; this column is unambiguous by
 * construction (a call never lasts a whole day).
 */
export function parseCallDurationSeconds(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw * 86400);
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 86400) : null;
}

export function parseNullableInt(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseNullableDecimal(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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

export async function importBlaBliBluOverallSalesBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Bla Bli Blu' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Bla Bli Blu" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const orderId = cleanText(data["OrderID"]);
    const reportDate = parseDate(data["Date"]);
    if (!orderId || !reportDate) {
      const msg = `Row ${row.row_no}: "OrderID" and "Date" are both required -- OrderID is this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO bla_bli_blu_overall_sales_raw
           (id, process_id, order_id, report_date, week_label, emp_code, emp_name,
            customer_number, alternate_number, payment_status, amount, campaign,
            calling_status, discount_code, item_count, current_status, lineitem_sku,
            new_sold_line_item, new_sold_line_item_category, lead_line_item,
            source_channel, business_type, order_creation_time, call_date_time,
            call_duration_seconds, call_attempt_count, source_created_by,
            recording_link, data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            payment_status = VALUES(payment_status),
            current_status = VALUES(current_status),
            amount = VALUES(amount)`,
        [
          randomUUID(), processId, orderId, reportDate,
          cleanText(data["Week"]),
          cleanText(data["EMP ID"]),
          cleanText(data["Emp_Name"]),
          cleanText(data["Customer Number"]),
          cleanText(data["Alternate number"]),
          cleanText(data["Payment Status"]),
          parseNullableDecimal(data["Amount"]),
          cleanText(data["Campaign"]),
          cleanText(data["Calling Status"]),
          cleanText(data["Discount Code"]),
          parseNullableDecimal(data["Count"]),
          cleanText(data["Current Status"]),
          cleanText(data["Lineitem sku"]),
          cleanText(data["New sold line item"]),
          cleanText(data["New sold line item Categoty"]),
          cleanText(data["Lead_Line_Item"]),
          cleanText(data["Source"]),
          cleanText(data["Business"]),
          parseDateTime(data["Order Creation time"]),
          parseDateTime(data["Call Date & Time"]),
          parseCallDurationSeconds(data["Call Duration"]),
          parseNullableInt(data["Countifs of calls"]),
          cleanText(data["Created By"]),
          cleanText(data["Recording Link"]),
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
