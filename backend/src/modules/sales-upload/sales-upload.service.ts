import * as XLSX from "xlsx";
import { v4 as uuidv4 } from "uuid";
import { queryMasmis } from "../../db/masmisDb.js";
import { querySource } from "../../db/sourceDb.js";

// â”€â”€ Date helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parseBellavitaDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  // Excel serial (e.g. 45123)
  if (/^\d{5,6}$/.test(s)) {
    const n = parseInt(s, 10);
    if (n > 40000 && n < 60000) {
      const d = new Date(Date.UTC(1900, 0, n - 1));
      return d.toISOString().slice(0, 10);
    }
  }
  // DD-Mon-YY e.g. "04-Apr-24"
  const mon: Record<string, number> = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
  };
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const yr = parseInt(m[3], 10);
    const year = yr < 100 ? 2000 + yr : yr;
    const month = mon[m[2].toLowerCase()];
    if (month != null) {
      const d = new Date(Date.UTC(year, month, parseInt(m[1], 10)));
      return d.toISOString().slice(0, 10);
    }
  }
  // Fallback: native parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseChatDatetime(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace("T", " ");
  return null;
}

// â”€â”€ Upload log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// FIXED 2026-09-10: every INSERT/DELETE-side function in this file previously wrote to
// column names that do not exist on the real db_masmis tables -- confirmed independently
// this session (not guessed) by cloning the actual source of these tables,
// github.com/tausifansari-mcn/Mydashboards ("My Dashboards"), reading its own real
// sales.controller.ts/sales.service.ts column mappings, and cross-checking every single
// one against SHOW COLUMNS + real sample rows on the live db_masmis tables themselves.
// Two more real discrepancies were found even in that repo's own current code (gnc_sale's
// real columns are sale_date/order_id, not Date/gnc_order_id; gnc_apr's duration columns
// are fraction-of-a-day decimal text, not HH:MM:SS) -- fixed against the verified LIVE
// schema in every case, not either source blindly. logUpload's real columns are
// id/batch_id/table_name/file_name/row_count/uploaded_by/uploaded_at, not
// upload_type/month_label -- this predates every upload*() function ever landing a row.

export async function logUpload(
  uploadType: string, _monthLabel: string, rowCount: number,
  uploadedBy: string, batchId: string
): Promise<void> {
  await queryMasmis(
    `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
     VALUES (?, ?, ?, ?, NULL)`,
    [batchId, uploadType, `sales-upload by ${uploadedBy}`, rowCount]
  );
}

export async function getUploadLogs(limit = 50): Promise<Record<string, unknown>[]> {
  // db_masmis.upload_log's real columns are (id, batch_id, table_name, file_name, row_count,
  // uploaded_by, uploaded_at) â€” verified live 2026-08-13 (35 real rows, e.g. table_name
  // 'bvo_order_export', file_name "Dec'25.xlsx"). upload_type/month_label/created_at never
  // existed; this SELECT threw ER_BAD_FIELD_ERROR on every call. Aliased back to the original
  // names so callers reading upload_type/month_label/created_at keep working.
  //
  // A second, independent bug found live alongside the column fix: mysql2's `.execute()`
  // (prepared statement / binary protocol, what queryMasmis always uses) cannot bind a
  // `LIMIT ?` placeholder against this server â€” confirmed directly, "Incorrect arguments to
  // mysqld_stmt_execute", while the identical SQL succeeds via `.query()` (text protocol).
  // This predates the column fix; it would have thrown on every call regardless. Since
  // limit is a JS number the caller (the /logs route) already clamps to <= 200, it's safe
  // to validate-and-inline rather than bind, sidestepping the prepared-statement limitation
  // without opening any injection surface.
  const safeLimit = Math.min(200, Math.max(1, Math.floor(Number(limit)) || 50));
  return queryMasmis(
    `SELECT id, batch_id, table_name AS upload_type, file_name AS month_label, row_count, uploaded_by, uploaded_at AS created_at
     FROM db_masmis.upload_log ORDER BY uploaded_at DESC LIMIT ${safeLimit}`
  );
}

/**
 * Every db_masmis table a sales upload writes, each tagged per row with
 * upload_batch_id and logged in upload_log under this name (logUpload's first
 * argument). The AW and Neemans tables were missing from the delete list, so
 * deleting one of their batches removed the log entry and left the data behind
 * (none orphaned yet, checked 2026-09-15). Also an allowlist: table names are
 * interpolated into SQL.
 */
export const BATCH_TABLES = [
  "bb_sale", "bb_apr", "bb_chat", "bb_cart",
  "gnc_sale", "gnc_apr", "gnc_allocation",
  "aw_out", "aw_billing", "aw_mandate", "aw_inbound", "aw_new_cdr",
  "neemans_sale_raw",
] as const;

export async function deleteUploadBatch(batchId: string): Promise<void> {
  // Batch ids are unique UUIDs, so clearing every table is exact.
  for (const tbl of BATCH_TABLES) {
    await queryMasmis(`DELETE FROM db_masmis.${tbl} WHERE upload_batch_id = ?`, [batchId]);
  }
  await queryMasmis(`DELETE FROM db_masmis.upload_log WHERE batch_id = ?`, [batchId]);
}

/**
 * One upload batch for its drill-down: the upload_log entry, how many rows the
 * target table still holds for it (a mismatch with row_count means rows went
 * missing or were added later), and the first 20 rows as uploaded.
 */
export async function getUploadBatch(batchId: string): Promise<{
  log: Record<string, unknown>;
  table: string;
  rowsInTable: number | null;
  sample: Record<string, unknown>[];
} | null> {
  const logs = await queryMasmis(
    `SELECT id, batch_id, table_name, file_name, row_count, uploaded_by, uploaded_at
       FROM db_masmis.upload_log WHERE batch_id = ? ORDER BY uploaded_at LIMIT 1`, [batchId]);
  const log = logs[0];
  if (!log) return null;
  const table = String(log.table_name ?? "");
  if (!(BATCH_TABLES as readonly string[]).includes(table)) return { log, table, rowsInTable: null, sample: [] };
  const [count] = await queryMasmis(
    `SELECT COUNT(*) AS n FROM db_masmis.${table} WHERE upload_batch_id = ?`, [batchId]);
  // LIMIT inlined: queryMasmis uses prepared statements, which cannot bind LIMIT
  // here (see getUploadLogs).
  const sample = await queryMasmis(
    `SELECT * FROM db_masmis.${table} WHERE upload_batch_id = ? LIMIT 20`, [batchId]);
  return { log, table, rowsInTable: Number(count?.n ?? 0), sample };
}

// â”€â”€ Bellavita Sales Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// db_masmis.bb_sale's real columns (verified via SHOW COLUMNS + the real My Dashboards
// source, github.com/tausifansari-mcn/Mydashboards): week, Date, emp_id, emp_name, tl, t1,
// t2, FHD, days, phone_number, email_id, payment_status, amount, bella_vita_order_id,
// campaign, calling_status, discount_code, sale_count, current_status, final_status,
// Order_DateTime, state, line_item_name, pincode, "Order Date", hrs_24_48, crazy_deal,
// perfume, size, order_pickup_datetime, rto_initiated_datetime, diff_hour, lob,
// pincode_relevent, rto_status, draft_order, time_1608, sale_source_name, shift.
function getField(r: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== "") return String(r[k]).trim();
  }
  return "";
}
function nullableNumber(v: string): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function nullableInt(v: string): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

async function batchInsertRows(
  table: string,
  colsSql: string,
  rowPh: string,
  rows: (string | number | null)[][],
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await queryMasmis(
      `INSERT INTO db_masmis.${table} ${colsSql} VALUES ${chunk.map(() => rowPh).join(",")}`,
      chunk.flat(),
    );
  }
}

export async function uploadBellavitaSales(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  const validRows: (string | number | null)[][] = [];
  for (const r of rows) {
    const orderId = getField(r, "Bella Vita Order ID", "bella_vita_order_id");
    const saleDate = parseBellavitaDate(r["Date"] ?? r["date"]);
    if (!orderId || !saleDate) continue;
    validRows.push([
      getField(r, "Week", "week"), saleDate,
      getField(r, "EMP ID", "emp_id"), getField(r, "Emp_Name", "emp_name"),
      getField(r, "TL", "tl"), getField(r, "T1", "t1"), getField(r, "T2", "t2"),
      parseBellavitaDate(r["FHD"] ?? r["fhd"]),
      nullableInt(getField(r, "Days", "days")),
      getField(r, "Phone Number", "phone_number"), getField(r, "E-mail ID", "email_id"),
      getField(r, "Payment Status", "payment_status"),
      nullableNumber(getField(r, "Amount", "amount")),
      orderId, getField(r, "Campaign", "campaign"),
      getField(r, "Calling Status", "calling_status"), getField(r, "Discount Code", "discount_code"),
      nullableInt(getField(r, "Count", "count")),
      getField(r, "Current Status", "current_status"), getField(r, "Final Status", "final_status"),
      parseBellavitaDate(r["Order Date&Time"] ?? r["order_datetime"]),
      getField(r, "State", "state"), getField(r, "Line Item Name", "line_item_name"),
      getField(r, "Pincode", "pincode"),
      parseBellavitaDate(r["Order Date"] ?? r["order_date"]),
      getField(r, "24Hrs&48hrs", "hrs_24_48"), getField(r, "Crazy Deal", "crazy_deal"),
      getField(r, "Perfume", "perfume"), getField(r, "Size", "size"),
      parseBellavitaDate(r["Order Pickup Date"] ?? r["order_pickup_datetime"]),
      parseBellavitaDate(r["RTO Initiated Date"] ?? r["rto_initiated_datetime"]),
      nullableInt(getField(r, "Diff Hour", "diff_hour")),
      getField(r, "LOB", "lob"), getField(r, "Pincode Relevent", "pincode_relevent"),
      getField(r, "RTO Status", "rto_status"), getField(r, "Draft Order", "draft_order"),
      getField(r, "16:08", "time_1608"), getField(r, "Sale Source Name", "sale_source_name"),
      getField(r, "Shift", "shift"), batchId,
    ]);
  }
  await batchInsertRows(
    "bb_sale",
    `(week, Date, emp_id, emp_name, tl, t1, t2, FHD, days, phone_number, email_id,
      payment_status, amount, bella_vita_order_id, campaign, calling_status, discount_code,
      sale_count, current_status, final_status, Order_DateTime, state, line_item_name,
      pincode, \`Order Date\`, hrs_24_48, crazy_deal, perfume, size, order_pickup_datetime,
      rto_initiated_datetime, diff_hour, lob, pincode_relevent, rto_status, draft_order,
      time_1608, sale_source_name, shift, upload_batch_id)`,
    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    validRows,
  );
  const monthLabel = rows[0] ? (parseBellavitaDate(rows[0]["Date"] ?? rows[0]["date"]) ?? "").slice(0, 7) : "";
  await logUpload("bb_sale", monthLabel, validRows.length, uploadedBy, batchId);
  return { rowsInserted: validRows.length };
}

