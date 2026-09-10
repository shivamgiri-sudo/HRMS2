import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

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
  const m = /^(\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})$/i.exec(v);
  if (m) {
    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const monthKey = m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase();
    const year = parseInt(m[3], 10) < 50 ? `20${m[3]}` : `19${m[3]}`;
    return `${year}-${months[monthKey]}-${m[1]}`;
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
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const orderId = get(data, "Bella Vita Order ID", "bella_vita_order_id", "bella vita order id");
    const saleDate = parseBellavitaDateOnly(get(data, "Date", "date"));
    if (!orderId || !saleDate) {
      const msg = `Row ${row.row_no}: "Bella Vita Order ID" and "Date" are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.bb_sale
           (week, Date, emp_id, emp_name, tl, t1, t2, FHD, days,
            phone_number, email_id, payment_status, amount, bella_vita_order_id,
            campaign, calling_status, discount_code, sale_count,
            current_status, final_status, Order_DateTime, state, line_item_name,
            pincode, \`Order Date\`, hrs_24_48, crazy_deal, perfume, size,
            order_pickup_datetime, rto_initiated_datetime, diff_hour,
            lob, pincode_relevent, rto_status, draft_order, time_1608,
            sale_source_name, shift, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
          get(data, "E-mail ID", "email id", "email_id"),
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

  return { importedRows, errorRows, errors };
}
