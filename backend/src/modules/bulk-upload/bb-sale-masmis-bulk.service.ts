import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Bellavita's real "Sale" sheet -- written into the ALREADY-LIVE
 * db_masmis.bb_sale table (23,391 real rows, most recent upload
 * 2026-07-02), the same table the separate My Dashboards tool
 * (github.com/tausifansari-mcn/Mydashboards) already writes into and
 * reads for its own Bellavita dashboard. Per the user's explicit
 * instruction, same pattern as gnc-sale-masmis-bulk.service.ts.
 *
 * Unlike gnc_sale/gnc_apr, this table's live column names DO match that
 * repo's own uploadBellavitaSales INSERT statement exactly (confirmed via
 * SHOW COLUMNS before writing this) -- no drift found here, so the
 * literal column list and mapping are trusted as-is.
 */

export const BB_SALE_HEADERS = [
  "Week", "Date", "EMP ID", "Emp_Name", "TL", "T1", "T2", "FHD", "Days",
  "Phone Number", "E-mail ID", "Payment Status", "Amount", "Bella Vita Order ID",
  "Campaign", "Calling Status", "Discount Code", "Count", "Current Status",
  "Final Status", "Order Date&Time", "State", "Line Item Name", "Pincode",
  "Order Date", "24Hrs&48hrs", "Crazy Deal", "Perfume", "Size",
  "Order Pickup Date", "RTO Initiated Date", "Diff Hour", "LOB",
  "Pincode Relevent", "RTO Status", "Draft Order", "Sale Source Name", "Shift",
] as const;

function get(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") {
      return String(data[k]).trim();
    }
  }
  return "";
}

function parseNullableFloat(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseNullableInt(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Excel serial or "DD-Mon-YY" text -> "YYYY-MM-DD". Ported from My
 * Dashboards' own parseBellavitaDate, date-only variant. */
export function parseBellavitaDateOnly(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "0" || v === "-") return null;
  const sn = parseFloat(v);
  if (Number.isFinite(sn) && sn > 40000 && sn < 60000) {
    const d = new Date((sn - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  // Day is 1-2 digits: the real Bellavita export writes "1-Sep-26" (no leading
  // zero) for the 1st-9th of a month, not just "01-Sep-26" -- a real sample row
  // ("1-Sep-26") confirmed every row failing the required-field check here,
  // since the day-only variant this used to require ((\d{2}), exactly 2 digits)
  // never matched a single-digit day at all.
  const m = /^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})$/i.exec(v);
  if (m) {
    // Day "0"/"00" is Excel's own degenerate text for a blank/zero date cell
    // (confirmed live: "0-Jan-00" was exactly what MySQL rejected as
    // '2000-01-00' -- MySQL has no day-zero date, and inserting it errors
    // rather than silently truncating since this connection runs with
    // strict SQL mode). A day of 0 was never a real FHD date to begin with,
    // so this reads as "no value" and returns null, same as a blank cell.
    const day = parseInt(m[1], 10);
    if (day < 1 || day > 31) return null;
    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const monthKey = m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase();
    const year = parseInt(m[3], 10) < 50 ? `20${m[3]}` : `19${m[3]}`;
    return `${year}-${months[monthKey]}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/** Excel serial or "DD-Mon-YY" text -> "YYYY-MM-DD HH:MM:SS". */
export function parseBellavitaDateTime(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "0" || v === "-") return null;
  const sn = parseFloat(v);
  if (Number.isFinite(sn) && sn > 40000 && sn < 60000) {
    const d = new Date((sn - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  const dateOnly = parseBellavitaDateOnly(v);
  return dateOnly ? `${dateOnly} 00:00:00` : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importBbSaleMasmisBatch(
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

    const orderId = get(data, "Bella Vita Order ID", "bella_vita_order_id", "bella vita order id");
    const saleDate = parseBellavitaDateOnly(get(data, "Date", "date"));
    if (!orderId || !saleDate) {
      const msg = `Row ${row.row_no}: "Bella Vita Order ID" and "Date" are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        get(data, "Week", "week"),
        saleDate,
        get(data, "EMP ID", "emp_id", "emp id"),
        get(data, "Emp_Name", "emp_name", "emp name"),
        get(data, "TL", "tl"),
        get(data, "T1", "t1"),
        get(data, "T2", "t2"),
        parseBellavitaDateOnly(get(data, "FHD", "fhd")),
        parseNullableInt(get(data, "Days", "days")),
        get(data, "Phone Number", "phone_number", "phone number"),
        get(data, "E-Mail ID", "E-mail ID", "email id", "email_id"),
        get(data, "Payment Status", "payment_status"),
        parseNullableFloat(get(data, "Amount", "amount")),
        orderId,
        get(data, "Campaign", "campaign"),
        get(data, "Calling Status", "calling_status"),
        get(data, "Discount Code", "discount_code"),
        parseNullableInt(get(data, "Count", "count")),
        get(data, "Current Status", "current_status"),
        get(data, "Final Status", "final_status"),
        parseBellavitaDateTime(get(data, "Order Date&Time", "order_datetime")) ??
          parseBellavitaDateTime(get(data, "Order Date", "order_date")),
        get(data, "State", "state"),
        get(data, "Line Item Name", "line_item_name"),
        get(data, "Pincode", "pincode"),
        parseBellavitaDateOnly(get(data, "Order Date", "order_date")),
        get(data, "24Hrs&48hrs", "hrs 24-48", "24hrs_48hrs"),
        get(data, "Crazy Deal", "crazy_deal"),
        get(data, "Perfume", "perfume"),
        get(data, "Size", "size"),
        parseBellavitaDateTime(get(data, "Order Pickup Date&Time", "order pickup date", "order_pickup_datetime")),
        parseBellavitaDateTime(get(data, "RTO Initiated Date&Time", "rto initiated date", "rto_initiated_datetime")),
        parseNullableInt(get(data, "Diff Hour", "diff_hour")),
        get(data, "LOB", "lob"),
        get(data, "Pincode Relevent", "pincode_relevent"),
        get(data, "RTO Status", "rto_status"),
        get(data, "Draft Order", "draft_order"),
        get(data, "16:08", "Time 1608"),
        get(data, "Sale Source Name", "sale_source_name"),
        get(data, "Shift", "shift"),
        null, // uploaded_by: HRMS user ids are UUIDs, don't fit this int column
        batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.bb_sale
       (week, Date, emp_id, emp_name, tl, t1, t2, FHD, days,
        phone_number, email_id, payment_status, amount, bella_vita_order_id,
        campaign, calling_status, discount_code, sale_count,
        current_status, final_status, Order_DateTime, state, line_item_name,
        pincode, \`Order Date\`, hrs_24_48, crazy_deal, perfume, size,
        order_pickup_datetime, rto_initiated_datetime, diff_hour,
        lob, pincode_relevent, rto_status, draft_order, time_1608,
        sale_source_name, shift, uploaded_by, upload_batch_id)`,
    // 41 columns in insertPrefix above (this used to be a 40-placeholder VALUES clause
    // even before this file's chunked-insert rewrite -- it never surfaced as a "column
    // count doesn't match" error only because every real row failed the earlier
    // required-field date check first and never reached this INSERT at all).
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'bb_sale', ?, ?, NULL)`,
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

  // Same convention as every other importer in this module (e.g. employee-master-bulk.service.ts)
  // -- this was missing here, which is why a completed batch stayed stuck at 'importing' forever
  // regardless of outcome instead of ever reaching a terminal status.
  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
