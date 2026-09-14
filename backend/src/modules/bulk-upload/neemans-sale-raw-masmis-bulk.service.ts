import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Neemans' real "Sale Raw" export -- writes into the SAME already-live
 * db_masmis.neemans_sale_raw table (3,800 real rows) the separate My
 * Dashboards tool already uses. Live schema matches the doc exactly,
 * including its documented quirk: "date" is stored as the RAW,
 * UNCONVERTED Excel serial number text (e.g. "46215") -- confirmed via a
 * real live row (id 6176) -- kept exactly that way here too, since that
 * repo's own dashboard queries cast it back to a date at query time; a
 * different convention here would silently misalign with 3,800 existing
 * rows. Same for call_date_time/duration/created_at_raw (all raw
 * fraction-of-a-day/serial text, not converted).
 */

export const NEEMANS_SALE_RAW_HEADERS = [
  "week", "date", "empId", "name", "tl", "lob", "tenure", "orderId", "customerNumber",
  "emailId", "paymentStatus", "amount", "discountCode", "lineItemName", "callingLob",
  "callingStatus", "status", "count", "neemansOrderId", "currentStatus", "finalStatus",
  "lineItemQty", "target", "callDateTime", "duration", "createdAt",
] as const;

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

export async function importNeemansSaleRawMasmisBatch(
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
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const orderId = get(data, "orderId", "order_id");
    if (!orderId) {
      const msg = `Row ${row.row_no}: "orderId" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.neemans_sale_raw
           (week, date, emp_id, name, tl, lob, tenure, order_id, customer_number, email_id,
            payment_status, amount, discount_code, line_item_name, calling_lob, calling_status,
            status, count, neemans_order_id, current_status, final_status, line_item_qty,
            target, call_date_time, duration, created_at_raw, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n(data, "week"), n(data, "date"), n(data, "empId", "emp_id"), n(data, "name"),
          n(data, "tl"), n(data, "lob"), n(data, "tenure"), orderId,
          n(data, "customerNumber", "customer_number"), n(data, "emailId", "email_id"),
          n(data, "paymentStatus", "payment_status"), parseNullableDecimal(get(data, "amount")),
          n(data, "discountCode", "discount_code"), n(data, "lineItemName", "line_item_name"),
          n(data, "callingLob", "calling_lob"), n(data, "callingStatus", "calling_status"),
          n(data, "status"), parseNullableInt(get(data, "count")),
          n(data, "neemansOrderId", "neemans_order_id"), n(data, "currentStatus", "current_status"),
          n(data, "finalStatus", "final_status"), parseNullableInt(get(data, "lineItemQty", "line_item_qty")),
          parseNullableInt(get(data, "target")), n(data, "callDateTime", "call_date_time"),
          n(data, "duration"), n(data, "createdAt", "created_at_raw"),
          null, batchId,
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

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'neemans_sale_raw', ?, ?, NULL)`,
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

  return { importedRows, errorRows, errors };
}
