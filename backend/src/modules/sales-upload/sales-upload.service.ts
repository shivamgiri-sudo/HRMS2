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
//
// FLAGGED, NOT FIXED (2026-08-13): every INSERT/DELETE-side function in this file —
// logUpload(), deleteUploadBatch() below, and every uploadXxx() function through
// "Neemans Upload Functions" — writes to
// column names that do not exist on the real db_masmis tables (verified live: e.g.
// upload_log's real columns are id/batch_id/table_name/file_name/row_count/uploaded_by/
// uploaded_at, not upload_type/month_label; getUploadLogs()'s own real historical rows —
// genuine successful uploads with table_name/file_name populated — prove some OTHER,
// external, non-HRMS2 process is what actually writes these tables, and that these
// upload* functions have in all likelihood never once succeeded). The read-side dashboard
// functions above/below were fixed against verified real schemas because a wrong SELECT
// only serves wrong numbers, which is safely bounded by testing against real data. The
// write side is left unfixed deliberately: the real Excel template each upload function
// expects is unknown, and guessing at INSERT column mappings risks silently corrupting
// live financial/sales data with no way to verify correctness short of a real file from
// whoever owns that external process. Do not fix without a real sample file + explicit
// sign-off on the target columns.

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
  // db_masmis.upload_log's real columns are (id, batch_id, table_name, file_name, row_count,
  // uploaded_by, uploaded_at) — verified live 2026-08-13 (35 real rows, e.g. table_name
  // 'bvo_order_export', file_name "Dec'25.xlsx"). upload_type/month_label/created_at never
  // existed; this SELECT threw ER_BAD_FIELD_ERROR on every call. Aliased back to the original
  // names so callers reading upload_type/month_label/created_at keep working.
  //
  // A second, independent bug found live alongside the column fix: mysql2's `.execute()`
  // (prepared statement / binary protocol, what queryMasmis always uses) cannot bind a
  // `LIMIT ?` placeholder against this server — confirmed directly, "Incorrect arguments to
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

// db_masmis.bb_sale's real columns bear no relation to what this file's INSERT (see
// uploadBellavitaSales) assumes — verified live 2026-08-13 against 23,391 real rows. The
// table is populated by some process other than this codebase (uploadBellavitaSales would
// itself throw ER_BAD_FIELD_ERROR on every one of its 25 INSERT columns; see the comment
// there). Real-to-assumed mapping used below, confirmed against actual distinct values:
//   order_status  -> current_status  ('DELIVERED' 18214, 'RTO' 413, 'RTD' 2583, ... of 23391)
//   payment_mode  -> payment_status  ('paid' 16071 / 'cod' 7320 — lowercase, not 'COD')
//   selling_price -> amount          (decimal(12,2); only one monetary column exists — no
//                                     separate gross/net/GST breakdown in the real table)
//   net_revenue   -> amount          (same column; "net ex-GST" and "selling price" collapse
//                                     to the one figure that actually exists)
//   order_date    -> `Order Date`    (literal column name with a space, backtick-quoted;
//                                     matches the exact key uploadBellavitaSales already reads
//                                     from an Excel row — r["Order Date"] — so this is very
//                                     likely the field the original design intended all along)
//   campaign      -> campaign        (unchanged — exists as-is)
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

// ── GNC Dashboard ─────────────────────────────────────────────────────────────

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
//                              to begin with — not fabricated here; see the null with the
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
  // total/calls is real; quality_score never existed (see comment above) — valid_pct and
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

// ── Neemans Dashboard ─────────────────────────────────────────────────────────

function parseNeemansDate(raw: unknown): string | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const d = new Date(Date.UTC(1900, 0, n - 1));
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// db_masmis.neemans_month_targets's real columns are (id, month, target, created_by,
// updated_at) — verified live 2026-08-13 against the 2 real rows that exist (month
// '2026-06'/'2026-07', target 6774194.00/7000000.00). There is no month_label, no
// daily_target, no total_target: only one monthly figure is stored, not a daily/total
// split. daily_target is derived here (target / days in that month) rather than stored,
// since the real schema was never asking for two independent numbers — that removes the
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

// total_target maps onto the one real `target` column — the closer, unambiguous fit of the
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
// doj, fhd, status, dol, created_by, updated_by, created_at, updated_at, monthly_target) —
// verified live 2026-08-13 against 22 real rows (status values are literally 'Active' /
// 'Inactive', not a boolean flag). agent_id/agent_name/team/active never existed; there is
// no designation column at all — returned as NULL rather than fabricated, since nothing in
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
// occupancy_pct/call_date/total_calls never existed — real names are emp_id/emp_name/
// occu_pct/date/calls. date is stored as text like "01-Jul-2026" (%d-%b-%Y), not a DATE
// column, hence STR_TO_DATE before DATE_FORMAT can bucket it by month. total_calls (the
// old SUM target) doesn't exist either; the original COUNT(*) for "total_calls" was
// actually counting agent-day rows, not real call volume — SUM(calls), the real column
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
// inserted_at — individual abandoned-cart records. section_label/metric_label/mtd_value/
// weekly_value/daily_value/month_label/section_order/metric_order (the KPI-snapshot shape
// this function assumed) do not exist anywhere in the real table, and the table is
// currently empty (0 rows) besides. There is no way to map a per-cart-record table onto a
// pre-aggregated KPI-snapshot shape without inventing numbers, so this is left flagged
// rather than fixed — same "don't fabricate" rule as the other real gaps in this file.
export async function getNeemansAbcCartSnap(_month: string): Promise<Record<string, unknown>[]> {
  throw new Error(
    "Neemans ABC cart snapshot is unavailable: db_masmis.neemans_cart stores individual " +
    "cart records (cart_id, customer_name, agent, disposition, status...), not the " +
    "aggregated section/metric snapshot this dashboard expects, and currently holds 0 rows."
  );
}