// â”€â”€ GNC Sales Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// db_masmis.gnc_sale's real columns: week, sale_date, emp_id, emp_name, tl, t1, t3,
// customer_number, email_id, payment_status, gross_amount, sum_before_gst, order_id,
// campaign, discount_code, sale_count, status, line_item_name, sale_lob, target,
// sale_source. Note: even My Dashboards' own current code targets "Date"/"gnc_order_id"
// here, neither of which exist -- confirmed via SHOW COLUMNS, not assumed from that repo.
export async function uploadGncSales(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  const validRows: (string | number | null)[][] = [];
  for (const r of rows) {
    const orderId = getField(r, "OrderID", "GNC Order ID", "order_id");
    const saleDate = parseBellavitaDate(r["Date"] ?? r["date"]);
    if (!orderId || !saleDate) continue;
    validRows.push([
      getField(r, "Week", "week"), saleDate,
      getField(r, "EMP ID", "emp_id"), getField(r, "Emp_Name", "emp_name"),
      getField(r, "TL", "tl"), parseBellavitaDate(r["T1"] ?? r["t1"]), getField(r, "T3", "t3"),
      getField(r, "CustomerNumber", "customer_number"), getField(r, "E-mail ID", "email_id"),
      getField(r, "Payment Status", "payment_status"),
      nullableNumber(getField(r, "Gross Amount", "gross_amount")),
      nullableNumber(getField(r, "Sum Before GST", "sum_before_gst")),
      orderId, getField(r, "Campaign", "campaign"), getField(r, "Discount Code", "discount_code"),
      nullableInt(getField(r, "Count", "count")), getField(r, "Status", "status"),
      getField(r, "Lineitem name", "line_item_name"), getField(r, "Sale Lob", "sale_lob"),
      nullableInt(getField(r, "Target", "target")), getField(r, "Sale Source", "sale_source"),
      batchId,
    ]);
  }
  await batchInsertRows(
    "gnc_sale",
    `(week, sale_date, emp_id, emp_name, tl, t1, t3, customer_number, email_id,
      payment_status, gross_amount, sum_before_gst, order_id, campaign, discount_code,
      sale_count, status, line_item_name, sale_lob, target, sale_source, upload_batch_id)`,
    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    validRows,
  );
  const monthLabel = rows[0] ? (parseBellavitaDate(rows[0]["Date"] ?? rows[0]["date"]) ?? "").slice(0, 7) : "";
  await logUpload("gnc_sale", monthLabel, validRows.length, uploadedBy, batchId);
  return { rowsInserted: validRows.length };
}

// â”€â”€ GNC APR Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// db_masmis.gnc_apr's real columns: uid, report_date, user_name, emp_id, tl_name, calls,
// process_type, login_time, wait_time, talk_time, dispo_time, pause_time, login_duration,
// logout_time, acht, aoc, bio, bre, briefing, down_time, lunch, meet, qa, sb, tea_break,
// training_break, wash, net_login, break_time, tra_qa, downtime, atten, capping. Duration
// columns are fraction-of-a-day decimal TEXT in real live data (e.g.
// "0.4047337962962963"), not HH:MM:SS -- kept as raw text for consistency with existing rows.
export async function uploadGncApr(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  const validRows: (string | number | null)[][] = [];
  for (const r of rows) {
    const userName = getField(r, "user_name", "User Name");
    const reportDate = parseBellavitaDate(r["report_date"] ?? r["Date"]);
    if (!userName || !reportDate) continue;
    validRows.push([
      getField(r, "uid") || null, reportDate, userName, getField(r, "emp_id") || null,
      getField(r, "tl_name") || null, nullableInt(getField(r, "calls")),
      getField(r, "process_type") || null, getField(r, "login_time") || null,
      getField(r, "wait_time") || null, getField(r, "talk_time") || null,
      getField(r, "dispo_time") || null, getField(r, "pause_time") || null,
      getField(r, "login_duration") || null, getField(r, "logout_time") || null,
      nullableInt(getField(r, "acht")), getField(r, "aoc") || null, getField(r, "bio") || null,
      getField(r, "bre") || null, getField(r, "briefing") || null, getField(r, "down_time") || null,
      getField(r, "lunch") || null, getField(r, "meet") || null, getField(r, "qa") || null,
      getField(r, "sb") || null, getField(r, "tea_break") || null, getField(r, "training_break") || null,
      getField(r, "wash") || null, getField(r, "net_login") || null, getField(r, "break_time") || null,
      getField(r, "tra_qa") || null, getField(r, "downtime") || null, nullableInt(getField(r, "atten")),
      getField(r, "capping") || null, batchId,
    ]);
  }
  await batchInsertRows(
    "gnc_apr",
    `(uid, report_date, user_name, emp_id, tl_name, calls, process_type, login_time,
      wait_time, talk_time, dispo_time, pause_time, login_duration, logout_time, acht,
      aoc, bio, bre, briefing, down_time, lunch, meet, qa, sb, tea_break, training_break,
      wash, net_login, break_time, tra_qa, downtime, atten, capping, upload_batch_id)`,
    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    validRows,
  );
  const monthLabel = rows[0] ? (parseBellavitaDate(rows[0]["report_date"] ?? rows[0]["Date"]) ?? "").slice(0, 7) : "";
  await logUpload("gnc_apr", monthLabel, validRows.length, uploadedBy, batchId);
  return { rowsInserted: validRows.length };
}

// â”€â”€ GNC Allocation Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// db_masmis.gnc_allocation's real columns: uid, alloc_date, helper, date_type, time_slot,
// store, customer_name, email, total, created_at, lineitem_name, lineitem_sku,
// shipping_name, shipping_street, shipping_city, shipping_zip, shipping_phone, emp_id,
// calling_status, sub_scenarios_1, callback_date, same_day_connect, nc_connect.
// Split into insertGncAllocationRows(rows) + uploadGncAllocation(buffer) so Process Performance
// V2's bulk-upload importer (gnc-allocation-masmis-bulk.service.ts) shares this exact row-insert
// logic against db_masmis.gnc_allocation instead of duplicating it as a second writer.
export async function insertGncAllocationRows(
  rows: Record<string, unknown>[], uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const batchId = uuidv4();
  const monthLabel = currentMonthLabel();
  const validRows: (string | number | null)[][] = [];
  for (const r of rows) {
    const uid = getField(r, "uid");
    if (!uid) continue;
    validRows.push([
      uid, parseBellavitaDate(r["alloc_date"]), getField(r, "helper") || null,
      getField(r, "date_type") || null, getField(r, "time_slot") || null,
      getField(r, "store") || null, getField(r, "customer_name") || null,
      getField(r, "email") || null, nullableNumber(getField(r, "total")),
      getField(r, "created_at") || null, getField(r, "lineitem_name") || null,
      getField(r, "lineitem_sku") || null, getField(r, "shipping_name") || null,
      getField(r, "shipping_street") || null, getField(r, "shipping_city") || null,
      getField(r, "shipping_zip") || null, getField(r, "shipping_phone") || null,
      getField(r, "emp_id") || null, getField(r, "calling_status") || null,
      getField(r, "sub_scenarios_1") || null, parseBellavitaDate(r["callback_date"]),
      getField(r, "same_day_connect") || null, getField(r, "nc_connect") || null,
      batchId,
    ]);
  }
  await batchInsertRows(
    "gnc_allocation",
    `(uid, alloc_date, helper, date_type, time_slot, store, customer_name, email, total,
      created_at, lineitem_name, lineitem_sku, shipping_name, shipping_street,
      shipping_city, shipping_zip, shipping_phone, emp_id, calling_status,
      sub_scenarios_1, callback_date, same_day_connect, nc_connect, upload_batch_id)`,
    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    validRows,
  );
  await logUpload("gnc_allocation", monthLabel, validRows.length, uploadedBy, batchId);
  return { rowsInserted: validRows.length };
}

export async function uploadGncAllocation(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  return insertGncAllocationRows(rows, uploadedBy);
}

// â”€â”€ Bellavita APR Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// db_masmis.bb_apr's real columns: unique_id, week, report_date, emp_name, noiid,
// num_calls_chat, lob, login_time, wait_time, talk_time, dispo_time, pause_time, acht,
// lunch, tea, tea1, washr, team_briefing_aux, net_pause, avg_dispo, total_break,
// actual_login_hrs, downtime, login_duration, logout_time, net_login_hrs, utilization,
// attendance_1, week_1, mtd, team_leader, fhd, tenure, tenurity_week, sub_lob,
// unique_count, attendance_2, capping, attendance_3. Duration columns are fraction-of-a-
// day decimal TEXT in real live data, same convention as gnc_apr above.
export async function uploadBellavitaApr(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  const validRows: (string | number | null)[][] = [];
  for (const r of rows) {
    const empName = getField(r, "emp_name");
    const reportDate = parseBellavitaDate(r["report_date"] ?? r["Date"]);
    if (!empName || !reportDate) continue;
    validRows.push([
      getField(r, "unique_id") || null, getField(r, "week") || null, reportDate, empName,
      getField(r, "noiid") || null, nullableInt(getField(r, "num_calls_chat")),
      getField(r, "lob") || null, getField(r, "login_time") || null, getField(r, "wait_time") || null,
      getField(r, "talk_time") || null, getField(r, "dispo_time") || null, getField(r, "pause_time") || null,
      nullableInt(getField(r, "acht")), getField(r, "lunch") || null, getField(r, "tea") || null,
      getField(r, "tea1") || null, getField(r, "washr") || null, getField(r, "team_briefing_aux") || null,
      getField(r, "net_pause") || null, getField(r, "avg_dispo") || null, getField(r, "total_break") || null,
      getField(r, "actual_login_hrs") || null, getField(r, "downtime") || null,
      getField(r, "login_duration") || null, getField(r, "logout_time") || null,
      getField(r, "net_login_hrs") || null, getField(r, "utilization") || null,
      getField(r, "attendance_1") || null, getField(r, "week_1") || null, getField(r, "mtd") || null,
      getField(r, "team_leader") || null, getField(r, "fhd") || null, nullableInt(getField(r, "tenure")),
      getField(r, "tenurity_week") || null, getField(r, "sub_lob") || null,
      nullableInt(getField(r, "unique_count")), getField(r, "attendance_2") || null,
      getField(r, "capping") || null, getField(r, "attendance_3") || null, batchId,
    ]);
  }
  await batchInsertRows(
    "bb_apr",
    `(unique_id, week, report_date, emp_name, noiid, num_calls_chat, lob, login_time,
      wait_time, talk_time, dispo_time, pause_time, acht, lunch, tea, tea1, washr,
      team_briefing_aux, net_pause, avg_dispo, total_break, actual_login_hrs, downtime,
      login_duration, logout_time, net_login_hrs, utilization, attendance_1, week_1,
      mtd, team_leader, fhd, tenure, tenurity_week, sub_lob, unique_count,
      attendance_2, capping, attendance_3, upload_batch_id)`,
    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    validRows,
  );
  const monthLabel = rows[0] ? (parseBellavitaDate(rows[0]["report_date"] ?? rows[0]["Date"]) ?? "").slice(0, 7) : "";
  await logUpload("bb_apr", monthLabel, validRows.length, uploadedBy, batchId);
  return { rowsInserted: validRows.length };
}

