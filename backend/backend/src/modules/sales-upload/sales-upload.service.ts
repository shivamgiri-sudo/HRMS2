import { randomUUID } from "crypto";
import * as XLSX from "xlsx";
import { getMasmisPool, queryMasmis } from "../../db/masmisDb.js";
import { querySource } from "../../db/sourceDb.js";

// ── Date helpers ─────────────────────────────────────────────────────────────
function parseBellavitaDate(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  // Excel serial number (e.g. 45123)
  if (typeof val === "number" && val > 40000 && val < 60000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  const s = String(val).trim();
  // DD-Mon-YY  e.g. "15-Jan-24"
  const m = s.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{2,4})$/);
  if (m) {
    const months: Record<string, string> = {
      jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
      jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    };
    const dd = m[1].padStart(2, "0");
    const mm = months[m[2].toLowerCase()] ?? "01";
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${mm}-${dd} 00:00:00`;
  }
  // Try native parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace("T", " ");
  return null;
}

function parseChatDatetime(val: unknown): string | null {
  if (!val) return null;
  const s = String(val).trim();
  // DD-MM-YYYY HH:MM
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]} ${m[4]}:00`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace("T", " ");
  return null;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  return String(v).trim() || null;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ── Batch helpers ─────────────────────────────────────────────────────────────
export function generateBatchId(): string {
  return randomUUID();
}

export async function logUpload(
  batchId: string, tableName: string, fileName: string, rowCount: number, uploadedBy: string
) {
  await getMasmisPool().execute(
    `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
     VALUES (?, ?, ?, ?, ?)`,
    [batchId, tableName, fileName, rowCount, uploadedBy]
  );
}

export async function getUploadLogs(tableName?: string) {
  if (tableName) {
    return queryMasmis(
      `SELECT * FROM db_masmis.upload_log WHERE table_name=? ORDER BY uploaded_at DESC LIMIT 50`,
      [tableName]
    );
  }
  return queryMasmis(
    `SELECT * FROM db_masmis.upload_log ORDER BY uploaded_at DESC LIMIT 50`
  );
}

export async function deleteUploadBatch(batchId: string, tableName: string) {
  const validTables = ["bb_sale","bb_apr","bb_chat","bb_cart","gnc_sale","gnc_apr","gnc_allocation"];
  if (!validTables.includes(tableName)) throw new Error(`Invalid table: ${tableName}`);
  const pool = getMasmisPool();
  await pool.execute(`DELETE FROM db_masmis.${tableName} WHERE upload_batch_id=?`, [batchId]);
  await pool.execute(`DELETE FROM db_masmis.upload_log WHERE batch_id=? AND table_name=?`, [batchId, tableName]);
}

// ── Bellavita Sales Upload ─────────────────────────────────────────────────
export async function uploadBellavitaSales(buffer: Buffer, fileName: string, uploadedBy: string) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) return { inserted: 0, batchId: "" };

  const batchId = generateBatchId();
  const pool    = getMasmisPool();
  let inserted  = 0;

  for (const r of rows) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO db_masmis.bb_sale
         (upload_batch_id, week, sale_date, emp_id, emp_name, tl, t1, t2, fhd, days, phone_number, email_id,
          payment_status, amount, order_id, campaign, calling_status, discount_code, count_val, current_status,
          final_status, order_datetime, state, line_item_name, pincode, order_date, hrs_24_48, crazy_deal,
          perfume, size, order_pickup_datetime, rto_initiated_datetime, diff_hour, lob, pincode_relevent,
          rto_status, draft_order, time_1608, sale_source_name, shift)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          batchId,
          str(r["Week"] ?? r["week"]),
          parseBellavitaDate(r["Sale Date"] ?? r["saleDate"] ?? r["SaleDate"]),
          str(r["Emp Id"] ?? r["empId"] ?? r["EmpId"]),
          str(r["Emp Name"] ?? r["empName"] ?? r["EmpName"]),
          str(r["TL"]),
          str(r["T1"]),
          str(r["T2"]),
          str(r["FHD"]),
          num(r["Days"]),
          str(r["Phone Number"] ?? r["phoneNumber"]),
          str(r["Email Id"] ?? r["emailId"]),
          str(r["Payment Status"] ?? r["paymentStatus"]),
          num(r["Amount"] ?? r["amount"]),
          str(r["Order Id"] ?? r["orderId"]),
          str(r["Campaign"] ?? r["campaign"]),
          str(r["Calling Status"] ?? r["callingStatus"]),
          str(r["Discount Code"] ?? r["discountCode"]),
          num(r["Count"] ?? r["count"]),
          str(r["Current Status"] ?? r["currentStatus"]),
          str(r["Final Status"] ?? r["finalStatus"]),
          parseBellavitaDate(r["Order Datetime"] ?? r["orderDatetime"]),
          str(r["State"] ?? r["state"]),
          str(r["Line Item Name"] ?? r["lineItemName"]),
          str(r["Pincode"] ?? r["pincode"]),
          parseBellavitaDate(r["Order Date"] ?? r["orderDate"]),
          str(r["24-48 Hrs"] ?? r["hrs24_48"]),
          str(r["Crazy Deal"] ?? r["crazyDeal"]),
          str(r["Perfume"]),
          str(r["Size"]),
          parseBellavitaDate(r["Order Pickup Datetime"] ?? r["orderPickupDatetime"]),
          parseBellavitaDate(r["RTO Initiated Datetime"] ?? r["rtoInitiatedDatetime"]),
          num(r["Diff Hour"] ?? r["diffHour"]),
          str(r["LOB"] ?? r["lob"]),
          str(r["Pincode Relevent"] ?? r["pincodeRelevent"]),
          str(r["RTO Status"] ?? r["rtoStatus"]),
          str(r["Draft Order"] ?? r["draftOrder"]),
          str(r["1608"] ?? r["time1608"]),
          str(r["Sale Source Name"] ?? r["saleSourceName"]),
          str(r["Shift"] ?? r["shift"]),
        ]
      );
      inserted++;
    } catch {
      // skip bad rows
    }
  }

  await logUpload(batchId, "bb_sale", fileName, inserted, uploadedBy);
  return { inserted, batchId };
}

