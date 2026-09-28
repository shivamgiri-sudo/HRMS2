import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { withDeadlockRetry } from "../../shared/deadlockRetry.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";
import { mapWithConcurrency, BULK_ROW_CONCURRENCY } from "./batch-job.js";

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
 * order_id is now enforced UNIQUE (sql/1778_gnc_sale_order_id_unique.sql),
 * per explicit user request -- the live table had 543 exact re-upload
 * duplicate rows (same order, same amount, same line item, re-inserted
 * under a different upload_batch_id) before that migration's dedup step
 * ran. This importer now upserts by order_id: a row whose order_id already
 * exists gets UPDATEd in place (refreshing uploaded_at/upload_batch_id)
 * instead of re-inserted -- see findExistingOrderIds() below.
 *
 * CAVEAT: "My Dashboards" (the other tool sharing this table, see above)
 * is insert-only and outside this repo's control. If IT ever re-inserts an
 * order_id this uniqueness constraint already holds, that insert will now
 * fail with a duplicate-key error where it previously silently duplicated
 * the row -- a real behavior change for that tool, not just this one.
 */

export const GNC_SALE_HEADERS = [
  "Week", "Date", "EMP ID", "Emp_Name", "TL", "T1", "T3", "CustomerNumber",
  "E-mail ID", "Payment Status", "Gross Amount", "Sum Before GST", "OrderID",
  "Campaign", "Discount Code", "Count", "Status", "Lineitem name", "Sale Lob",
  "Target", "Sale Source",
] as const;

/** Lowercase, strip everything but letters/digits -- same convention as every other importer
 * in this module. Needed because the uploader sends the file's literal header text as keys, and
 * an exact-string lookup silently fails on any casing/spacing variant of a real header even
 * when the column is right there in the sheet (confirmed live for bb_apr/bb_sale). */
function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function get(data: Record<string, unknown>, ...keys: string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const k of keys) {
    const v = normalized[normalizeKey(k)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
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
  // Day is 1-2 digits: the sibling Bellavita export uses "1-Sep-26" (no leading
  // zero) for the 1st-9th of a month, and the same bug (exactly 2 digits
  // required) meant every such row failed there -- fixed proactively here too.
  const m = /^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})$/i.exec(v);
  if (m) {
    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const monthKey = m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase();
    const year = parseInt(m[3], 10) < 50 ? `20${m[3]}` : `19${m[3]}`;
    return `${year}-${months[monthKey]}-${m[1].padStart(2, "0")} 00:00:00`;
  }
  // "M/D/YY" (e.g. "9/1/26") -- a real sample GNC Sale row's actual Date column
  // format, confirmed from a real upload attempt (batch 1794d5dc, every row
  // failing the required-field check because this branch did not exist at all).
  // US month-first convention, matching every other numeric-slash date already
  // seen in this codebase's exports.
  const md = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(v);
  if (md) {
    const year = parseInt(md[3], 10) < 50 ? `20${md[3]}` : `19${md[3]}`;
    return `${year}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")} 00:00:00`;
  }
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  orderId: string;
  week: string;
  saleDate: string;
  empId: string;
  empName: string;
  tl: string;
  t1: string | null;
  t3: string;
  customerNumber: string;
  emailId: string;
  paymentStatus: string;
  grossAmount: number | null;
  sumBeforeGst: number | null;
  campaign: string;
  discountCode: string;
  saleCount: number | null;
  status: string;
  lineItemName: string;
  saleLob: string;
  target: number | null;
  saleSource: string;
}

function toInsertValues(r: ParsedRow, batchId: string): unknown[] {
  return [
    r.week, r.saleDate, r.empId, r.empName, r.tl, r.t1, r.t3, r.customerNumber, r.emailId,
    r.paymentStatus, r.grossAmount, r.sumBeforeGst, r.orderId, r.campaign, r.discountCode,
    r.saleCount, r.status, r.lineItemName, r.saleLob, r.target, r.saleSource,
    null, // uploaded_by: My Dashboards' numeric user id space -- HRMS user ids are UUIDs
          // and don't fit this int column; the real HRMS uploader is tracked on our own
          // upload_batch row instead, never fabricated as a fake numeric id here.
    batchId,
  ];
}

interface ExistingOrderRow extends RowDataPacket {
  order_id: string;
  id: number;
}

/** order_id is enforced UNIQUE on db_masmis.gnc_sale (sql/1778) -- looks up
 * which of this batch's order_ids already exist so re-uploading the same
 * file/overlapping date range updates the existing row instead of trying
 * to insert a second one. IN() is chunked (500/query) since a batch can
 * have thousands of rows. */