// â”€â”€ Bellavita Chat Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// db_masmis.bb_chat's real columns (44 total): ticket_id, inbox_id, inbox_name,
// ticket_status, agent_name, email_1, phone_number, created_at, assigned_at, agent_frt_at,
// frt_1, resolution_time_at, resolution_time, average_wait_time, is_resolved,
// is_outside_working_hrs, level1_tags, level2_tags, level3_tags, system_tags, chat_link,
// repeat_status, repeat_status_on_assign, time_1406, resolution_time_min, frt_tat,
// resolution_tat, phone_number1, current_agent, email_2, chat_date, emp_id, lob, week,
// count_1, time_slot, hour, tl_name, disposition, day_shift_night_shift, unique_id, froud,
// frt_2, user_type.
export async function uploadBellavitaChat(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  const monthLabel = currentMonthLabel();
  const validRows: (string | number | null)[][] = [];
  for (const r of rows) {
    const ticketId = getField(r, "ticket_id", "Ticket ID");
    if (!ticketId) continue;
    validRows.push([
      ticketId, getField(r, "inbox_id") || null, getField(r, "inbox_name") || null,
      getField(r, "ticket_status") || null, getField(r, "agent_name") || null,
      getField(r, "email_1") || null, getField(r, "phone_number") || null,
      parseChatDatetime(r["created_at"]), parseChatDatetime(r["assigned_at"]),
      parseChatDatetime(r["agent_frt_at"]), getField(r, "frt_1") || null,
      parseChatDatetime(r["resolution_time_at"]), getField(r, "resolution_time") || null,
      getField(r, "average_wait_time") || null, getField(r, "is_resolved") || null,
      getField(r, "is_outside_working_hrs") || null, getField(r, "level1_tags") || null,
      getField(r, "level2_tags") || null, getField(r, "level3_tags") || null,
      getField(r, "system_tags") || null, getField(r, "chat_link") || null,
      getField(r, "repeat_status") || null, getField(r, "repeat_status_on_assign") || null,
      getField(r, "time_1406") || null, getField(r, "resolution_time_min") || null,
      getField(r, "frt_tat") || null, getField(r, "resolution_tat") || null,
      getField(r, "phone_number1") || null, getField(r, "current_agent") || null,
      getField(r, "email_2") || null, parseBellavitaDate(r["chat_date"]),
      getField(r, "emp_id") || null, getField(r, "lob") || null, getField(r, "week") || null,
      nullableNumber(getField(r, "count_1")), getField(r, "time_slot") || null,
      nullableInt(getField(r, "hour")), getField(r, "tl_name") || null,
      getField(r, "disposition") || null, getField(r, "day_shift_night_shift") || null,
      getField(r, "unique_id") || null, getField(r, "froud") || null,
      getField(r, "frt_2") || null, getField(r, "user_type") || null, batchId,
    ]);
  }
  await batchInsertRows(
    "bb_chat",
    `(ticket_id, inbox_id, inbox_name, ticket_status, agent_name, email_1, phone_number,
      created_at, assigned_at, agent_frt_at, frt_1, resolution_time_at, resolution_time,
      average_wait_time, is_resolved, is_outside_working_hrs, level1_tags, level2_tags,
      level3_tags, system_tags, chat_link, repeat_status, repeat_status_on_assign,
      time_1406, resolution_time_min, frt_tat, resolution_tat, phone_number1,
      current_agent, email_2, chat_date, emp_id, lob, week, count_1, time_slot, hour,
      tl_name, disposition, day_shift_night_shift, unique_id, froud, frt_2, user_type,
      upload_batch_id)`,
    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    validRows,
  );
  await logUpload("bb_chat", monthLabel, validRows.length, uploadedBy, batchId);
  return { rowsInserted: validRows.length };
}

// â”€â”€ Bellavita Cart Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// db_masmis.bb_cart's real columns: cc, source, sno, cart_id, created_at, updated_at,
// customer_name, customer_address, phone_number, email_id, line_items, variant_title,
// abandoned_cart_link, amount, phone_10_digit, dates, agent, disposition, sub_disposition,
// call_date, same_day_connect, status.
export async function uploadBellavitaCart(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  const monthLabel = currentMonthLabel();
  const validRows: (string | number | null)[][] = [];
  for (const r of rows) {
    const cartId = getField(r, "Cart ID", "cart_id");
    if (!cartId) continue;
    validRows.push([
      getField(r, "CC", "cc") || null, getField(r, "Source", "source") || null,
      nullableInt(getField(r, "SNo", "sno")), cartId,
      getField(r, "Created At", "created_at") || null, getField(r, "Updated At", "updated_at") || null,
      getField(r, "Customer Name", "customer_name") || null,
      getField(r, "Customer Address", "customer_address") || null,
      getField(r, "Phone Number", "phone_number") || null, getField(r, "Email ID", "email_id") || null,
      getField(r, "Line Items", "line_items") || null, getField(r, "Variant Title", "variant_title") || null,
      getField(r, "Abandoned Cart Link", "abandoned_cart_link") || null,
      nullableNumber(getField(r, "Amount", "amount")),
      getField(r, "Phone (10 Digit)", "phone_10_digit") || null, getField(r, "Dates", "dates") || null,
      getField(r, "Agent", "agent") || null, getField(r, "Disposition", "disposition") || null,
      getField(r, "Sub Disposition", "sub_disposition") || null, getField(r, "Call Date", "call_date") || null,
      getField(r, "Same Day Connect", "same_day_connect") || null, getField(r, "Status", "status") || null,
      batchId,
    ]);
  }
  await batchInsertRows(
    "bb_cart",
    `(cc, source, sno, cart_id, created_at, updated_at, customer_name, customer_address,
      phone_number, email_id, line_items, variant_title, abandoned_cart_link, amount,
      phone_10_digit, dates, agent, disposition, sub_disposition, call_date,
      same_day_connect, status, upload_batch_id)`,
    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    validRows,
  );
  await logUpload("bb_cart", monthLabel, validRows.length, uploadedBy, batchId);
  return { rowsInserted: validRows.length };
}

// â”€â”€ Bellavita Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// db_masmis.bb_sale's real columns bear no relation to what this file's INSERT (see
// uploadBellavitaSales) assumes â€” verified live 2026-08-13 against 23,391 real rows. The
// table is populated by some process other than this codebase (uploadBellavitaSales would
// itself throw ER_BAD_FIELD_ERROR on every one of its 25 INSERT columns; see the comment
// there). Real-to-assumed mapping used below, confirmed against actual distinct values:
//   order_status  -> current_status  ('DELIVERED' 18214, 'RTO' 413, 'RTD' 2583, ... of 23391)
//   payment_mode  -> payment_status  ('paid' 16071 / 'cod' 7320 â€” lowercase, not 'COD')
//   selling_price -> amount          (decimal(12,2); only one monetary column exists â€” no
//                                     separate gross/net/GST breakdown in the real table)
//   net_revenue   -> amount          (same column; "net ex-GST" and "selling price" collapse
//                                     to the one figure that actually exists)
//   order_date    -> `Order Date`    (literal column name with a space, backtick-quoted;
//                                     matches the exact key uploadBellavitaSales already reads
//                                     from an Excel row â€” r["Order Date"] â€” so this is very
//                                     likely the field the original design intended all along)
//   campaign      -> campaign        (unchanged â€” exists as-is)
export async function getBellavitaDashboard(month: string): Promise<{
  overall: Record<string, unknown>;
  by_campaign: Record<string, unknown>[];
}> {
  const [overall] = await queryMasmis<Record<string, unknown>>(
    `SELECT
       COUNT(*) AS total_orders,
       SUM(CASE WHEN current_status = 'RTO' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS rto_pct,
       SUM(CASE WHEN payment_status = 'cod' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS cod_pct,
       SUM(CASE WHEN payment_status != 'cod' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS paid_pct,
       AVG(amount) AS aov,
       SUM(amount) AS net_revenue_ex_gst
     FROM db_masmis.bb_sale
     WHERE DATE_FORMAT(\`Order Date\`, '%Y-%m') = ?`,
    [month]
  );
  const by_campaign = await queryMasmis<Record<string, unknown>>(
    `SELECT
       campaign,
       COUNT(*) AS orders,
       SUM(CASE WHEN current_status = 'RTO' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS rto_pct,
       SUM(CASE WHEN payment_status = 'cod' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS cod_pct,
       SUM(CASE WHEN payment_status != 'cod' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS paid_pct,
       AVG(amount) AS aov,
       SUM(amount) AS net_revenue
     FROM db_masmis.bb_sale
     WHERE DATE_FORMAT(\`Order Date\`, '%Y-%m') = ?
     GROUP BY campaign ORDER BY orders DESC`,
    [month]
  );
  return { overall: overall ?? {}, by_campaign };
}

// â”€â”€ GNC Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// db_masmis.gnc_sale and db_masmis.gnc_apr's real columns, verified live 2026-08-13 against
// 1,399 and real gnc_apr rows respectively:
//   gnc_sale.total_revenue -> gross_amount (decimal(12,2); sum_before_gst also exists but
//                              gross_amount is the closer match to "total")
//   gnc_sale.unit_price    -> gross_amount (no per-unit column exists; every row already
//                              represents one line, so AVG(gross_amount) is the real AOV)
//   gnc_sale.product       -> line_item_name
//   gnc_sale.qty           -> sale_count
//   gnc_sale.sale_date     -> sale_date (unchanged, exists as-is)
//   gnc_apr.call_date      -> report_date
//   gnc_apr.quality_score  -> DOES NOT EXIST, in any form, anywhere in gnc_apr's real schema
//                              (id, uid, report_date, user_name, emp_id, tl_name, calls,
//                              process_type, login/wait/talk/dispo/pause_time, acht, aoc, bio,
//                              bre, briefing, down_time, lunch, meet, qa, sb, tea_break,
//                              training_break, wash, net_login, break_time, tra_qa, downtime,
//                              atten, capping). valid_pct/invalid_pct had no real data source
//                              to begin with â€” not fabricated here; see the null with the
//                              comment on apr_summary below instead of inventing a number.
export async function getGncDashboard(month: string): Promise<{
  summary: Record<string, unknown>;
  by_product: Record<string, unknown>[];
  apr_summary: Record<string, unknown>;
}> {
  const [summary] = await queryMasmis<Record<string, unknown>>(
    `SELECT
       COUNT(*) AS total_sales,
       SUM(gross_amount) AS total_revenue,
       AVG(gross_amount) AS avg_order,
       0 AS conversion_pct
     FROM db_masmis.gnc_sale
     WHERE DATE_FORMAT(sale_date, '%Y-%m') = ?`,
    [month]
  );
  const by_product = await queryMasmis<Record<string, unknown>>(
    `SELECT line_item_name AS product, SUM(sale_count) AS units, SUM(gross_amount) AS revenue
     FROM db_masmis.gnc_sale
     WHERE DATE_FORMAT(sale_date, '%Y-%m') = ?
     GROUP BY line_item_name ORDER BY units DESC`,
    [month]
  );
  // total/calls is real; quality_score never existed (see comment above) â€” valid_pct and
  // invalid_pct are genuinely unavailable rather than guessed at.
  const aprRows = await queryMasmis<Record<string, unknown>>(
    `SELECT
       COUNT(*) AS total,
       NULL AS valid_pct,
       NULL AS invalid_pct
     FROM db_masmis.gnc_apr
     WHERE DATE_FORMAT(report_date, '%Y-%m') = ?`,
    [month]
  );
  return { summary: summary ?? {}, by_product, apr_summary: aprRows[0] ?? {} };
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function currentMonthLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// â”€â”€ Sales KPIs from dialer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getSalesKPIs(startDate: string, endDate: string): Promise<Record<string, unknown>> {
  const rows = await querySource<Record<string, unknown>>(
    `SELECT COUNT(*) AS total_records FROM dialer_db.data_master_in
     WHERE DATE(calldate) BETWEEN ? AND ?`,
    [startDate, endDate]
  );
  return rows[0] ?? {};
}