// ── GNC Sales Upload ──────────────────────────────────────────────────────
export async function uploadGncSales(buffer: Buffer, fileName: string, uploadedBy: string) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) return { inserted: 0, batchId: "" };

  const batchId = generateBatchId();
  const pool    = getMasmisPool();
  let inserted  = 0;

  for (const r of rows) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO db_masmis.gnc_sale
         (upload_batch_id, sale_date, order_id, gnc_order_id, emp_id, emp_name, tl, campaign,
          calling_status, payment_status, amount, state, lob, product_name, discount_code,
          order_datetime, final_status, pincode, shift, week)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          batchId,
          parseBellavitaDate(r["Sale Date"] ?? r["saleDate"]),
          str(r["Order Id"] ?? r["orderId"]),
          str(r["GNC Order Id"] ?? r["gncOrderId"]),
          str(r["Emp Id"] ?? r["empId"]),
          str(r["Emp Name"] ?? r["empName"]),
          str(r["TL"]),
          str(r["Campaign"] ?? r["campaign"]),
          str(r["Calling Status"] ?? r["callingStatus"]),
          str(r["Payment Status"] ?? r["paymentStatus"]),
          num(r["Amount"] ?? r["amount"]),
          str(r["State"] ?? r["state"]),
          str(r["LOB"] ?? r["lob"]),
          str(r["Product Name"] ?? r["productName"]),
          str(r["Discount Code"] ?? r["discountCode"]),
          parseBellavitaDate(r["Order Datetime"] ?? r["orderDatetime"]),
          str(r["Final Status"] ?? r["finalStatus"]),
          str(r["Pincode"] ?? r["pincode"]),
          str(r["Shift"] ?? r["shift"]),
          str(r["Week"] ?? r["week"]),
        ]
      );
      inserted++;
    } catch {
      // skip bad rows
    }
  }

  await logUpload(batchId, "gnc_sale", fileName, inserted, uploadedBy);
  return { inserted, batchId };
}

