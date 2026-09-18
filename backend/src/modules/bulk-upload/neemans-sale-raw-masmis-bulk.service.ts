import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

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
 *
 * Header aliases below are the REAL file's own headers, read directly off
 * the app's own "Columns actually found in this file" error message
 * (reported live: "Week, Date, EMP ID, Name, TL, LOB, Tenure, OrderID,
 * CustomerNumber, E-mail ID, Payment Status, Amount, Discount Code,
 * Line_Item_Name, LOB_1, Calling Status, Status, Count, Order ID, Current
 * Status ( Shiprocket Status), Final Status, Line_Item_Qty, Target, Call
 * Date& Time, Duration , Created at") -- not a guess. All 26 line up 1:1
 * positionally with this table's 26 columns, including two the old
 * camelCase-only aliases had no chance of matching: "LOB" appears TWICE
 * (plain "LOB" -> lob, then "LOB_1" -> calling_lob) and "Order ID" (with a
 * space, distinct from "OrderID" without one) -> neemans_order_id, not
 * order_id. "Duration " keeps the real file's own trailing space as a
 * fallback alias in case a re-export drops it.
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
  const insertRows: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const orderId = get(data, "OrderID", "orderId", "order_id");
    if (!orderId) {
      const msg = `Row ${row.row_no}: "orderId" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
          n(data, "Week", "week"), n(data, "Date", "date"), n(data, "EMP ID", "empId", "emp_id"), n(data, "Name", "name"),
          n(data, "TL", "tl"), n(data, "LOB", "lob"), n(data, "Tenure", "tenure"), orderId,
          n(data, "CustomerNumber", "customerNumber", "customer_number"), n(data, "E-mail ID", "emailId", "email_id"),
          n(data, "Payment Status", "paymentStatus", "payment_status"), parseNullableDecimal(get(data, "Amount", "amount")),
          n(data, "Discount Code", "discountCode", "discount_code"), n(data, "Line_Item_Name", "lineItemName", "line_item_name"),
          n(data, "LOB_1", "callingLob", "calling_lob"), n(data, "Calling Status", "callingStatus", "calling_status"),
          n(data, "Status", "status"), parseNullableInt(get(data, "Count", "count")),
          n(data, "Order ID", "neemansOrderId", "neemans_order_id"), n(data, "Current Status ( Shiprocket Status)", "currentStatus", "current_status"),
          n(data, "Final Status", "finalStatus", "final_status"), parseNullableInt(get(data, "Line_Item_Qty", "lineItemQty", "line_item_qty")),
          parseNullableInt(get(data, "Target", "target")), n(data, "Call Date& Time", "callDateTime", "call_date_time"),
          n(data, "Duration ", "Duration", "duration"), n(data, "Created at", "createdAt", "created_at_raw"),
          null, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.neemans_sale_raw
           (week, date, emp_id, name, tl, lob, tenure, order_id, customer_number, email_id,
            payment_status, amount, discount_code, line_item_name, calling_lob, calling_status,
            status, count, neemans_order_id, current_status, final_status, line_item_qty,
            target, call_date_time, duration, created_at_raw, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

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

  // Same convention as every other importer in this module -- this was missing here,
  // which is why a completed batch stayed stuck at 'importing' forever regardless of
  // outcome instead of ever reaching a terminal status.
  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