// â”€â”€ Neemans Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// db_masmis.neemans_month_targets's real columns are (id, month, target, created_by,
// updated_at) â€” verified live 2026-08-13 against the 2 real rows that exist (month
// '2026-06'/'2026-07', target 6774194.00/7000000.00). There is no month_label, no
// daily_target, no total_target: only one monthly figure is stored, not a daily/total
// split. daily_target is derived here (target / days in that month) rather than stored,
// since the real schema was never asking for two independent numbers â€” that removes the
// column mismatch without inventing a persistence model the data was never designed for.
export async function getNeemansTargets(month: string): Promise<Record<string, unknown>[]> {
  const rows = await queryMasmis<{ month_label: string; total_target: number }>(
    `SELECT month AS month_label, target AS total_target FROM db_masmis.neemans_month_targets
     WHERE month = ? OR ? = '' ORDER BY month DESC LIMIT 12`,
    [month, month]
  );
  return rows.map((r) => {
    const [y, m] = String(r.month_label).split('-').map(Number);
    const daysInMonth = y && m ? new Date(y, m, 0).getDate() : 30;
    return { ...r, daily_target: Number(r.total_target) / daysInMonth };
  });
}

// total_target maps onto the one real `target` column â€” the closer, unambiguous fit of the
// two figures the caller sends (a single monthly target, not a daily one that gets summed).
// dailyTarget is accepted for API-shape compatibility with the existing route/frontend
// contract but is not persisted separately; getNeemansTargets derives it back on read.
export async function setNeemansTarget(month: string, _dailyTarget: number, totalTarget: number): Promise<void> {
  await queryMasmis(
    `INSERT INTO db_masmis.neemans_month_targets (month, target)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE target = VALUES(target)`,
    [month, totalTarget]
  );
}

// db_masmis.nms_Agent_Details's real columns are (id, emp_id, daildesk_id, name, lob, tl,
// doj, fhd, status, dol, created_by, updated_by, created_at, updated_at, monthly_target) â€”
// verified live 2026-08-13 against 22 real rows (status values are literally 'Active' /
// 'Inactive', not a boolean flag). agent_id/agent_name/team/active never existed; there is
// no designation column at all â€” returned as NULL rather than fabricated, since nothing in
// the real schema tracks it.
export async function getNeemansAgentDetails(): Promise<Record<string, unknown>[]> {
  return queryMasmis(
    `SELECT id, emp_id AS agent_id, name AS agent_name, tl AS team, NULL AS designation, doj,
            (status = 'Active') AS active
       FROM db_masmis.nms_Agent_Details ORDER BY name`
  );
}

export async function addNeemansAgentDetail(data: Record<string, unknown>): Promise<void> {
  await queryMasmis(
    `INSERT INTO db_masmis.nms_Agent_Details (emp_id, name, tl, doj, status)
     VALUES (?, ?, ?, ?, 'Active')`,
    [String(data.agent_id ?? ""), String(data.agent_name ?? ""), String(data.team ?? ""), String(data.doj ?? "")]
  );
}

export async function updateNeemansAgentDetail(id: number, data: Record<string, unknown>): Promise<void> {
  await queryMasmis(
    `UPDATE db_masmis.nms_Agent_Details SET name=?, tl=?, status=? WHERE id=?`,
    [String(data.agent_name ?? ""), String(data.team ?? ""), data.active ? 'Active' : 'Inactive', id]
  );
}

export async function deleteNeemansAgentDetail(id: number): Promise<void> {
  await queryMasmis(`DELETE FROM db_masmis.nms_Agent_Details WHERE id = ?`, [id]);
}

// db_masmis.neemans_apr's real columns, verified live 2026-08-13: agent_id/agent_name/
// occupancy_pct/call_date/total_calls never existed â€” real names are emp_id/emp_name/
// occu_pct/date/calls. date is stored as text like "01-Jul-2026" (%d-%b-%Y), not a DATE
// column, hence STR_TO_DATE before DATE_FORMAT can bucket it by month. total_calls (the
// old SUM target) doesn't exist either; the original COUNT(*) for "total_calls" was
// actually counting agent-day rows, not real call volume â€” SUM(calls), the real column
// that literally is call volume, is what "total_calls" was always supposed to mean.
export async function getNeemansAprDashboard(month: string): Promise<Record<string, unknown>> {
  const [kpis] = await queryMasmis<Record<string, unknown>>(
    `SELECT
       SUM(calls) AS total_calls,
       COUNT(DISTINCT emp_id) AS agent_count,
       ROUND(AVG(occu_pct), 1) AS avg_occupancy_pct,
       ROUND(AVG(acht), 0) AS avg_acht,
       SUM(attendance) AS total_attendance
     FROM db_masmis.neemans_apr
     WHERE DATE_FORMAT(STR_TO_DATE(\`date\`, '%d-%b-%Y'), '%Y-%m') = ?`,
    [month]
  );
  const agents = await queryMasmis<Record<string, unknown>>(
    `SELECT emp_id AS agent_id, emp_name AS agent_name, SUM(calls) AS calls, ROUND(AVG(occu_pct),1) AS occupancy_pct, ROUND(AVG(acht),0) AS acht
     FROM db_masmis.neemans_apr
     WHERE DATE_FORMAT(STR_TO_DATE(\`date\`, '%d-%b-%Y'), '%Y-%m') = ?
     GROUP BY emp_id, emp_name ORDER BY calls DESC LIMIT 50`,
    [month]
  );
  return { kpis: kpis ?? {}, agents };
}