// ── GNC APR Upload ─────────────────────────────────────────────────────────
export async function uploadGncApr(buffer: Buffer, fileName: string, uploadedBy: string) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) return { inserted: 0, batchId: "" };

  const batchId = generateBatchId();
  const pool    = getMasmisPool();
  let inserted  = 0;

  for (const r of rows) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO db_masmis.gnc_apr
         (upload_batch_id, report_date, emp_id, emp_name, tl, login_time, logout_time, acht,
          atten, break_time, calls_handled, lob, campaign, shift)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          batchId,
          parseBellavitaDate(r["Report Date"] ?? r["reportDate"]),
          str(r["Emp Id"] ?? r["empId"]),
          str(r["Emp Name"] ?? r["empName"]),
          str(r["TL"]),
          str(r["Login Time"] ?? r["loginTime"]),
          str(r["Logout Time"] ?? r["logoutTime"]),
          num(r["ACHT"] ?? r["acht"]),
          str(r["Atten"] ?? r["atten"]),
          str(r["Break Time"] ?? r["breakTime"]),
          num(r["Calls Handled"] ?? r["callsHandled"]),
          str(r["LOB"] ?? r["lob"]),
          str(r["Campaign"] ?? r["campaign"]),
          str(r["Shift"] ?? r["shift"]),
        ]
      );
      inserted++;
    } catch {
      // skip
    }
  }

  await logUpload(batchId, "gnc_apr", fileName, inserted, uploadedBy);
  return { inserted, batchId };
}

// ── GNC Allocation Upload ──────────────────────────────────────────────────
export async function uploadGncAllocation(buffer: Buffer, fileName: string, uploadedBy: string) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) return { inserted: 0, batchId: "" };

  const batchId = generateBatchId();
  const pool    = getMasmisPool();
  let inserted  = 0;

  for (const r of rows) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO db_masmis.gnc_allocation
         (upload_batch_id, alloc_date, emp_id, emp_name, tl, phone_number, calling_status,
          sub_scenarios1, sub_scenarios2, campaign, lob, state, pincode, shift)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          batchId,
          parseBellavitaDate(r["Alloc Date"] ?? r["allocDate"]),
          str(r["Emp Id"] ?? r["empId"]),
          str(r["Emp Name"] ?? r["empName"]),
          str(r["TL"]),
          str(r["Phone Number"] ?? r["phoneNumber"]),
          str(r["Calling Status"] ?? r["callingStatus"]),
          str(r["Sub Scenarios 1"] ?? r["subScenarios1"]),
          str(r["Sub Scenarios 2"] ?? r["subScenarios2"]),
          str(r["Campaign"] ?? r["campaign"]),
          str(r["LOB"] ?? r["lob"]),
          str(r["State"] ?? r["state"]),
          str(r["Pincode"] ?? r["pincode"]),
          str(r["Shift"] ?? r["shift"]),
        ]
      );
      inserted++;
    } catch {
      // skip
    }
  }

  await logUpload(batchId, "gnc_allocation", fileName, inserted, uploadedBy);
  return { inserted, batchId };
}

