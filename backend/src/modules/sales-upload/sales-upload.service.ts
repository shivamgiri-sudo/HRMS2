import * as XLSX from "xlsx";
import { v4 as uuidv4 } from "uuid";
import { queryMasmis } from "../../db/masmisDb.js";
import { querySource } from "../../db/sourceDb.js";

// ── Date helpers ──────────────────────────────────────────────────────────────

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

// ── Upload log ────────────────────────────────────────────────────────────────

export async function logUpload(
  uploadType: string, monthLabel: string, rowCount: number,
  uploadedBy: string, batchId: string
): Promise<void> {
  await queryMasmis(
    `INSERT INTO db_masmis.upload_log (batch_id, upload_type, month_label, row_count, uploaded_by)
     VALUES (?, ?, ?, ?, ?)`,
    [batchId, uploadType, monthLabel, rowCount, uploadedBy]
  );
}

export async function getUploadLogs(limit = 50): Promise<Record<string, unknown>[]> {
  return queryMasmis(
    `SELECT id, batch_id, upload_type, month_label, row_count, uploaded_by, created_at
     FROM db_masmis.upload_log ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

export async function deleteUploadBatch(batchId: string): Promise<void> {
  // Delete from all tables using the batch_id column
  const tables = [
    "db_masmis.bb_sale", "db_masmis.bb_apr", "db_masmis.bb_chat", "db_masmis.bb_cart",
    "db_masmis.gnc_sale", "db_masmis.gnc_apr", "db_masmis.gnc_allocation",
  ];
  for (const tbl of tables) {
    await queryMasmis(`DELETE FROM ${tbl} WHERE upload_batch_id = ?`, [batchId]);
  }
  await queryMasmis(`DELETE FROM db_masmis.upload_log WHERE batch_id = ?`, [batchId]);
}

// ── Bellavita Sales Upload ────────────────────────────────────────────────────

export async function uploadBellavitaSales(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const orderDate = parseBellavitaDate(r["Order Date"] ?? r["order_date"]);
    if (!orderDate) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.bb_sale
         (upload_batch_id, order_id, order_date, campaign, product, sku, qty, mrp, selling_price,
          discount, tax_pct, gross_revenue, net_revenue, gst_amount, payment_mode, order_status,
          courier, awb_no, city, state, pincode, agent_id, agent_name, source, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        batchId,
        String(r["Order ID"] ?? r["order_id"] ?? ""),
        orderDate,
        String(r["Campaign"] ?? r["campaign"] ?? ""),
        String(r["Product"] ?? r["product"] ?? ""),
        String(r["SKU"] ?? r["sku"] ?? ""),
        Number(r["Qty"] ?? r["qty"] ?? 0),
        Number(r["MRP"] ?? r["mrp"] ?? 0),
        Number(r["Selling Price"] ?? r["selling_price"] ?? 0),
        Number(r["Discount"] ?? r["discount"] ?? 0),
        Number(r["Tax %"] ?? r["tax_pct"] ?? 0),
        Number(r["Gross Revenue"] ?? r["gross_revenue"] ?? 0),
        Number(r["Net Revenue"] ?? r["net_revenue"] ?? 0),
        Number(r["GST Amount"] ?? r["gst_amount"] ?? 0),
        String(r["Payment Mode"] ?? r["payment_mode"] ?? ""),
        String(r["Order Status"] ?? r["order_status"] ?? ""),
        String(r["Courier"] ?? r["courier"] ?? ""),
        String(r["AWB"] ?? r["awb_no"] ?? ""),
        String(r["City"] ?? r["city"] ?? ""),
        String(r["State"] ?? r["state"] ?? ""),
        String(r["Pincode"] ?? r["pincode"] ?? ""),
        String(r["Agent ID"] ?? r["agent_id"] ?? ""),
        String(r["Agent Name"] ?? r["agent_name"] ?? ""),
        String(r["Source"] ?? r["source"] ?? ""),
        String(r["Remarks"] ?? r["remarks"] ?? ""),
      ]
    );
    count++;
  }
  const monthLabel = rows[0] ? (parseBellavitaDate(rows[0]["Order Date"] ?? rows[0]["order_date"]) ?? "").slice(0, 7) : "";
  await logUpload("bellavita-sales", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

// ── GNC Sales Upload ──────────────────────────────────────────────────────────

export async function uploadGncSales(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const saleDate = parseBellavitaDate(r["Sale Date"] ?? r["sale_date"] ?? r["Date"]);
    if (!saleDate) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.gnc_sale
         (upload_batch_id, sale_date, order_id, product, sku, qty, unit_price, total_revenue,
          discount, payment_mode, status, agent_id, agent_name, campaign, city, state, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        batchId,
        saleDate,
        String(r["Order ID"] ?? r["order_id"] ?? ""),
        String(r["Product"] ?? r["product"] ?? ""),
        String(r["SKU"] ?? r["sku"] ?? ""),
        Number(r["Qty"] ?? r["qty"] ?? 0),
        Number(r["Unit Price"] ?? r["unit_price"] ?? 0),
        Number(r["Total Revenue"] ?? r["total_revenue"] ?? 0),
        Number(r["Discount"] ?? r["discount"] ?? 0),
        String(r["Payment Mode"] ?? r["payment_mode"] ?? ""),
        String(r["Status"] ?? r["status"] ?? ""),
        String(r["Agent ID"] ?? r["agent_id"] ?? ""),
        String(r["Agent Name"] ?? r["agent_name"] ?? ""),
        String(r["Campaign"] ?? r["campaign"] ?? ""),
        String(r["City"] ?? r["city"] ?? ""),
        String(r["State"] ?? r["state"] ?? ""),
        String(r["Remarks"] ?? r["remarks"] ?? ""),
      ]
    );
    count++;
  }
  const monthLabel = rows[0] ? (parseBellavitaDate(rows[0]["Sale Date"] ?? rows[0]["sale_date"] ?? rows[0]["Date"]) ?? "").slice(0, 7) : "";
  await logUpload("gnc-sales", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

// ── GNC APR Upload ────────────────────────────────────────────────────────────

export async function uploadGncApr(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const callDate = parseBellavitaDate(r["Call Date"] ?? r["call_date"] ?? r["Date"]);
    if (!callDate) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.gnc_apr
         (upload_batch_id, call_date, agent_id, agent_name, calls_handled, sales_attempts,
          sales_closed, conversion_pct, avg_handle_time, quality_score, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        batchId,
        callDate,
        String(r["Agent ID"] ?? r["agent_id"] ?? ""),
        String(r["Agent Name"] ?? r["agent_name"] ?? ""),
        Number(r["Calls Handled"] ?? r["calls_handled"] ?? 0),
        Number(r["Sales Attempts"] ?? r["sales_attempts"] ?? 0),
        Number(r["Sales Closed"] ?? r["sales_closed"] ?? 0),
        Number(r["Conversion %"] ?? r["conversion_pct"] ?? 0),
        Number(r["Avg Handle Time"] ?? r["avg_handle_time"] ?? 0),
        Number(r["Quality Score"] ?? r["quality_score"] ?? 0),
        String(r["Remarks"] ?? r["remarks"] ?? ""),
      ]
    );
    count++;
  }
  const monthLabel = rows[0] ? (parseBellavitaDate(rows[0]["Call Date"] ?? rows[0]["call_date"] ?? rows[0]["Date"]) ?? "").slice(0, 7) : "";
  await logUpload("gnc-apr", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

// ── GNC Allocation Upload ─────────────────────────────────────────────────────

export async function uploadGncAllocation(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  let count = 0;
  const monthLabel = currentMonthLabel();
  for (const r of rows) {
    await queryMasmis(
      `INSERT INTO db_masmis.gnc_allocation
         (upload_batch_id, month_label, agent_id, agent_name, allocated_leads,
          contacted, not_contacted, dnd, invalid, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        batchId, monthLabel,
        String(r["Agent ID"] ?? r["agent_id"] ?? ""),
        String(r["Agent Name"] ?? r["agent_name"] ?? ""),
        Number(r["Allocated"] ?? r["allocated_leads"] ?? 0),
        Number(r["Contacted"] ?? r["contacted"] ?? 0),
        Number(r["Not Contacted"] ?? r["not_contacted"] ?? 0),
        Number(r["DND"] ?? r["dnd"] ?? 0),
        Number(r["Invalid"] ?? r["invalid"] ?? 0),
        String(r["Remarks"] ?? r["remarks"] ?? ""),
      ]
    );
    count++;
  }
  await logUpload("gnc-allocation", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

// ── Bellavita APR Upload ──────────────────────────────────────────────────────

export async function uploadBellavitaApr(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const callDate = parseBellavitaDate(r["Call Date"] ?? r["call_date"] ?? r["Date"]);
    if (!callDate) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.bb_apr
         (upload_batch_id, call_date, agent_id, agent_name, campaign, total_calls,
          sales_calls, sales_closed, conversion_pct, cod_orders, prepaid_orders,
          rto_orders, avg_handle_time, quality_score, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        batchId, callDate,
        String(r["Agent ID"] ?? r["agent_id"] ?? ""),
        String(r["Agent Name"] ?? r["agent_name"] ?? ""),
        String(r["Campaign"] ?? r["campaign"] ?? ""),
        Number(r["Total Calls"] ?? r["total_calls"] ?? 0),
        Number(r["Sales Calls"] ?? r["sales_calls"] ?? 0),
        Number(r["Sales Closed"] ?? r["sales_closed"] ?? 0),
        Number(r["Conversion %"] ?? r["conversion_pct"] ?? 0),
        Number(r["COD Orders"] ?? r["cod_orders"] ?? 0),
        Number(r["Prepaid Orders"] ?? r["prepaid_orders"] ?? 0),
        Number(r["RTO Orders"] ?? r["rto_orders"] ?? 0),
        Number(r["Avg Handle Time"] ?? r["avg_handle_time"] ?? 0),
        Number(r["Quality Score"] ?? r["quality_score"] ?? 0),
        String(r["Remarks"] ?? r["remarks"] ?? ""),
      ]
    );
    count++;
  }
  const monthLabel = rows[0] ? (parseBellavitaDate(rows[0]["Call Date"] ?? rows[0]["call_date"] ?? rows[0]["Date"]) ?? "").slice(0, 7) : "";
  await logUpload("bellavita-apr", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

// ── Bellavita Chat Upload ─────────────────────────────────────────────────────

export async function uploadBellavitaChat(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  let count = 0;
  const monthLabel = currentMonthLabel();
  for (const r of rows) {
    const chatDatetime = parseChatDatetime(r["Chat Date"] ?? r["chat_datetime"] ?? r["DateTime"]);
    await queryMasmis(
      `INSERT INTO db_masmis.bb_chat
         (upload_batch_id, month_label, chat_datetime, agent_id, agent_name, customer_id,
          platform, issue_type, resolution, csat_score, first_response_sec, handle_time_sec, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        batchId, monthLabel,
        chatDatetime,
        String(r["Agent ID"] ?? r["agent_id"] ?? ""),
        String(r["Agent Name"] ?? r["agent_name"] ?? ""),
        String(r["Customer ID"] ?? r["customer_id"] ?? ""),
        String(r["Platform"] ?? r["platform"] ?? ""),
        String(r["Issue Type"] ?? r["issue_type"] ?? ""),
        String(r["Resolution"] ?? r["resolution"] ?? ""),
        Number(r["CSAT Score"] ?? r["csat_score"] ?? 0),
        Number(r["First Response (sec)"] ?? r["first_response_sec"] ?? 0),
        Number(r["Handle Time (sec)"] ?? r["handle_time_sec"] ?? 0),
        String(r["Remarks"] ?? r["remarks"] ?? ""),
      ]
    );
    count++;
  }
  await logUpload("bellavita-chat", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

// ── Bellavita Cart Upload ─────────────────────────────────────────────────────

export async function uploadBellavitaCart(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  let count = 0;
  const monthLabel = currentMonthLabel();
  for (const r of rows) {
    const cartDate = parseBellavitaDate(r["Date"] ?? r["cart_date"]);
    await queryMasmis(
      `INSERT INTO db_masmis.bb_cart
         (upload_batch_id, month_label, cart_date, order_id, customer_id, product,
          cart_value, recovered, recovery_date, agent_id, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        batchId, monthLabel,
        cartDate,
        String(r["Order ID"] ?? r["order_id"] ?? ""),
        String(r["Customer ID"] ?? r["customer_id"] ?? ""),
        String(r["Product"] ?? r["product"] ?? ""),
        Number(r["Cart Value"] ?? r["cart_value"] ?? 0),
        r["Recovered"] ? 1 : 0,
        parseBellavitaDate(r["Recovery Date"] ?? r["recovery_date"]),
        String(r["Agent ID"] ?? r["agent_id"] ?? ""),
        String(r["Remarks"] ?? r["remarks"] ?? ""),
      ]
    );
    count++;
  }
  await logUpload("bellavita-cart", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

// ── Bellavita Dashboard ───────────────────────────────────────────────────────

export async function getBellavitaDashboard(month: string): Promise<{
  overall: Record<string, unknown>;
  by_campaign: Record<string, unknown>[];
}> {
  const [overall] = await queryMasmis<Record<string, unknown>>(
    `SELECT
       COUNT(*) AS total_orders,
       SUM(CASE WHEN order_status = 'RTO' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS rto_pct,
       SUM(CASE WHEN payment_mode = 'COD' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS cod_pct,
       SUM(CASE WHEN payment_mode != 'COD' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS paid_pct,
       AVG(selling_price) AS aov,
       SUM(net_revenue) AS net_revenue_ex_gst
     FROM db_masmis.bb_sale
     WHERE DATE_FORMAT(order_date, '%Y-%m') = ?`,
    [month]
  );
  const by_campaign = await queryMasmis<Record<string, unknown>>(
    `SELECT
       campaign,
       COUNT(*) AS orders,
       SUM(CASE WHEN order_status = 'RTO' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS rto_pct,
       SUM(CASE WHEN payment_mode = 'COD' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS cod_pct,
       SUM(CASE WHEN payment_mode != 'COD' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS paid_pct,
       AVG(selling_price) AS aov,
       SUM(net_revenue) AS net_revenue
     FROM db_masmis.bb_sale
     WHERE DATE_FORMAT(order_date, '%Y-%m') = ?
     GROUP BY campaign ORDER BY orders DESC`,
    [month]
  );
  return { overall: overall ?? {}, by_campaign };
}

// ── GNC Dashboard ─────────────────────────────────────────────────────────────

export async function getGncDashboard(month: string): Promise<{
  summary: Record<string, unknown>;
  by_product: Record<string, unknown>[];
  apr_summary: Record<string, unknown>;
}> {
  const [summary] = await queryMasmis<Record<string, unknown>>(
    `SELECT
       COUNT(*) AS total_sales,
       SUM(total_revenue) AS total_revenue,
       AVG(unit_price) AS avg_order,
       0 AS conversion_pct
     FROM db_masmis.gnc_sale
     WHERE DATE_FORMAT(sale_date, '%Y-%m') = ?`,
    [month]
  );
  const by_product = await queryMasmis<Record<string, unknown>>(
    `SELECT product, SUM(qty) AS units, SUM(total_revenue) AS revenue
     FROM db_masmis.gnc_sale
     WHERE DATE_FORMAT(sale_date, '%Y-%m') = ?
     GROUP BY product ORDER BY units DESC`,
    [month]
  );
  const aprRows = await queryMasmis<Record<string, unknown>>(
    `SELECT
       COUNT(*) AS total,
       AVG(quality_score) AS valid_pct,
       (100 - AVG(quality_score)) AS invalid_pct
     FROM db_masmis.gnc_apr
     WHERE DATE_FORMAT(call_date, '%Y-%m') = ?`,
    [month]
  );
  return { summary: summary ?? {}, by_product, apr_summary: aprRows[0] ?? {} };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Sales KPIs from dialer ─────────────────────────────────────────────────────

export async function getSalesKPIs(startDate: string, endDate: string): Promise<Record<string, unknown>> {
  const rows = await querySource<Record<string, unknown>>(
    `SELECT COUNT(*) AS total_records FROM dialer_db.data_master_in
     WHERE DATE(calldate) BETWEEN ? AND ?`,
    [startDate, endDate]
  );
  return rows[0] ?? {};
}