// db_masmis.neemans_cart's real columns, verified live 2026-08-13: id, sno, cart_id,
// created_at, updated_at, customer_name, phone_number, email_id, line_items, amount,
// agent, disposition, sub_disposition, call_date, status, uploaded_by, upload_batch_id,
// inserted_at â€” individual abandoned-cart records. section_label/metric_label/mtd_value/
// weekly_value/daily_value/month_label/section_order/metric_order (the KPI-snapshot shape
// this function assumed) do not exist anywhere in the real table, and the table is
// currently empty (0 rows) besides. There is no way to map a per-cart-record table onto a
// pre-aggregated KPI-snapshot shape without inventing numbers, so this is left flagged
// rather than fixed â€” same "don't fabricate" rule as the other real gaps in this file.
// ABC Cart Snap â€” built from neemans_allocation (workable/connected) + neemans_sale_raw
// (sales/revenue/payment). neemans_cart has 0 rows and is not used.
// Both tables share the Excel-serial date key. Weekly grouping uses the `week` column
// in neemans_sale_raw (W-1â€¦W-5); allocation is mapped to those weeks via a date-range join.
// Verified live 2026-09-14 against 3,612 allocation rows and 3,800 sale_raw rows.
export async function getNeemansAbcCartSnap(month: string): Promise<Record<string, unknown>> {
  // Aliased variants â€” use when the table is referenced by that alias in the same query.
  const ALLOC_MONTH = `CAST(a.date AS SIGNED) > 0 AND DATE_FORMAT(DATE_ADD('1900-01-01', INTERVAL (CAST(a.date AS SIGNED)-2) DAY),'%Y-%m') = ?`;
  const SALE_MONTH  = `CAST(s.date AS SIGNED) > 0 AND DATE_FORMAT(DATE_ADD('1900-01-01', INTERVAL (CAST(s.date AS SIGNED)-2) DAY),'%Y-%m') = ?`;
  // No-alias variant â€” for subqueries / CTEs where the table has no alias assigned.
  const DATE_MONTH  = `CAST(date AS SIGNED) > 0 AND DATE_FORMAT(DATE_ADD('1900-01-01', INTERVAL (CAST(date AS SIGNED)-2) DAY),'%Y-%m') = ?`;

  // â”€â”€ MTD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [allocMtd] = await queryMasmis<Record<string, unknown>>(
    `SELECT
       COUNT(DISTINCT a.phone)                                                   AS workable,
       SUM(a.calling_status='Connected')                                         AS connected,
       COUNT(DISTINCT a.agent)                                                   AS login_count,
       ROUND(SUM(a.calling_status='Connected')*100.0/NULLIF(COUNT(DISTINCT a.phone),0),1) AS connected_pct
     FROM db_masmis.neemans_allocation a
     WHERE ${ALLOC_MONTH}`, [month]);

  const [saleMtd] = await queryMasmis<Record<string, unknown>>(
    `SELECT
       SUM(s.status='Sale Made')                                                 AS sale_count,
       ROUND(SUM(CASE WHEN s.status='Sale Made' THEN s.amount ELSE 0 END),2)    AS revenue,
       SUM(s.status='Sale Made' AND s.payment_status='cod')                      AS cod_count,
       SUM(s.status='Sale Made' AND s.payment_status='paid')                     AS prepaid_count,
       ROUND(SUM(s.status='Sale Made' AND s.payment_status='paid')*100.0/
             NULLIF(SUM(s.status='Sale Made'),0),1)                              AS prepaid_pct
     FROM db_masmis.neemans_sale_raw s
     WHERE ${SALE_MONTH}`, [month]);

  function merge(a: Record<string, unknown>, s: Record<string, unknown>) {
    const workable   = Number(a.workable   ?? 0);
    const connected  = Number(a.connected  ?? 0);
    const saleCount  = Number(s.sale_count ?? 0);
    return {
      ...a, ...s,
      connected_pct:    workable  > 0 ? +(connected / workable * 100).toFixed(1)   : 0,
      conversion_pct:   connected > 0 ? +(saleCount / connected * 100).toFixed(1)  : 0,
      call_per_agent:   Number(a.login_count ?? 0) > 0
                          ? +(workable / Number(a.login_count)).toFixed(1) : 0,
    };
  }

  const mtd = merge(allocMtd ?? {}, saleMtd ?? {});

  // â”€â”€ Weekly (W-1 â€¦ W-5) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const allocWeekly = await queryMasmis<Record<string, unknown>>(
    `SELECT
       wk.week,
       COUNT(DISTINCT a.phone)                                                   AS workable,
       SUM(a.calling_status='Connected')                                         AS connected,
       COUNT(DISTINCT a.agent)                                                   AS login_count
     FROM (SELECT DISTINCT date, week FROM db_masmis.neemans_sale_raw
           WHERE ${DATE_MONTH}) wk
     LEFT JOIN db_masmis.neemans_allocation a ON a.date = wk.date
     GROUP BY wk.week ORDER BY wk.week`, [month]);

  const saleWeekly = await queryMasmis<Record<string, unknown>>(
    `SELECT week,
       SUM(s.status='Sale Made')                                                 AS sale_count,
       ROUND(SUM(CASE WHEN s.status='Sale Made' THEN s.amount ELSE 0 END),2)    AS revenue,
       SUM(s.status='Sale Made' AND s.payment_status='cod')                      AS cod_count,
       SUM(s.status='Sale Made' AND s.payment_status='paid')                     AS prepaid_count
     FROM db_masmis.neemans_sale_raw s
     WHERE ${SALE_MONTH}
     GROUP BY week ORDER BY week`, [month]);

  const saleWeekMap = new Map(saleWeekly.map((r) => [r.week, r]));
  const weekly = allocWeekly.map((a) => merge(a, saleWeekMap.get(a.week as string) ?? {}));

  // â”€â”€ Daily (per date, sorted chronologically) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const allocDaily = await queryMasmis<Record<string, unknown>>(
    `SELECT
       a.date AS date_key,
       DATE_FORMAT(DATE_ADD('1900-01-01', INTERVAL (CAST(a.date AS SIGNED)-2) DAY),'%d-%b') AS label,
       COUNT(DISTINCT a.phone)          AS workable,
       SUM(a.calling_status='Connected') AS connected,
       COUNT(DISTINCT a.agent)           AS login_count
     FROM db_masmis.neemans_allocation a
     WHERE ${ALLOC_MONTH}
     GROUP BY a.date ORDER BY CAST(a.date AS SIGNED)`, [month]);

  const saleDaily = await queryMasmis<Record<string, unknown>>(
    `SELECT
       s.date AS date_key,
       SUM(s.status='Sale Made')                                                 AS sale_count,
       ROUND(SUM(CASE WHEN s.status='Sale Made' THEN s.amount ELSE 0 END),2)    AS revenue,
       SUM(s.status='Sale Made' AND s.payment_status='cod')                      AS cod_count,
       SUM(s.status='Sale Made' AND s.payment_status='paid')                     AS prepaid_count
     FROM db_masmis.neemans_sale_raw s
     WHERE ${SALE_MONTH}
     GROUP BY s.date ORDER BY CAST(s.date AS SIGNED)`, [month]);

  const saleDayMap = new Map(saleDaily.map((r) => [r.date_key, r]));
  const daily = allocDaily.map((a) => merge(a, saleDayMap.get(a.date_key as string) ?? {}));

  // â”€â”€ Connected Disposition breakdown (MTD) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const dispRows = await queryMasmis<{ calling_status: string; cnt: number; pct: number }>(
    `SELECT calling_status,
       COUNT(*) AS cnt,
       ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(),1) AS pct
     FROM db_masmis.neemans_allocation a
     WHERE ${ALLOC_MONTH} AND calling_status IS NOT NULL AND calling_status NOT IN ('','')
     GROUP BY calling_status ORDER BY cnt DESC`, [month]);

  return { mtd, weekly, daily, disposition: dispRows };
}

// Weekly agent stack-ranking by revenue (W-1â€¦W-5 for the given month).
// Per-agent per-week: total_leads, sales, revenue â†’ achievement_pct vs
// equal-share of monthly target â†’ TQ (>90%) / MQ (>75%) / BQ (â‰¤75%).
// Verified live 2026-09-14 â€” neemans_sale_raw has 3,800 rows with W-1â€¦W-5.
export async function getNeemansWeeklyRanking(month: string): Promise<Record<string, unknown>> {
  const MONTH_FILTER = `CAST(s.date AS SIGNED) > 0 AND DATE_FORMAT(DATE_ADD('1900-01-01', INTERVAL (CAST(s.date AS SIGNED)-2) DAY),'%Y-%m') = ?`;

  const rows = await queryMasmis<Record<string, unknown>>(
    `SELECT
       s.name AS agent_name, s.emp_id,
       s.week,
       COUNT(*) AS total_leads,
       SUM(s.status='Sale Made') AS sales,
       ROUND(SUM(CASE WHEN s.status='Sale Made' THEN s.amount ELSE 0 END),2) AS revenue
     FROM db_masmis.neemans_sale_raw s
     WHERE ${MONTH_FILTER}
     GROUP BY s.name, s.emp_id, s.week
     ORDER BY s.name, s.week`, [month]);

  const [targetRow] = await queryMasmis<{ target: number }>(
    `SELECT target FROM db_masmis.neemans_month_targets WHERE month = ? LIMIT 1`, [month]);

  const monthlyTarget = targetRow ? Number(targetRow.target) : null;

  // Pivot: agent â†’ { name, empId, weeks: { 'W-1': { revenue, target, achievementPct, rank }, â€¦ } }
  const agents = new Map<string, { agent_name: string; emp_id: string; weeks: Record<string, unknown> }>();
  const weeks = new Set<string>();

  for (const r of rows) {
    const key = String(r.emp_id ?? r.agent_name);
    if (!agents.has(key)) agents.set(key, { agent_name: String(r.agent_name), emp_id: String(r.emp_id ?? ""), weeks: {} });
    weeks.add(String(r.week));
    const weekTarget = monthlyTarget != null ? monthlyTarget / 5 : null; // equal weekly share
    const rev = Number(r.revenue ?? 0);
    const achievePct = weekTarget && weekTarget > 0 ? +(rev / weekTarget * 100).toFixed(1) : null;
    const rank = achievePct == null ? "â€”" : achievePct > 90 ? "TQ" : achievePct > 75 ? "MQ" : "BQ";
    agents.get(key)!.weeks[String(r.week)] = { revenue: rev, target: weekTarget, achievementPct: achievePct, rank };
  }

  return { weeks: [...weeks].sort(), rows: [...agents.values()], monthlyTarget };
}

// db_masmis.neemans_sale_raw's real columns, verified live 2026-08-13: order_status,
// revenue, payment_mode, sale_date never existed. Real: status (only 'Sale Made'/'PTP' â€”
// 'Sale Made' is the real-world equivalent of the old 'Confirmed'), amount (revenue),
// payment_status (lowercase: 'paid'/'cod'/'pending'/'partially_paid'/'voided'/'refunded'/
// 'partially_refunded' â€” 'paid'/'cod' are the old 'Paid'/'COD'), name (agent_name), and
// date, which is an Excel serial number stored as text (e.g. "46174"), not a DATE column â€”
// NEEMANS_DATE_SQL below decodes it in-query (Excel's day-1900 epoch, off-by-one included).
// uploadNeemansSaleRaw keeps this same raw-serial-as-text convention on write, for
// consistency with existing rows. There is no real 'RTO' status value and no
// telephony-connection column (no 'Not Connected'/'IVR' concept exists in this table at
// all â€” every row here is already a logged sales disposition, not a raw call log), so
// rto_pct and connected_pct are left NULL rather than invented.
const NEEMANS_DATE_SQL = "DATE_ADD('1900-01-01', INTERVAL (CAST(`date` AS SIGNED) - 2) DAY)";

export async function getNeemansDashboard(month: string): Promise<Record<string, unknown>> {
  // 9 KPI cards
  const [kpis] = await queryMasmis<Record<string, unknown>>(
    `SELECT
       COUNT(*) AS workable_data,
       NULL AS connected_pct,
       ROUND(SUM(CASE WHEN status = 'Sale Made' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS conversion_pct,
       SUM(CASE WHEN status = 'Sale Made' THEN 1 ELSE 0 END) AS total_orders,
       SUM(CASE WHEN status = 'Sale Made' THEN amount ELSE 0 END) AS revenue,
       ROUND(SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN status='Sale Made' THEN 1 ELSE 0 END),0),1) AS paid_pct,
       ROUND(SUM(CASE WHEN payment_status = 'cod' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN status='Sale Made' THEN 1 ELSE 0 END),0),1) AS cod_pct,
       NULL AS rto_pct
     FROM db_masmis.neemans_sale_raw
     WHERE DATE_FORMAT(${NEEMANS_DATE_SQL}, '%Y-%m') = ?`,
    [month]
  );

  // Target for prorated achievement. neemans_month_targets carries a single `target`
  // figure per month (real columns: id, month, target, created_by, updated_at) â€” no
  // daily/total split exists, so daily_target is derived here, matching the fix already
  // applied to getNeemansTargets()/setNeemansTarget() above.
  const [targetRow] = await queryMasmis<{ month: string; target: number }>(
    `SELECT month, target FROM db_masmis.neemans_month_targets WHERE month = ? LIMIT 1`,
    [month]
  );

  // Days elapsed in the month so far
  const [year, mon] = month.split("-").map(Number);
  const today = new Date();
  const daysElapsed = today.getFullYear() === year && today.getMonth() + 1 === mon
    ? today.getDate()
    : new Date(year, mon, 0).getDate();

  const daysInMonth = new Date(year, mon, 0).getDate();
  const totalTarget = targetRow ? Number(targetRow.target) : null;
  const dailyTarget = totalTarget !== null ? totalTarget / daysInMonth : null;
  const proratedTarget = dailyTarget !== null ? dailyTarget * daysElapsed : null;
  const revenue = Number((kpis as Record<string, unknown>)?.revenue ?? 0);
  const achievementPct = proratedTarget && proratedTarget > 0
    ? Math.round((revenue / proratedTarget) * 100)
    : null;

  // Daily trend
  const daily = await queryMasmis<Record<string, unknown>>(
    `SELECT DATE_FORMAT(${NEEMANS_DATE_SQL},'%Y-%m-%d') AS date,
       SUM(CASE WHEN status='Sale Made' THEN 1 ELSE 0 END) AS orders,
       SUM(CASE WHEN status='Sale Made' THEN amount ELSE 0 END) AS revenue,
       ROUND(SUM(CASE WHEN status='Sale Made' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS conversion_pct
     FROM db_masmis.neemans_sale_raw
     WHERE DATE_FORMAT(${NEEMANS_DATE_SQL},'%Y-%m') = ?
     GROUP BY \`date\` ORDER BY ${NEEMANS_DATE_SQL} ASC`,
    [month]
  );

  // Agent performance
  const agents = await queryMasmis<Record<string, unknown>>(
    `SELECT name AS agent_name,
       COUNT(*) AS total_leads,
       SUM(CASE WHEN status='Sale Made' THEN 1 ELSE 0 END) AS sales,
       SUM(CASE WHEN status='Sale Made' THEN amount ELSE 0 END) AS revenue,
       ROUND(SUM(CASE WHEN status='Sale Made' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS conversion_pct,
       ROUND(SUM(CASE WHEN payment_status='cod' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN status='Sale Made' THEN 1 ELSE 0 END),0),1) AS cod_pct,
       ROUND(SUM(CASE WHEN payment_status='paid' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN status='Sale Made' THEN 1 ELSE 0 END),0),1) AS paid_pct
     FROM db_masmis.neemans_sale_raw
     WHERE DATE_FORMAT(${NEEMANS_DATE_SQL},'%Y-%m') = ?
     GROUP BY name ORDER BY revenue DESC LIMIT 30`,
    [month]
  );

  return {
    kpis: { ...kpis, achievement_pct: achievementPct, prorated_target: proratedTarget, days_elapsed: daysElapsed },
    target: targetRow ? { month_label: targetRow.month, daily_target: dailyTarget, total_target: totalTarget } : null,
    daily_trend: daily,
    agents,
  };
}