async function findExistingOrderIds(orderIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = Array.from(new Set(orderIds));
  const chunkSize = 500;
  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    const chunk = unique.slice(offset, offset + chunkSize);
    const [rows] = await db.execute<ExistingOrderRow[]>(
      `SELECT order_id, id FROM db_masmis.gnc_sale WHERE order_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const row of rows) map.set(row.order_id, row.id);
  }
  return map;
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
  const parsedRows: ParsedRow[] = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const orderId = get(data, "OrderID", "GNC Order ID", "gnc order id", "gnc_order_id");
    const saleDate = parseGncDate(get(data, "Date", "date"));
    if (!orderId || !saleDate) {
      const msg = `Row ${row.row_no}: "OrderID" and "Date" are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    parsedRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      orderId,
      week: get(data, "Week", "week"),
      saleDate,
      empId: get(data, "EMP ID", "emp_id", "emp id"),
      empName: get(data, "Emp_Name", "emp_name", "emp name"),
      tl: get(data, "TL", "tl"),
      t1: parseGncDate(get(data, "T1", "t1")), // t1 is a real DATE column, not free text
      t3: get(data, "T3", "t3"),
      customerNumber: blankDash(get(data, "CustomerNumber", "customer number", "customer_number")),
      emailId: blankDash(get(data, "E-mail ID", "email id", "email_id")),
      paymentStatus: get(data, "Payment Status", "payment_status"),
      grossAmount: parseNullableFloat(get(data, "Gross Amount", "gross_amount")),
      sumBeforeGst: parseNullableFloat(get(data, "Sum Before GST", "sum_before_gst")),
      campaign: get(data, "Campaign", "campaign"),
      discountCode: blankDash(get(data, "Discount Code", "discount_code")),
      saleCount: parseNullableInt(get(data, "Count", "count")),
      status: get(data, "Status", "status"),
      lineItemName: blankDash(get(data, "Lineitem name", "line_item_name", "line item name")),
      saleLob: get(data, "Sale Lob", "sale_lob"),
      target: parseNullableInt(get(data, "Target", "target")),
      saleSource: get(data, "Sale Source", "sale_source"),
    });
  }

  const existingByOrderId = await findExistingOrderIds(parsedRows.map((r) => r.orderId));
  const toInsert = parsedRows.filter((r) => !existingByOrderId.has(r.orderId));
  const toUpdate = parsedRows.filter((r) => existingByOrderId.has(r.orderId));

  const insertRows: ChunkInsertRow[] = toInsert.map((r) => ({
    rowId: r.rowId,
    rowNo: r.rowNo,
    values: toInsertValues(r, batchId),
  }));

  // Concurrent UPDATEs — independent per row, bounded by pool size.
  const updateOutcomes = await mapWithConcurrency(toUpdate, BULK_ROW_CONCURRENCY, async (r) => {
    const existingId = existingByOrderId.get(r.orderId)!;
    try {
      await withDeadlockRetry(() =>
        db.execute(
          `UPDATE db_masmis.gnc_sale SET
             week = ?, sale_date = ?, emp_id = ?, emp_name = ?, tl = ?, t1 = ?, t3 = ?,
             customer_number = ?, email_id = ?, payment_status = ?, gross_amount = ?, sum_before_gst = ?,
             campaign = ?, discount_code = ?, sale_count = ?, status = ?, line_item_name = ?, sale_lob = ?,
             target = ?, sale_source = ?, uploaded_at = NOW(), upload_batch_id = ?
           WHERE id = ?`,
          [
            r.week, r.saleDate, r.empId, r.empName, r.tl, r.t1, r.t3, r.customerNumber, r.emailId,
            r.paymentStatus, r.grossAmount, r.sumBeforeGst, r.campaign, r.discountCode, r.saleCount,
            r.status, r.lineItemName, r.saleLob, r.target, r.saleSource, batchId, existingId,
          ],
        ),
      );
      return { ok: true as const };
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, msg: `Row ${r.rowNo}: ${rawMsg}`, rowId: r.rowId };
    }
  });
  let updatedRows = 0;
  for (const o of updateOutcomes) {
    if (o.ok) { updatedRows++; }
    else { errors.push(o.msg); errorUpdates.push({ rowId: o.rowId, message: o.msg.slice(0, 500) }); }
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.gnc_sale
       (week, sale_date, emp_id, emp_name, tl, t1, t3, customer_number, email_id,
        payment_status, gross_amount, sum_before_gst, order_id, campaign, discount_code,
        sale_count, status, line_item_name, sale_lob, target, sale_source,
        uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  // importedRows counts both freshly inserted rows and rows that matched an
  // existing order_id and were refreshed in place -- both are a successfully
  // persisted row from the uploader's point of view.
  const importedRows = inserted.importedRows + updatedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (inserted.importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'gnc_sale', ?, ?, NULL)`,
      [batchId, `HRMS2 upload by ${importedByUserId}`, inserted.importedRows],
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