// ── Bellavita APR Upload ───────────────────────────────────────────────────
export async function uploadBellavitaApr(buffer: Buffer, fileName: string, uploadedBy: string) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) return { inserted: 0, batchId: "" };

  const batchId = generateBatchId();
  const pool    = getMasmisPool();
  let inserted  = 0;

  for (const r of rows) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO db_masmis.bb_apr
         (upload_batch_id, report_date, emp_id, emp_name, tl, fhd_s, login_time, logout_time,
          acht, atten, break_time, calls_handled, lob, campaign, tenurity_week, sub_lob, shift)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          batchId,
          parseBellavitaDate(r["Report Date"] ?? r["reportDate"]),
          str(r["Emp Id"] ?? r["empId"]),
          str(r["Emp Name"] ?? r["empName"]),
          str(r["TL"]),
          str(r["FHD"] ?? r["fhdS"]),
          str(r["Login Time"] ?? r["loginTime"]),
          str(r["Logout Time"] ?? r["logoutTime"]),
          num(r["ACHT"] ?? r["acht"]),
          str(r["Atten"] ?? r["atten"]),
          str(r["Break Time"] ?? r["breakTime"]),
          num(r["Calls Handled"] ?? r["callsHandled"]),
          str(r["LOB"] ?? r["lob"]),
          str(r["Campaign"] ?? r["campaign"]),
          str(r["Tenurity Week"] ?? r["tenurityWeek"]),
          str(r["Sub LOB"] ?? r["subLob"]),
          str(r["Shift"] ?? r["shift"]),
        ]
      );
      inserted++;
    } catch {
      // skip
    }
  }

  await logUpload(batchId, "bb_apr", fileName, inserted, uploadedBy);
  return { inserted, batchId };
}

// ── Bellavita Chat Upload ──────────────────────────────────────────────────
export async function uploadBellavitaChat(buffer: Buffer, fileName: string, uploadedBy: string) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) return { inserted: 0, batchId: "" };

  const batchId = generateBatchId();
  const pool    = getMasmisPool();
  let inserted  = 0;

  for (const r of rows) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO db_masmis.bb_chat
         (upload_batch_id, ticket_id, created_at, emp_id, emp_name, tl, campaign, lob,
          frt_1, resolution_tat, csat, status, category, sub_category, shift)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          batchId,
          str(r["Ticket Id"] ?? r["ticketId"]),
          parseChatDatetime(r["Created At"] ?? r["createdAt"]),
          str(r["Emp Id"] ?? r["empId"]),
          str(r["Emp Name"] ?? r["empName"]),
          str(r["TL"]),
          str(r["Campaign"] ?? r["campaign"]),
          str(r["LOB"] ?? r["lob"]),
          num(r["FRT 1"] ?? r["frt1"]),
          num(r["Resolution TAT"] ?? r["resolutionTat"]),
          num(r["CSAT"] ?? r["csat"]),
          str(r["Status"] ?? r["status"]),
          str(r["Category"] ?? r["category"]),
          str(r["Sub Category"] ?? r["subCategory"]),
          str(r["Shift"] ?? r["shift"]),
        ]
      );
      inserted++;
    } catch {
      // skip
    }
  }

  await logUpload(batchId, "bb_chat", fileName, inserted, uploadedBy);
  return { inserted, batchId };
}

// ── Bellavita Cart Upload ──────────────────────────────────────────────────
export async function uploadBellavitaCart(buffer: Buffer, fileName: string, uploadedBy: string) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) return { inserted: 0, batchId: "" };

  const batchId = generateBatchId();
  const pool    = getMasmisPool();
  let inserted  = 0;

  for (const r of rows) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO db_masmis.bb_cart
         (upload_batch_id, cart_id, abandoned_cart_link, emp_id, emp_name, tl,
          campaign, lob, same_day_connect, status, amount, shift)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          batchId,
          str(r["Cart Id"] ?? r["cartId"]),
          str(r["Abandoned Cart Link"] ?? r["abandonedCartLink"]),
          str(r["Emp Id"] ?? r["empId"]),
          str(r["Emp Name"] ?? r["empName"]),
          str(r["TL"]),
          str(r["Campaign"] ?? r["campaign"]),
          str(r["LOB"] ?? r["lob"]),
          str(r["Same Day Connect"] ?? r["sameDayConnect"]),
          str(r["Status"] ?? r["status"]),
          num(r["Amount"] ?? r["amount"]),
          str(r["Shift"] ?? r["shift"]),
        ]
      );
      inserted++;
    } catch {
      // skip
    }
  }

  await logUpload(batchId, "bb_cart", fileName, inserted, uploadedBy);
  return { inserted, batchId };
}