// â”€â”€ Neemans Upload Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// db_masmis.neemans_sale_raw's real columns: week, date, emp_id, name, tl, lob, tenure,
// order_id, customer_number, email_id, payment_status, amount, discount_code,
// line_item_name, calling_lob, calling_status, status, count, neemans_order_id,
// current_status, final_status, line_item_qty, target, call_date_time, duration,
// created_at_raw. "date" is stored as the RAW, UNCONVERTED Excel serial number as text
// (e.g. "46215") in real live data -- that repo's own dashboard casts it back to a date at
// query time, so a different convention here would silently misalign with existing rows.
// Split into insertNeemansSaleRawRows(rows) + uploadNeemansSaleRaw(buffer) so Process
// Performance V2's bulk-upload importer shares this exact row-insert logic instead of
// duplicating it as a second writer to db_masmis.neemans_sale_raw.
export async function insertNeemansSaleRawRows(
  rows: Record<string, unknown>[], uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const orderId = getField(r, "orderId", "order_id");
    if (!orderId) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.neemans_sale_raw
         (week, date, emp_id, name, tl, lob, tenure, order_id, customer_number, email_id,
          payment_status, amount, discount_code, line_item_name, calling_lob, calling_status,
          status, count, neemans_order_id, current_status, final_status, line_item_qty,
          target, call_date_time, duration, created_at_raw, upload_batch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        getField(r, "week") || null, getField(r, "date") || null, getField(r, "empId", "emp_id") || null,
        getField(r, "name") || null, getField(r, "tl") || null, getField(r, "lob") || null,
        getField(r, "tenure") || null, orderId, getField(r, "customerNumber", "customer_number") || null,
        getField(r, "emailId", "email_id") || null, getField(r, "paymentStatus", "payment_status") || null,
        nullableNumber(getField(r, "amount")), getField(r, "discountCode", "discount_code") || null,
        getField(r, "lineItemName", "line_item_name") || null, getField(r, "callingLob", "calling_lob") || null,
        getField(r, "callingStatus", "calling_status") || null, getField(r, "status") || null,
        nullableInt(getField(r, "count")), getField(r, "neemansOrderId", "neemans_order_id") || null,
        getField(r, "currentStatus", "current_status") || null, getField(r, "finalStatus", "final_status") || null,
        nullableInt(getField(r, "lineItemQty", "line_item_qty")), nullableInt(getField(r, "target")),
        getField(r, "callDateTime", "call_date_time") || null, getField(r, "duration") || null,
        getField(r, "createdAt", "created_at_raw") || null, batchId,
      ]
    );
    count++;
  }
  const monthLabel = currentMonthLabel();
  await logUpload("neemans_sale_raw", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

export async function uploadNeemansSaleRaw(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  return insertNeemansSaleRawRows(rows, uploadedBy);
}

// db_masmis.neemans_allocation's real columns: phone, email, customer_name, product_title,
// amount, type, date, agent, calling_status, sub_scenario1, sub_scenario2, call_id.
export async function insertNeemansAllocationRows(
  rows: Record<string, unknown>[], uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const batchId = uuidv4();
  let count = 0;
  const monthLabel = currentMonthLabel();
  for (const r of rows) {
    const phone = getField(r, "phone", "phone_number", "mobile");
    if (!phone) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.neemans_allocation
         (phone, email, customer_name, product_title, amount, type, date, agent,
          calling_status, sub_scenario1, sub_scenario2, call_id, upload_batch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        phone, getField(r, "email") || null, getField(r, "customerName", "customer_name") || null,
        getField(r, "productTitle", "product_title") || null, nullableNumber(getField(r, "amount")),
        getField(r, "type") || null, getField(r, "date") || null, getField(r, "agent") || null,
        getField(r, "callingStatus", "calling_status") || null,
        getField(r, "subScenario1", "sub_scenario1") || null,
        getField(r, "subScenario2", "sub_scenario2") || null,
        getField(r, "callId", "call_id") || null, batchId,
      ]
    );
    count++;
  }
  await logUpload("neemans_allocation", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

export async function uploadNeemansAllocation(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  return insertNeemansAllocationRows(rows, uploadedBy);
}

// db_masmis.neemans_apr's real columns: unique_id, week, date, emp_name, emp_id, calls,
// uca_ob, lob, login_time, parks, park_time, avg_park, parks_per_call, wait, talk, dispo,
// pause, login_ts, logout_ts, acht, team_briefing, lunch, tea, tea1, washr, total_break,
// net_login, occu_pct, week_short, mtd, attendance, capping. "date" is text like
// "01-Jul-2026" in real live data, not a DATE column.
export async function insertNeemansAprRows(
  rows: Record<string, unknown>[], uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const empName = getField(r, "empName", "emp_name");
    if (!empName) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.neemans_apr
         (unique_id, week, date, emp_name, emp_id, calls, uca_ob, lob, login_time, parks,
          park_time, avg_park, parks_per_call, wait, talk, dispo, pause, login_ts, logout_ts,
          acht, team_briefing, lunch, tea, tea1, washr, total_break, net_login, occu_pct,
          week_short, mtd, attendance, capping, upload_batch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        getField(r, "uniqueId", "unique_id") || null, getField(r, "week") || null,
        getField(r, "date") || null, empName, getField(r, "empId", "emp_id") || null,
        nullableInt(getField(r, "calls")), nullableInt(getField(r, "ucaOb", "uca_ob")),
        getField(r, "lob") || null, getField(r, "loginTime", "login_time") || null,
        nullableInt(getField(r, "parks")), getField(r, "parkTime", "park_time") || null,
        getField(r, "avgPark", "avg_park") || null,
        nullableNumber(getField(r, "parksPerCall", "parks_per_call")),
        getField(r, "wait") || null, getField(r, "talk") || null, getField(r, "dispo") || null,
        getField(r, "pause") || null, getField(r, "loginTs", "login_ts") || null,
        getField(r, "logoutTs", "logout_ts") || null, nullableInt(getField(r, "acht")),
        getField(r, "teamBriefing", "team_briefing") || null, getField(r, "lunch") || null,
        getField(r, "tea") || null, getField(r, "tea1") || null, getField(r, "washr") || null,
        getField(r, "totalBreak", "total_break") || null, getField(r, "netLogin", "net_login") || null,
        nullableNumber(getField(r, "occuPct", "occu_pct")), getField(r, "weekShort", "week_short") || null,
        getField(r, "mtd") || null, nullableInt(getField(r, "attendance")),
        getField(r, "capping") || null, batchId,
      ]
    );
    count++;
  }
  const monthLabel = currentMonthLabel();
  await logUpload("neemans_apr", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

export async function uploadNeemansApr(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  return insertNeemansAprRows(rows, uploadedBy);
}

// â”€â”€ AW (Aarohan Wealth) Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Primary table: db_masmis.aw_out â€” outbound daily agent performance.
// Real columns verified live 2026-09-14 (34 agents, Sep-26):
//   agent_name, emp_id, lob, total_calls, connected_calls, not_connected_calls,
//   lrs_amount, trade_amount, mf_amount, net_login_hrs, acht, occupancy_on_calls, month.
// All columns are stored as varchar(100) â€” numeric coercion required on read.
// Secondary table: db_masmis.aw_billing â€” billing/activity data by billing_type.
// Mandate table: db_masmis.aw_mandate (billing_type, mandate, per_fe_rate, month).
// month format in aw_out/aw_billing: "Sep-26" (MMM-YY) â€” not a DATE column.
export async function getAwDashboard(month: string): Promise<Record<string, unknown>> {
  // Normalise caller's YYYY-MM â†’ "Sep-26" to match aw_out.month varchar format
  // The month param is always "YYYY-MM" from the API; convert here.
  const [y, m] = month.split("-").map(Number);
  const MON_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const awMonth = `${MON_LABELS[m - 1]}-${String(y).slice(2)}`;

  // KPIs â€” aggregate across all agents
  const [kpis] = await queryMasmis<Record<string, unknown>>(
    `SELECT
       SUM(CAST(NULLIF(total_calls,'') AS DECIMAL))         AS total_calls,
       SUM(CAST(NULLIF(connected_calls,'') AS DECIMAL))     AS connected_calls,
       SUM(CAST(NULLIF(not_connected_calls,'') AS DECIMAL)) AS not_connected,
       COUNT(DISTINCT agent_name)                            AS active_agents,
       SUM(CAST(NULLIF(net_login_hrs,'') AS DECIMAL))       AS total_login_hrs,
       SUM(CAST(NULLIF(lrs_amount,'') AS DECIMAL))          AS lrs_amount,
       SUM(CAST(NULLIF(trade_amount,'') AS DECIMAL))        AS trade_amount,
       SUM(CAST(NULLIF(mf_amount,'') AS DECIMAL))           AS mf_amount
     FROM db_masmis.aw_out
     WHERE month = ?`, [awMonth]);

  const totalCalls     = Number(kpis?.total_calls     ?? 0);
  const connectedCalls = Number(kpis?.connected_calls ?? 0);
  const connectedPct   = totalCalls > 0 ? +(connectedCalls / totalCalls * 100).toFixed(1) : 0;
  const totalRevenue   = Number(kpis?.lrs_amount ?? 0) + Number(kpis?.trade_amount ?? 0) + Number(kpis?.mf_amount ?? 0);

  // Per-agent breakdown
  const agents = await queryMasmis<Record<string, unknown>>(
    `SELECT
       agent_name, emp_id, lob,
       SUM(CAST(NULLIF(total_calls,'') AS DECIMAL))         AS total_calls,
       SUM(CAST(NULLIF(connected_calls,'') AS DECIMAL))     AS connected_calls,
       ROUND(SUM(CAST(NULLIF(connected_calls,'') AS DECIMAL))*100.0/
             NULLIF(SUM(CAST(NULLIF(total_calls,'') AS DECIMAL)),0),1) AS connected_pct,
       SUM(CAST(NULLIF(net_login_hrs,'') AS DECIMAL))       AS net_login_hrs,
       ROUND(AVG(CAST(NULLIF(acht,'') AS DECIMAL)),0)       AS acht,
       ROUND(AVG(CAST(NULLIF(occupancy_on_calls,'') AS DECIMAL))*100,1) AS occupancy_pct,
       SUM(CAST(NULLIF(lrs_amount,'') AS DECIMAL))          AS lrs_amount,
       SUM(CAST(NULLIF(trade_amount,'') AS DECIMAL))        AS trade_amount,
       SUM(CAST(NULLIF(mf_amount,'') AS DECIMAL))           AS mf_amount
     FROM db_masmis.aw_out
     WHERE month = ?
     GROUP BY agent_name, emp_id, lob
     ORDER BY (SUM(CAST(NULLIF(lrs_amount,'') AS DECIMAL)) +
               SUM(CAST(NULLIF(trade_amount,'') AS DECIMAL)) +
               SUM(CAST(NULLIF(mf_amount,'') AS DECIMAL))) DESC`, [awMonth]);

  // Mandate snapshot for the month
  const mandateRows = await queryMasmis<Record<string, unknown>>(
    `SELECT billing_type, mandate, per_fe_rate, login_hours_per_fte
     FROM db_masmis.aw_mandate
     WHERE DATE_FORMAT(DATE_ADD('1900-01-01', INTERVAL (CAST(month AS SIGNED)-2) DAY),'%Y-%m') = ?
       OR month = ?
     LIMIT 10`, [month, awMonth]);

  // Distinct months available (for the month picker)
  const months = await queryMasmis<{ month: string }>(
    `SELECT DISTINCT month FROM db_masmis.aw_out ORDER BY month DESC LIMIT 24`);

  return {
    kpis: { ...kpis, connected_pct: connectedPct, total_revenue: totalRevenue },
    agents,
    mandate: mandateRows,
    months: months.map(r => r.month),
  };
}

// â”€â”€ AW Upload Functions (write to db_masmis.aw_* tables) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// aw_out: outbound daily agent report â€” 65 varchar columns, key = call_date + agent_id
//
// Split into insertAwOutRows(rows) + uploadAwOut(buffer) so Process Performance V2's bulk-upload
// importer (aw-out-bulk.service.ts) can share this exact row-insert logic instead of duplicating
// it against the same db_masmis.aw_out table -- two independent writers to one table risks
// duplicate rows and column-mapping drift between them, so there is now exactly one.
export async function insertAwOutRows(rows: Record<string, unknown>[], uploadedBy: string): Promise<{ rowsInserted: number }> {
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const callDate = getField(r, "callDate", "call_date", "Call Date");
    const agentId  = getField(r, "agentId",  "agent_id",  "Agent ID");
    if (!callDate && !agentId) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.aw_out
         (call_date, agent_id, agent_name, total_calls, connected_calls, not_connected_calls,
          total_talk_time, total_wrapup_time, total_pause_time, total_idle_time, pickup_time,
          total_login_time, first_login_time, last_logout_time, emp_id, lob, sub_lob,
          week, month, net_login_hrs, acht, occupancy_on_calls,
          lrs_count, lrs_amount, trade_count, trade_amount, mf_count, mf_amount,
          upload_batch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        callDate || null, agentId || null,
        getField(r, "agentName", "agent_name", "Agent Name") || null,
        getField(r, "totalCalls", "total_calls") || null,
        getField(r, "connectedCalls", "connected_calls") || null,
        getField(r, "notConnectedCalls", "not_connected_calls") || null,
        getField(r, "totalTalkTime", "total_talk_time") || null,
        getField(r, "totalWrapupTime", "total_wrapup_time") || null,
        getField(r, "totalPauseTime", "total_pause_time") || null,
        getField(r, "totalIdleTime", "total_idle_time") || null,
        getField(r, "pickupTime", "pickup_time") || null,
        getField(r, "totalLoginTime", "total_login_time") || null,
        getField(r, "firstLoginTime", "first_login_time") || null,
        getField(r, "lastLogoutTime", "last_logout_time") || null,
        getField(r, "empId", "emp_id", "EMP ID") || null,
        getField(r, "lob", "LOB") || null,
        getField(r, "subLob", "sub_lob") || null,
        getField(r, "week", "Week") || null,
        getField(r, "month", "Month") || null,
        getField(r, "netLoginHrs", "net_login_hrs") || null,
        getField(r, "acht", "ACHT") || null,
        getField(r, "occupancyOnCalls", "occupancy_on_calls") || null,
        getField(r, "lrsCount", "lrs_count") || null,
        getField(r, "lrsAmount", "lrs_amount") || null,
        getField(r, "tradeCount", "trade_count") || null,
        getField(r, "tradeAmount", "trade_amount") || null,
        getField(r, "mfCount", "mf_count") || null,
        getField(r, "mfAmount", "mf_amount") || null,
        batchId,
      ]
    );
    count++;
  }
  await logUpload("aw_out", currentMonthLabel(), count, uploadedBy, batchId);
  return { rowsInserted: count };
}