// db_masmis.neemans_sale_raw's real columns, verified live 2026-08-13: order_status,
// revenue, payment_mode, sale_date never existed. Real: status (only 'Sale Made'/'PTP' —
// 'Sale Made' is the real-world equivalent of the old 'Confirmed'), amount (revenue),
// payment_status (lowercase: 'paid'/'cod'/'pending'/'partially_paid'/'voided'/'refunded'/
// 'partially_refunded' — 'paid'/'cod' are the old 'Paid'/'COD'), name (agent_name), and
// date, which is an Excel serial number stored as text (e.g. "46174"), not a DATE column —
// converted here the same way parseNeemansDate() already decodes it elsewhere in this file
// (Excel's day-1900 epoch, off-by-one included). There is no real 'RTO' status value and no
// telephony-connection column (no 'Not Connected'/'IVR' concept exists in this table at
// all — every row here is already a logged sales disposition, not a raw call log), so
// rto_pct and connected_pct are left NULL rather than invented.
const NEEMANS_DATE_SQL = "DATE_ADD('1900-01-01', INTERVAL (CAST(`date` AS UNSIGNED) - 2) DAY)";

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
  // figure per month (real columns: id, month, target, created_by, updated_at) — no
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

// ── Neemans Upload Functions ──────────────────────────────────────────────────

export async function uploadNeemansSaleRaw(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const saleDate = parseNeemansDate(r["Date"] ?? r["sale_date"] ?? r["Order Date"]);
    if (!saleDate) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.neemans_sale_raw
         (upload_batch_id, sale_date, lead_id, agent_id, agent_name, status,
          order_status, payment_mode, revenue, product, remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        batchId, saleDate,
        String(r["Lead ID"] ?? r["lead_id"] ?? ""),
        String(r["Agent ID"] ?? r["agent_id"] ?? ""),
        String(r["Agent Name"] ?? r["agent_name"] ?? ""),
        String(r["Status"] ?? r["status"] ?? ""),
        String(r["Order Status"] ?? r["order_status"] ?? ""),
        String(r["Payment Mode"] ?? r["payment_mode"] ?? ""),
        Number(r["Revenue"] ?? r["revenue"] ?? 0),
        String(r["Product"] ?? r["product"] ?? ""),
        String(r["Remarks"] ?? r["remarks"] ?? ""),
      ]
    );
    count++;
  }
  const monthLabel = rows[0] ? (parseNeemansDate(rows[0]["Date"] ?? rows[0]["sale_date"] ?? rows[0]["Order Date"]) ?? "").slice(0, 7) : "";
  await logUpload("neemans-sale-raw", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

export async function uploadNeemansAllocation(
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
      `INSERT INTO db_masmis.neemans_allocation
         (upload_batch_id, month_label, agent_id, agent_name, allocated_leads, contacted, not_contacted)
       VALUES (?,?,?,?,?,?,?)`,
      [
        batchId, monthLabel,
        String(r["Agent ID"] ?? r["agent_id"] ?? ""),
        String(r["Agent Name"] ?? r["agent_name"] ?? ""),
        Number(r["Allocated"] ?? r["allocated_leads"] ?? 0),
        Number(r["Contacted"] ?? r["contacted"] ?? 0),
        Number(r["Not Contacted"] ?? r["not_contacted"] ?? 0),
      ]
    );
    count++;
  }
  await logUpload("neemans-allocation", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}

export async function uploadNeemansApr(
  buffer: Buffer, uploadedBy: string
): Promise<{ rowsInserted: number }> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const batchId = uuidv4();
  let count = 0;
  for (const r of rows) {
    const callDate = parseNeemansDate(r["Date"] ?? r["call_date"]);
    if (!callDate) continue;
    await queryMasmis(
      `INSERT INTO db_masmis.neemans_apr
         (upload_batch_id, call_date, agent_id, agent_name, total_calls, attendance, occupancy_pct, acht)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        batchId, callDate,
        String(r["Agent ID"] ?? r["agent_id"] ?? ""),
        String(r["Agent Name"] ?? r["agent_name"] ?? ""),
        Number(r["Total Calls"] ?? r["total_calls"] ?? 0),
        Number(r["Attendance"] ?? r["attendance"] ?? 0),
        Number(r["Occupancy %"] ?? r["occupancy_pct"] ?? 0),
        Number(r["ACHT"] ?? r["acht"] ?? 0),
      ]
    );
    count++;
  }
  const monthLabel = rows[0] ? (parseNeemansDate(rows[0]["Date"] ?? rows[0]["call_date"]) ?? "").slice(0, 7) : "";
  await logUpload("neemans-apr", monthLabel, count, uploadedBy, batchId);
  return { rowsInserted: count };
}
