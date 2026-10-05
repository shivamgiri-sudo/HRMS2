/**
 * Bellavita Sale (db_masmis.bb_sale) check-and-upsert.
 *
 * For each row's Bella Vita Order ID: INSERT if the order id doesn't exist
 * yet in bb_sale; if it already exists, UPDATE only calling_status and
 * current_status on every existing row for that order id (every other
 * column, and any pre-existing duplicate rows, are left untouched).
 *
 * Column mapping/date parsing reuses bb-sale-masmis-bulk.service.ts's own
 * exported parseBellavitaDateOnly/parseBellavitaDateTime, so a row inserted
 * here is identical to one a browser upload through the app would produce.
 */
import XLSX from "xlsx";
import { db } from "../../../src/db/mysql.js";
import { parseBellavitaDateOnly, parseBellavitaDateTime } from "../../../src/modules/bulk-upload/bb-sale-masmis-bulk.service.js";

export interface SaleUploadOptions {
  execute: boolean;
  /** Insert new order ids but skip the calling_status/current_status update pass on existing ones. */
  skipUpdates?: boolean;
}
export interface SaleUploadResult {
  totalRows: number;
  newOrderIds: number;
  existingOrderIds: number;
  inserted: number;
  insertErrors: number;
  updatedRows: number;
}

function get(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return v === undefined || v === null ? "" : String(v).trim();
}
function parseNullableFloat(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function parseNullableInt(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export async function runSaleUpload(filePath: string, opts: SaleUploadOptions): Promise<SaleUploadResult> {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  console.log(`[sale] Read ${rows.length} rows from ${filePath}`);

  const orderIds = [...new Set(rows.map((r) => get(r, "Bella Vita Order ID")).filter(Boolean))];
  const existing = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const [existRows] = await db.execute<any[]>(
      `SELECT DISTINCT bella_vita_order_id FROM db_masmis.bb_sale WHERE bella_vita_order_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const r of existRows) existing.add(r.bella_vita_order_id);
  }

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ orderId: string; callingStatus: string; currentStatus: string }> = [];
  for (const r of rows) {
    const orderId = get(r, "Bella Vita Order ID");
    if (!orderId) continue;
    if (existing.has(orderId)) toUpdate.push({ orderId, callingStatus: get(r, "Calling Status"), currentStatus: get(r, "Current Status") });
    else toInsert.push(r);
  }
  console.log(`[sale] New order ids to INSERT: ${toInsert.length}`);
  console.log(`[sale] Existing order ids to UPDATE (calling_status/current_status only): ${toUpdate.length}`);

  if (!opts.execute) {
    console.log("[sale] DRY RUN -- no writes made.");
    return { totalRows: rows.length, newOrderIds: toInsert.length, existingOrderIds: toUpdate.length, inserted: 0, insertErrors: 0, updatedRows: 0 };
  }

  let inserted = 0;
  let insertErrors = 0;
  for (const r of toInsert) {
    const orderId = get(r, "Bella Vita Order ID");
    const saleDate = parseBellavitaDateOnly(get(r, "Date"));
    if (!saleDate) { console.warn(`[sale] Skipping insert for ${orderId}: unparseable Date`); insertErrors += 1; continue; }
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          get(r, "Week"), saleDate, get(r, "EMP ID"), get(r, "Emp_Name"), get(r, "TL"), get(r, "T1"), get(r, "T2"),
          parseBellavitaDateOnly(get(r, "FHD")), parseNullableInt(get(r, "Days")),
          get(r, "Phone Number"), get(r, "E-mail ID"), get(r, "Payment Status"), parseNullableFloat(get(r, "Amount")),
          orderId, get(r, "Campaign"), get(r, "Calling Status"), get(r, "Discount Code"), parseNullableInt(get(r, "Count")),
          get(r, "Current Status"), get(r, "Final Status"),
          parseBellavitaDateTime(get(r, "Order Date&Time")) ?? parseBellavitaDateTime(get(r, "Order Date")),
          get(r, "State"), get(r, "Line Item Name"), get(r, "Pincode"), parseBellavitaDateOnly(get(r, "Order Date")),
          get(r, "24Hrs&48hrs"), get(r, "Crazy Deal"), get(r, "Perfume"), get(r, "Size"),
          parseBellavitaDateTime(get(r, "Order Pickup Date")), parseBellavitaDateTime(get(r, "RTO Initiated Date")),
          parseNullableInt(get(r, "Diff Hour")), get(r, "LOB"), get(r, "Pincode Relevent"), get(r, "RTO Status"),
          get(r, "Draft Order"), get(r, "16:08") || get(r, "Time 1608"), get(r, "Sale Source Name"), get(r, "Shift"), null, null,
        ],
      );
      inserted += 1;
    } catch (e) {
      console.warn(`[sale] Insert failed for ${orderId}:`, e instanceof Error ? e.message : e);
      insertErrors += 1;
    }
  }

  let updated = 0;
  if (opts.skipUpdates) {
    console.log(`[sale] Skipping the ${toUpdate.length} calling_status/current_status updates (skipUpdates=true).`);
  } else {
    for (const u of toUpdate) {
      const [result] = await db.execute<any>(
        `UPDATE db_masmis.bb_sale SET calling_status = ?, current_status = ? WHERE bella_vita_order_id = ?`,
        [u.callingStatus, u.currentStatus, u.orderId],
      );
      updated += result.affectedRows ?? 0;
    }
  }

  if (inserted > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by) VALUES (UUID(), 'bb_sale', ?, ?, NULL)`,
      [filePath, inserted],
    );
  }

  console.log(`[sale] Done. Inserted ${inserted} (${insertErrors} errors). Updated ${updated} rows across ${toUpdate.length} order ids.`);
  return { totalRows: rows.length, newOrderIds: toInsert.length, existingOrderIds: toUpdate.length, inserted, insertErrors, updatedRows: updated };
}