export async function uploadAwOut(buffer: Buffer, uploadedBy: string): Promise<{ rowsInserted: number }> {
  const XLSX = (await import("xlsx")).default;
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  return insertAwOutRows(rows, uploadedBy);
}

// aw_billing: daily billing/activity report per agent â€” similar shape to aw_out
export async function insertAwBillingRows(rows: Record<string, unknown>[], uploadedBy: string): Promise<{ rowsInserted: number }> {
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const agentId = getField(r, "agentId", "agent_id", "Agent ID");
    if (!agentId) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.aw_billing
         (call_date, agent_id, agent_name, total_calls, connected_calls, not_connected_calls,
          total_talk_time, total_wrapup_time, total_pause_time, total_idle_time,
          total_login_time, net_login_hrs, acht, occupancy_pct,
          lob, lob2, billing_type, week, month, upload_batch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        getField(r, "callDate", "call_date") || null, agentId || null,
        getField(r, "agentName", "agent_name") || null,
        getField(r, "totalCalls", "total_calls") || null,
        getField(r, "connectedCalls", "connected_calls") || null,
        getField(r, "notConnectedCalls", "not_connected_calls") || null,
        getField(r, "totalTalkTime", "total_talk_time") || null,
        getField(r, "totalWrapupTime", "total_wrapup_time") || null,
        getField(r, "totalPauseTime", "total_pause_time") || null,
        getField(r, "totalIdleTime", "total_idle_time") || null,
        getField(r, "totalLoginTime", "total_login_time") || null,
        getField(r, "netLoginHrs", "net_login_hrs") || null,
        getField(r, "acht", "ACHT") || null,
        getField(r, "occupancyPct", "occupancy_pct") || null,
        getField(r, "lob", "LOB") || null,
        getField(r, "lob2") || null,
        getField(r, "billingType", "billing_type") || null,
        getField(r, "week") || null,
        getField(r, "month", "Month") || null,
        batchId,
      ]
    );
    count++;
  }
  await logUpload("aw_billing", currentMonthLabel(), count, uploadedBy, batchId);
  return { rowsInserted: count };
}

export async function uploadAwBilling(buffer: Buffer, uploadedBy: string): Promise<{ rowsInserted: number }> {
  const XLSX = (await import("xlsx")).default;
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  return insertAwBillingRows(rows, uploadedBy);
}

