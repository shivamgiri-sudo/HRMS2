import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * GNC's real "Date & Camp wise Overall Sale" sheet -- written straight into
 * the ALREADY-LIVE db_masmis.gnc_sale table (1399 real rows, most recent
 * upload 2026-07-02), the same table the separate "My Dashboards" tool
 * (github.com/tausifansari-mcn/Mydashboards) writes into and reads for its
 * own GNC dashboard. Per the user's explicit instruction, this uploader
 * targets that SAME existing table rather than duplicating GNC sale data
 * into a new mas_hrms table -- My Dashboards' uploads had gone stale for
 * over a month (last upload_log entry 2026-08-11 across all its tables),
 * so this gives HRMS2 its own working front door onto the same live data.
 *
 * Column mapping and the '-' -> blank convention are ported from that
 * repo's own sales.controller.ts/sales.service.ts (uploadGnc/uploadGncSales),
 * which is the ground truth for what real GNC export files look like --
 * but NOT its literal INSERT statement, which has drifted from the live
 * schema: that repo's current code inserts into columns "Date" and
 * "gnc_order_id", neither of which exist on the live table (confirmed via
 * SHOW COLUMNS) -- the real columns are "sale_date" and "order_id". This
 * service targets the verified live column names, not the repo's code.
 *
 * No dedup key: db_masmis.gnc_sale has none (My Dashboards' own upload_log
 * pattern is insert-only, revert-by-deleting-the-batch), and introducing
 * one here would silently diverge from how every other row in this shared
 * table already behaves. upload_batch_id tags each row for the same kind
 * of revert.
 */

export const GNC_SALE_HEADERS = [
  "Week", "Date", "EMP ID", "Emp_Name", "TL", "T1", "T3", "CustomerNumber",
  "E-mail ID", "Payment Status", "Gross Amount", "Sum Before GST", "OrderID",
  "Campaign", "Discount Code", "Count", "Status", "Lineitem name", "Sale Lob",
  "Target", "Sale Source",
] as const;

function get(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") {
      return String(data[k]).trim();
    }
  }
  return "";
}

/** The source sheet uses the literal string '-' as its "no value" placeholder in several columns. */
function blankDash(v: string): string {
  return v === "-" ? "" : v;
}

function parseNullableFloat(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseNullableInt(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Excel serial number or "DD-Mon-YY" text -> "YYYY-MM-DD HH:MM:SS". Ported from
 * My Dashboards' own parseBellavitaDate (also used for GNC's own date columns there). */
export function parseGncDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "0" || v === "-") return null;
  const sn = parseFloat(v);
  if (Number.isFinite(sn) && sn > 40000 && sn < 60000) {
    const d = new Date((sn - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  const m = /^(\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})$/i.exec(v);
  if (m) {
    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const monthKey = m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase();
    const year = parseInt(m[3], 10) < 50 ? `20${m[3]}` : `19${m[3]}`;
    return `${year}-${months[monthKey]}-${m[1]} 00:00:00`;
  }
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importGncSaleMasmisBatch(
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

    const orderId = get(data, "OrderID", "GNC Order ID", "gnc order id", "gnc_order_id");
    const saleDate = parseGncDate(get(data, "Date", "date"));
    if (!orderId || !saleDate) {
      const msg = `Row ${row.row_no}: "OrderID" and "Date" are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.gnc_sale
           (week, sale_date, emp_id, emp_name, tl, t1, t3, customer_number, email_id,
            payment_status, gross_amount, sum_before_gst, order_id, campaign, discount_code,
            sale_count, status, line_item_name, sale_lob, target, sale_source,
            uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          get(data, "Week", "week"),
          saleDate,
          get(data, "EMP ID", "emp_id", "emp id"),
          get(data, "Emp_Name", "emp_name", "emp name"),
          get(data, "TL", "tl"),
          parseGncDate(get(data, "T1", "t1")), // t1 is a real DATE column, not free text
          get(data, "T3", "t3"),
          blankDash(get(data, "CustomerNumber", "customer number", "customer_number")),
          blankDash(get(data, "E-mail ID", "email id", "email_id")),
          get(data, "Payment Status", "payment_status"),
          parseNullableFloat(get(data, "Gross Amount", "gross_amount")),
          parseNullableFloat(get(data, "Sum Before GST", "sum_before_gst")),
          orderId,
          get(data, "Campaign", "campaign"),
          blankDash(get(data, "Discount Code", "discount_code")),
          parseNullableInt(get(data, "Count", "count")),
          get(data, "Status", "status"),
          blankDash(get(data, "Lineitem name", "line_item_name", "line item name")),
          get(data, "Sale Lob", "sale_lob"),
          parseNullableInt(get(data, "Target", "target")),
          get(data, "Sale Source", "sale_source"),
          null, // uploaded_by: My Dashboards' numeric user id space -- HRMS user ids are UUIDs
                // and don't fit this int column; the real HRMS uploader is tracked on our own
                // upload_batch row instead, never fabricated as a fake numeric id here.
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
       VALUES (?, 'gnc_sale', ?, ?, NULL)`,
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