// ── Bellavita Dashboard ────────────────────────────────────────────────────
export async function getBellavitaDashboard(month: string) {
  // month = YYYY-MM
  const [year, m] = month.split("-");
  const start = `${year}-${m}-01`;
  const end   = `${year}-${m}-31`;

  const rows = await queryMasmis<{
    campaign: string; total: number; sales: number; rto: number;
    cod: number; paid: number; total_amount: number;
  }>(
    `SELECT
      COALESCE(NULLIF(campaign,''),'Unknown') AS campaign,
      COUNT(*) AS total,
      SUM(CASE WHEN calling_status='Sale Made' THEN 1 ELSE 0 END) AS sales,
      SUM(CASE WHEN rto_status IS NOT NULL AND rto_status != '' THEN 1 ELSE 0 END) AS rto,
      SUM(CASE WHEN payment_status='COD' THEN 1 ELSE 0 END) AS cod,
      SUM(CASE WHEN payment_status='Prepaid' THEN 1 ELSE 0 END) AS paid,
      SUM(COALESCE(amount,0)) AS total_amount
     FROM db_masmis.bb_sale
     WHERE sale_date BETWEEN ? AND ? AND calling_status = 'Sale Made'
     GROUP BY campaign ORDER BY sales DESC`,
    [start, end]
  );

  const totals = rows.reduce(
    (acc, r) => {
      acc.total   += r.total;
      acc.sales   += r.sales;
      acc.rto     += r.rto;
      acc.cod     += r.cod;
      acc.paid    += r.paid;
      acc.revenue += r.total_amount;
      return acc;
    },
    { total: 0, sales: 0, rto: 0, cod: 0, paid: 0, revenue: 0 }
  );

  const salesTotal = totals.sales || 1;
  return {
    month,
    overall: {
      ...totals,
      rto_pct:              Math.round(totals.rto / salesTotal * 100 * 10) / 10,
      cod_pct:              Math.round(totals.cod / salesTotal * 100 * 10) / 10,
      paid_pct:             Math.round(totals.paid / salesTotal * 100 * 10) / 10,
      aov:                  Math.round(totals.revenue / salesTotal),
      net_revenue_ex_gst:   Math.round(totals.revenue / 1.18),
    },
    by_campaign: rows,
  };
}

// ── Sales KPIs from dialer data ────────────────────────────────────────────
export interface SalesFilters {
  startDate: string;
  endDate: string;
  clientIds?: number[];
  lob?: string;
}

export async function getSalesKPIs(filters: SalesFilters) {
  const { startDate, endDate } = filters;
  const [row] = await querySource<{
    total: number; sales: number; conv_pct: number;
  }>(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN Category1='Sale' OR Category1='SALE' OR Field14='Yes' THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN Category1='Sale' OR Category1='SALE' OR Field14='Yes' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM dialer_db.data_master_in
     WHERE DATE(CallDate) BETWEEN ? AND ?`,
    [startDate, endDate]
  );
  return row ?? null;
}

export async function getSalesTrend(filters: SalesFilters) {
  const { startDate, endDate } = filters;
  return querySource<{ date: string; calls: number; sales: number }>(
    `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date,
      COUNT(*) AS calls,
      SUM(CASE WHEN Category1='Sale' OR Category1='SALE' OR Field14='Yes' THEN 1 ELSE 0 END) AS sales
     FROM dialer_db.data_master_in
     WHERE DATE(CallDate) BETWEEN ? AND ?
     GROUP BY DATE(CallDate) ORDER BY date ASC`,
    [startDate, endDate]
  );
}