// aw_mandate: billing type mandate headcount per month
export async function insertAwMandateRows(rows: Record<string, unknown>[], uploadedBy: string): Promise<{ rowsInserted: number }> {
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const billingType = getField(r, "billingType", "billing_type", "Billing Type");
    if (!billingType) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.aw_mandate (billing_type, mandate, per_fe_rate, login_hours_per_fte, month, upload_batch_id)
       VALUES (?,?,?,?,?,?)`,
      [
        billingType,
        getField(r, "mandate", "Mandate") || null,
        getField(r, "perFeRate", "per_fe_rate") || null,
        getField(r, "loginHoursPerFte", "login_hours_per_fte") || null,
        getField(r, "month", "Month") || null,
        batchId,
      ]
    );
    count++;
  }
  await logUpload("aw_mandate", currentMonthLabel(), count, uploadedBy, batchId);
  return { rowsInserted: count };
}

export async function uploadAwMandate(buffer: Buffer, uploadedBy: string): Promise<{ rowsInserted: number }> {
  const XLSX = (await import("xlsx")).default;
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  return insertAwMandateRows(rows, uploadedBy);
}

// aw_inbound: inbound CDR (call_id, agent, disposition, call_date, talk_time, etc.)
export async function insertAwInboundRows(rows: Record<string, unknown>[], uploadedBy: string): Promise<{ rowsInserted: number }> {
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const callId = getField(r, "callId", "call_id", "Call ID");
    if (!callId) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.aw_inbound
         (call_id, call_type, campaign, location, caller_no, skill, call_date,
          start_time, end_time, talk_time, hold_time, duration, agent, agent_id,
          disposition, wrapup_duration, handling_time, status, upload_batch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        callId,
        getField(r, "callType", "call_type") || null,
        getField(r, "campaign") || null,
        getField(r, "location") || null,
        getField(r, "callerNo", "caller_no") || null,
        getField(r, "skill") || null,
        getField(r, "callDate", "call_date") || null,
        getField(r, "startTime", "start_time") || null,
        getField(r, "endTime", "end_time") || null,
        getField(r, "talkTime", "talk_time") || null,
        getField(r, "holdTime", "hold_time") || null,
        getField(r, "duration") || null,
        getField(r, "agent") || null,
        getField(r, "agentId", "agent_id") || null,
        getField(r, "disposition") || null,
        getField(r, "wrapupDuration", "wrapup_duration") || null,
        getField(r, "handlingTime", "handling_time") || null,
        getField(r, "status") || null,
        batchId,
      ]
    );
    count++;
  }
  await logUpload("aw_inbound", currentMonthLabel(), count, uploadedBy, batchId);
  return { rowsInserted: count };
}

export async function uploadAwInbound(buffer: Buffer, uploadedBy: string): Promise<{ rowsInserted: number }> {
  const XLSX = (await import("xlsx")).default;
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  return insertAwInboundRows(rows, uploadedBy);
}

// aw_new_cdr: outbound CDR (call_id, campaign, agent, disposition, etc.)
export async function insertAwNewCdrRows(rows: Record<string, unknown>[], uploadedBy: string): Promise<{ rowsInserted: number }> {
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const callId = getField(r, "callId", "call_id", "Call ID");
    if (!callId) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.aw_new_cdr
         (call_id, call_type, campaign, location, caller_no, skill, call_date,
          start_time, end_time, talk_time, hold_time, duration, agent, agent_id,
          disposition, wrapup_duration, handling_time, status, sub_lob, partner, slot, upload_batch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        callId,
        getField(r, "callType", "call_type") || null,
        getField(r, "campaign") || null,
        getField(r, "location") || null,
        getField(r, "callerNo", "caller_no") || null,
        getField(r, "skill") || null,
        getField(r, "callDate", "call_date") || null,
        getField(r, "startTime", "start_time") || null,
        getField(r, "endTime", "end_time") || null,
        getField(r, "talkTime", "talk_time") || null,
        getField(r, "holdTime", "hold_time") || null,
        getField(r, "duration") || null,
        getField(r, "agent") || null,
        getField(r, "agentId", "agent_id") || null,
        getField(r, "disposition") || null,
        getField(r, "wrapupDuration", "wrapup_duration") || null,
        getField(r, "handlingTime", "handling_time") || null,
        getField(r, "status") || null,
        getField(r, "subLob", "sub_lob") || null,
        getField(r, "partner") || null,
        getField(r, "slot") || null,
        batchId,
      ]
    );
    count++;
  }
  await logUpload("aw_new_cdr", currentMonthLabel(), count, uploadedBy, batchId);
  return { rowsInserted: count };
}

export async function uploadAwNewCdr(buffer: Buffer, uploadedBy: string): Promise<{ rowsInserted: number }> {
  const XLSX = (await import("xlsx")).default;
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  return insertAwNewCdrRows(rows, uploadedBy);
}

// â”€â”€ BVO / Bellavita Repeat Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Source: db_masmis.bvo_order_export â€” Shopify order export for Bellavita Repeat.
// Real columns verified live 2026-09-15: shipping_phone, financial_status, total,
// lineitem_name, created_at_raw (format DD-MM-YYYY), tags (contains Prepaid/COD tags).
// financial_status values: 'paid' | 'COD' | 'PrePaid' | 'voided' | 'refunded' | 'partially_paid'
// 3,050,861 rows covering 2024-05 through 2025-06.
// Fast month filter: avoids STR_TO_DATE+REGEXP full-table scan on 3M rows.
// created_at_raw format is 'DD-MM-YYYY' (10 chars). Direct string extraction:
//   MID(created_at_raw,4,2) â†’ month digits (e.g. '06')
//   RIGHT(created_at_raw,4) â†’ year (e.g. '2025')
// Verified safe: all real rows follow DD-MM-YYYY with CHAR_LENGTH=10.
// 3M-row scan still required (no index on created_at_raw) but avoids per-row
// STR_TO_DATE call â€” tested at ~20s locally on LAN with 3M rows.
const BVO_DATE_SQL = "STR_TO_DATE(created_at_raw, '%d-%m-%Y')";
const BVO_MONTH_FILTER = `CHAR_LENGTH(created_at_raw)=10 AND MID(created_at_raw,4,2)=? AND RIGHT(created_at_raw,4)=?`;

export async function getBvoDashboard(month: string): Promise<Record<string, unknown>> {
  // Split YYYY-MM â†’ month digits ('MM') and year ('YYYY') for the fast string filter
  const [yyyy, mm] = month.split("-");

  const [kpis] = await queryMasmis<Record<string, unknown>>(
    `SELECT
       COUNT(*) AS total_orders,
       ROUND(SUM(total),0) AS total_revenue,
       ROUND(AVG(total),2) AS aov,
       SUM(financial_status='paid') AS paid_count,
       SUM(financial_status='COD') AS cod_count,
       SUM(financial_status='PrePaid') AS prepaid_count,
       SUM(financial_status IN ('voided','refunded','partially_paid')) AS returned_count,
       ROUND(SUM(financial_status='paid')*100.0/NULLIF(COUNT(*),0),1) AS paid_pct,
       ROUND(SUM(financial_status='COD')*100.0/NULLIF(COUNT(*),0),1) AS cod_pct,
       ROUND(SUM(financial_status='PrePaid')*100.0/NULLIF(COUNT(*),0),1) AS prepaid_pct,
       ROUND(SUM(financial_status IN ('voided','refunded','partially_paid'))*100.0/NULLIF(COUNT(*),0),1) AS return_pct,
       ROUND(SUM(CASE WHEN financial_status='paid' THEN total ELSE 0 END),0) AS paid_revenue,
       ROUND(SUM(CASE WHEN financial_status='COD' THEN total ELSE 0 END),0) AS cod_revenue
     FROM db_masmis.bvo_order_export
     WHERE ${BVO_MONTH_FILTER}`, [mm, yyyy]);

  // Daily revenue trend â€” sort by day digit (DD from created_at_raw)
  const daily = await queryMasmis<Record<string, unknown>>(
    `SELECT CONCAT(?, '-', ?, '-', LEFT(created_at_raw,2)) AS date,
       COUNT(*) AS orders, ROUND(SUM(total),0) AS revenue,
       SUM(financial_status='paid') AS paid_count, SUM(financial_status='COD') AS cod_count
     FROM db_masmis.bvo_order_export
     WHERE ${BVO_MONTH_FILTER}
     GROUP BY LEFT(created_at_raw,2)
     ORDER BY CAST(LEFT(created_at_raw,2) AS UNSIGNED)`, [yyyy, mm, mm, yyyy]);

  // Top 10 products by order count
  const products = await queryMasmis<Record<string, unknown>>(
    `SELECT lineitem_name AS product, COUNT(*) AS orders, ROUND(SUM(total),0) AS revenue
     FROM db_masmis.bvo_order_export
     WHERE ${BVO_MONTH_FILTER} AND lineitem_name IS NOT NULL AND lineitem_name != ''
     GROUP BY lineitem_name ORDER BY orders DESC LIMIT 10`, [mm, yyyy]);

  // Payment mode breakdown
  const paymentMix = await queryMasmis<Record<string, unknown>>(
    `SELECT financial_status AS status, COUNT(*) AS cnt, ROUND(SUM(total),0) AS revenue
     FROM db_masmis.bvo_order_export
     WHERE ${BVO_MONTH_FILTER}
     GROUP BY financial_status ORDER BY cnt DESC`, [mm, yyyy]);

  // Available months for the picker â€” use fast string extraction (no REGEXP/STR_TO_DATE).
  // CONCAT(RIGHT,MID) reconstructs 'YYYY-MM' for display without per-row function calls.
  const months = await queryMasmis<{ month_key: string }>(
    `SELECT CONCAT(RIGHT(created_at_raw,4),'-',MID(created_at_raw,4,2)) AS month_key
     FROM db_masmis.bvo_order_export
     WHERE CHAR_LENGTH(created_at_raw)=10
     GROUP BY RIGHT(created_at_raw,4), MID(created_at_raw,4,2)
     ORDER BY RIGHT(created_at_raw,4) DESC, MID(created_at_raw,4,2) DESC
     LIMIT 24`);

  return { kpis: kpis ?? {}, daily, products, paymentMix, months: months.map(r => r.month_key) };
}

// â”€â”€ LP (Lawyers Panel) Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LP = Lawyers Panel (owner, 2026-09-15) â€” not LuckPay, the unrelated e-sign
// provider. Worked by the Eresolution team (NOIDA).
//
// Source tables: db_masmis.CR_lp_regional (896 rows), CR_lp_non_regional (955 rows),
// CR_lp_feedback (2,210 rows). All verified live 2026-09-15. Coverage: Aug 2026.
// Agent field: CR_lp_regional â†’ agent_name; CR_lp_feedback â†’ AgentName.
// Date field: allocated_on (DATETIME) in regional/non-regional; AllocatedOn in feedback.
export async function getLpDashboard(): Promise<Record<string, unknown>> {
  // Aggregate by campaign type
  const summary = await queryMasmis<Record<string, unknown>>(
    `SELECT 'Regional' AS campaign, COUNT(*) AS leads,
       COUNT(DISTINCT agent_name) AS agents,
       COUNT(DISTINCT disposition) AS dispositions,
       MIN(allocated_on) AS earliest, MAX(allocated_on) AS latest
     FROM db_masmis.CR_lp_regional
     UNION ALL
     SELECT 'Non-Regional', COUNT(*), COUNT(DISTINCT agent_name), COUNT(DISTINCT disposition),
       MIN(allocated_on), MAX(allocated_on)
     FROM db_masmis.CR_lp_non_regional
     UNION ALL
     SELECT 'Feedback', COUNT(*), COUNT(DISTINCT AgentName), COUNT(DISTINCT Disposition),
       MIN(AllocatedOn), MAX(AllocatedOn)
     FROM db_masmis.CR_lp_feedback`);

  // Agent breakdown (regional + non-regional combined)
  const agents = await queryMasmis<Record<string, unknown>>(
    `SELECT agent_name, 'Regional' AS campaign, COUNT(*) AS leads,
       COUNT(DISTINCT disposition) AS dispositions
     FROM db_masmis.CR_lp_regional
     WHERE agent_name IS NOT NULL AND agent_name != ''
     GROUP BY agent_name
     UNION ALL
     SELECT agent_name, 'Non-Regional', COUNT(*), COUNT(DISTINCT disposition)
     FROM db_masmis.CR_lp_non_regional
     WHERE agent_name IS NOT NULL AND agent_name != ''
     GROUP BY agent_name
     ORDER BY leads DESC LIMIT 30`);

  // Disposition breakdown (regional)
  const dispositions = await queryMasmis<Record<string, unknown>>(
    `SELECT disposition, 'Regional' AS campaign, COUNT(*) AS cnt
     FROM db_masmis.CR_lp_regional
     WHERE disposition IS NOT NULL AND disposition != ''
     GROUP BY disposition
     UNION ALL
     SELECT disposition, 'Non-Regional', COUNT(*)
     FROM db_masmis.CR_lp_non_regional
     WHERE disposition IS NOT NULL AND disposition != ''
     GROUP BY disposition
     ORDER BY cnt DESC LIMIT 20`);

  // Monthly trend (based on allocated_on)
  const trend = await queryMasmis<Record<string, unknown>>(
    `SELECT DATE_FORMAT(allocated_on,'%Y-%m') AS month_key,
       'Regional' AS campaign, COUNT(*) AS leads
     FROM db_masmis.CR_lp_regional
     WHERE allocated_on IS NOT NULL
     GROUP BY DATE_FORMAT(allocated_on,'%Y-%m')
     UNION ALL
     SELECT DATE_FORMAT(allocated_on,'%Y-%m'), 'Non-Regional', COUNT(*)
     FROM db_masmis.CR_lp_non_regional
     WHERE allocated_on IS NOT NULL
     GROUP BY DATE_FORMAT(allocated_on,'%Y-%m')
     ORDER BY month_key DESC`);

  return { summary, agents, dispositions, trend };
}
