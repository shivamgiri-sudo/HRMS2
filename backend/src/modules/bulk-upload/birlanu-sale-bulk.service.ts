import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * birlanu_sale -- writes into db_masmis.birlanu_sale (sql/1770). Source: Birlanu Sale.xlsx / Birlanu APR.xlsx (Sale Raw sheet).
 * Columns confirmed directly against the real file, not guessed.
 */

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getByColumn(data: Record<string, unknown>, ...columnNames: string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const col of columnNames) {
    const v = normalized[normalizeKey(col)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function n(data: Record<string, unknown>, ...columnNames: string[]): string | null {
  const v = getByColumn(data, ...columnNames);
  return v || null;
}
/** Exact-case lookup, for the rare case where two real headers differ only
 * by case (e.g. "Login" vs "LOGIN") -- normalizeKey() would otherwise
 * collide them onto the same key. */
function exact(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  if (v === undefined || v === null || String(v).trim() === "") return null;
  return String(v).trim();
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importBirlanuSaleBatch(
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

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const requiredVal = getByColumn(data, "Unique Id");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "Unique Id" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.birlanu_sale
           (week_month, weeks, days, lead_register_month, report_date, lead_id, unique_id, customer_name, customer_type, calling_number, enquiry_type, enquiry_source, sub_enquiry_source, lead_register_date, lead_outcalled_date, call_type, calling_status, interested_status, sub_calling_status, sub_sub_calling_status, select_business, buyer_type, lead_status, construction_level, customer_name_2, alternative_number, email_id, address, landmark, brand, product, sub_product, state, district, zone, pincode, agent_name, order_qty, order_description, order_value, customer_type_select, registration_status, remark, secure_url, seller_email_id, seller_phone_no, lead_closer_status, lead_closer_status_new, merged_lead_closer_status, lead_close_date, final_lead_close_date, lead_upload_type, created_by, updated_by, created_at_src, updated_at_src, sale_mt, sale_inr, sale_team_remarks, sale_lead_status, cc_fil_remarks_reformat, sale_lead_category, sale_product, sale_product_value, sale_status, attempt, revised_source, lead_closer_month, organic_paid, partner, helper, closed, first_call_date_time, created_at_ist, frt, within_tat, bucket, for_fr_tat, created_at_ist_2, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n(data, "Week/Month"),
          n(data, "Weeks"),
          n(data, "Days"),
          n(data, "LeadRegisterMonth"),
          n(data, "Date"),
          n(data, "ID"),
          requiredVal,
          n(data, "Customer Name"),
          n(data, "Customer Type"),
          n(data, "Calling Number"),
          n(data, "Enquiry Type"),
          n(data, "Enquiry Source"),
          n(data, "Sub Enquiry Source"),
          n(data, "LeadRegisterDate"),
          n(data, "LeadOutcalledDate"),
          n(data, "Call type"),
          n(data, "Calling Status"),
          n(data, "Interested Status"),
          n(data, "Sub Calling Status"),
          n(data, "Sub Sub Calling Status"),
          n(data, "Select Business"),
          n(data, "Buyer Type"),
          n(data, "Lead Status"),
          n(data, "Construction Level"),
          n(data, "Customer Name_1"),
          n(data, "Alternative Number"),
          n(data, "Email ID"),
          n(data, "Address"),
          n(data, "Landmark"),
          n(data, "Brand"),
          n(data, "Product"),
          n(data, "Sub Product"),
          n(data, "State"),
          n(data, "District"),
          n(data, "Zone"),
          n(data, "Pincode"),
          n(data, "Agent Name"),
          n(data, "Order Qty"),
          n(data, "Order Description"),
          n(data, "Order Value"),
          n(data, "Customer Type Select"),
          n(data, "Registration Status"),
          n(data, "Remark"),
          n(data, "Secure URL"),
          n(data, "Seller Email ID"),
          n(data, "Seller Phone No"),
          n(data, "Lead Closer Status"),
          n(data, "Lead Closer Status New"),
          n(data, "merged Lead Closer Status"),
          n(data, "Lead Close Date"),
          n(data, "Final Lead Close Date"),
          n(data, "Lead Upload Type"),
          n(data, "Created By"),
          n(data, "Updated By"),
          n(data, "Created At"),
          n(data, "Updated At"),
          n(data, "Sale MT"),
          n(data, "Sale INR"),
          n(data, "Sale Team Remarks"),
          n(data, "Sale Lead Status"),
          n(data, "CC Fi-l Remarks Reformat"),
          n(data, "Sale Lead Category"),
          n(data, "Sale Product"),
          n(data, "Sale Product Value"),
          n(data, "Sale Status"),
          n(data, "Attempt"),
          n(data, "Revised Source"),
          n(data, "Lead Closer Month"),
          n(data, "Organic/Paid"),
          n(data, "Partner"),
          n(data, "Helper"),
          n(data, "Closed"),
          n(data, "First Call Date & Time"),
          n(data, "Created At (IST)"),
          n(data, "FRT"),
          n(data, "Within TAT"),
          n(data, "Bucket"),
          n(data, "For FR TAT"),
          n(data, "Created At (IST)_1"),
          uploadedByInt, batchId,
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
       VALUES (?, 'birlanu_sale', ?, ?, NULL)`,
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

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
