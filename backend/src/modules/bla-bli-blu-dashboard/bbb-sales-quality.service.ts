import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildCorrectionStatus, buildMonthList, type CorrectionUploadRow } from "./bbb-months.js";
import {
  groupRejectsByReason, planDateCorrections, rejectInFileDuplicates, uploadSummary, validateSalesRow,
  type RejectCode, type SalesReject,
} from "../bulk-upload/bla-bli-blu-sales-validation.js";

/**
 * Blabli Blu sales data quality: month list and trend (BB-01), upload status with success % and the structured
 * rejection log (BB-02 / BB-04), correction status per date and the pre-import warning (BB-03), and when the data
 * last changed (BB-05). Everything reads the same committed tables the dashboard totals read.
 */

const SALES = "bla_bli_blu_overall_sales_raw";
const UPLOAD_CODE = "BLA_BLI_BLU_OVERALL_SALES";
const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const missingTable = (e: unknown) => /ER_NO_SUCH_TABLE|doesn't exist/i.test(e instanceof Error ? e.message : String(e));

/** Every month with data (oldest first) with its order count, Real Time Sales and revenue, for the selector and trend. */
export async function listMonths() {
  const [sales] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date,'%Y-%m') AS m, COUNT(*) AS orders,
            SUM(business_type='Real Time Sales') AS rts,
            SUM(CASE WHEN business_type='Real Time Sales' THEN COALESCE(amount,0) ELSE 0 END) AS revenue
       FROM ${SALES} WHERE report_date IS NOT NULL GROUP BY m`);
  const [recv] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT DATE_FORMAT(report_date,'%Y-%m') AS m FROM bla_dash_received_daily`);
  return buildMonthList(
    sales.map((r) => ({ month: String(r.m), orders: n(r.orders), realTimeSales: n(r.rts), revenue: n(r.revenue) })),
    recv.map((r) => String(r.m)),
  );
}

/** When the dashboard's data last changed: last sales import / order write and last Received Data upload. */
export async function dataFreshness() {
  const [[s], [b], [r]] = await Promise.all([
    db.execute<RowDataPacket[]>(`SELECT MAX(updated_at) AS at FROM ${SALES}`),
    db.execute<RowDataPacket[]>(
      `SELECT MAX(COALESCE(imported_at, updated_at)) AS at FROM upload_batch
        WHERE upload_type_code = ? AND batch_status IN ('imported','imported_with_errors','validation_failed')`, [UPLOAD_CODE]),
    db.execute<RowDataPacket[]>(`SELECT MAX(uploaded_at) AS at FROM bbb_upload_batch WHERE kind = 'received'`),
  ]);
  return {
    refreshedAt: new Date().toISOString(),
    lastSalesChange: iso(s[0]?.at),
    lastSalesImport: iso(b[0]?.at),
    lastReceivedUpload: iso(r[0]?.at),
  };
}

export interface SalesUpload {
  batchId: string; batchNo: string; fileName: string | null; uploadedAt: string | null; uploadedBy: string | null;
  status: string; totalRows: number; acceptedRows: number; rejectedRows: number; successPct: number; rejectionPct: number;
  months: string[]; updatedOrders: number | null; newOrders: number | null; duplicateInFile: number | null;
  technicalRejects: number | null; warningRows: number | null;
}

/** Overall Sales uploads from the Bulk Upload Hub, newest first, with Total / Accepted / Rejected / Success %. */
export async function listSalesUploads(limit = 60): Promise<SalesUpload[]> {
  const lim = Math.min(200, Math.max(1, Math.floor(limit) || 60));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ub.id, ub.upload_batch_no, ub.original_file_name, ub.created_at, ub.batch_status, ub.total_rows,
            ub.imported_rows, ub.error_rows, JSON_EXTRACT(ub.metadata, '$.bbbSales') AS q,
            COALESCE(NULLIF(TRIM(e.full_name), ''), ub.uploaded_by) AS by_name
       FROM upload_batch ub LEFT JOIN employees e ON e.user_id = ub.uploaded_by
      WHERE ub.upload_type_code = ? ORDER BY ub.created_at DESC LIMIT ${lim}`, [UPLOAD_CODE]);
  return rows.map((r) => {
    const q = (typeof r.q === "string" ? JSON.parse(r.q) : r.q) as Record<string, unknown> | null;
    // Batches from before the reject log only have the hub's counters; the summary is rebuilt from those.
    const total = q ? n(q.totalRows) : n(r.total_rows);
    const accepted = q ? n(q.acceptedRows) : n(r.imported_rows);
    const rejected = q ? n(q.rejectedRows) : n(r.error_rows);
    const s = uploadSummary(total, accepted, rejected);
    const opt = (k: string) => (q && q[k] !== undefined ? n(q[k]) : null);
    return {
      batchId: String(r.id), batchNo: String(r.upload_batch_no), fileName: r.original_file_name ? String(r.original_file_name) : null,
      uploadedAt: iso(r.created_at), uploadedBy: r.by_name ? String(r.by_name) : null, status: String(r.batch_status),
      ...s, months: Array.isArray(q?.months) ? (q!.months as string[]) : [],
      updatedOrders: opt("updatedOrders"), newOrders: opt("newOrders"), duplicateInFile: opt("duplicateInFile"),
      technicalRejects: opt("technicalRejects"), warningRows: opt("warningRows"),
    };
  });
}

async function batchExists(batchId: string): Promise<boolean> {
  const [b] = await db.execute<RowDataPacket[]>("SELECT 1 FROM upload_batch WHERE id = ? AND upload_type_code = ? LIMIT 1", [batchId, UPLOAD_CODE]);
  return b.length > 0;
}

/** One upload's rejection log (row, field, value, reason, required format, category), reason counts and date corrections. */
export async function getSalesUploadDetail(batchId: string) {
  if (!(await batchExists(batchId))) throw new Error("That sales upload was not found.");
  let rejects: SalesReject[] = [];
  let logAvailable = true;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT row_no, field_name, uploaded_value, reason_code, reason, required_format, category, severity
         FROM bla_bli_blu_sales_upload_reject WHERE upload_batch_id = ? ORDER BY row_no, id LIMIT 5000`, [batchId]);
    rejects = rows.map((r) => ({
      row: n(r.row_no), field: String(r.field_name), value: r.uploaded_value === null ? null : String(r.uploaded_value),
      code: String(r.reason_code) as RejectCode, reason: String(r.reason), requiredFormat: r.required_format ? String(r.required_format) : null,
      category: r.category === "technical" ? "technical" : "business", severity: r.severity === "warning" ? "warning" : "reject",
    }));
  } catch (e) {
    if (!missingTable(e)) throw e;
    logAvailable = false;
  }
  // Older batches (before the structured log) still have the hub's per-row sentences: show those, uncategorised.
  let legacy: Array<{ row: number; message: string }> = [];
  if (!rejects.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT row_no, error_messages FROM upload_batch_row WHERE upload_batch_id = ? AND row_status IN ('error','failed') ORDER BY row_no LIMIT 2000`, [batchId]);
    legacy = rows.map((r) => {
      const m = typeof r.error_messages === "string" ? JSON.parse(r.error_messages) : r.error_messages;
      return { row: n(r.row_no), message: Array.isArray(m) ? m.join("; ") : String(m ?? "") };
    });
  }
  let dates: Array<Record<string, unknown>> = [];
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS d, existing_count, upload_count, updated_count, inserted_count, after_count
         FROM bla_bli_blu_sales_upload_date WHERE upload_batch_id = ? ORDER BY report_date`, [batchId]);
    dates = rows.map((r) => ({
      reportDate: String(r.d), existingCount: n(r.existing_count), uploadCount: n(r.upload_count), updatedCount: n(r.updated_count),
      insertedCount: n(r.inserted_count), afterCount: n(r.after_count), variance: n(r.upload_count) - n(r.existing_count),
    }));
  } catch (e) { if (!missingTable(e)) throw e; }
  return { batchId, logAvailable, rejects, reasons: groupRejectsByReason(rejects), legacy, dates };
}

/** Correction status per date in a range: the latest upload per date vs what existed, and the live count now. */
export async function getCorrectionStatus(from: string, to: string) {
  let uploads: CorrectionUploadRow[] = [];
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(d.report_date,'%Y-%m-%d') AS d, d.upload_batch_id, b.upload_batch_no, b.original_file_name, b.created_at,
              d.existing_count, d.upload_count, d.updated_count, d.inserted_count, d.after_count
         FROM bla_bli_blu_sales_upload_date d JOIN upload_batch b ON b.id = d.upload_batch_id
        WHERE d.report_date BETWEEN ? AND ?`, [from, to]);
    uploads = rows.map((r) => ({
      reportDate: String(r.d), batchId: String(r.upload_batch_id), batchNo: String(r.upload_batch_no),
      fileName: r.original_file_name ? String(r.original_file_name) : null, uploadedAt: iso(r.created_at) ?? "",
      existingCount: n(r.existing_count), uploadCount: n(r.upload_count), updatedCount: n(r.updated_count),
      insertedCount: n(r.inserted_count), afterCount: n(r.after_count),
    }));
  } catch (e) { if (!missingTable(e)) throw e; }
  const [live] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS d, COUNT(*) AS rows_n, COUNT(DISTINCT process_id, order_id) AS orders
       FROM ${SALES} WHERE report_date BETWEEN ? AND ? GROUP BY d`, [from, to]);
  const liveMap = new Map(live.map((r) => [String(r.d), { rows: n(r.rows_n), distinctOrders: n(r.orders) }]));
  return { from, to, dates: buildCorrectionStatus(uploads, liveMap) };
}

/**
 * Before importing a staged Overall Sales batch: how many rows are valid, which would be rejected and why, how many
 * OrderIDs repeat inside the file, and how many orders already exist and will be UPDATED (per date, with variance).
 * Read-only; the Bulk Upload Hub shows it as a warning before the import starts.
 */
export async function previewSalesBatch(batchId: string) {
  if (!(await batchExists(batchId))) throw new Error("That sales upload was not found.");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT row_no, normalized_data FROM upload_batch_row WHERE upload_batch_id = ? AND row_status IN ('valid','pending') ORDER BY row_no`, [batchId]);
  const issues: SalesReject[] = [];
  const ok: Array<{ row: number; orderId: string; reportDate: string }> = [];
  for (const r of rows) {
    const data = typeof r.normalized_data === "string" ? JSON.parse(r.normalized_data) : (r.normalized_data ?? {});
    const v = validateSalesRow(data as Record<string, unknown>, n(r.row_no));
    issues.push(...v.issues);
    if (v.record) ok.push({ row: n(r.row_no), orderId: v.record.orderId, reportDate: v.record.reportDate });
  }
  const dupes = rejectInFileDuplicates(ok);
  issues.push(...dupes);
  const superseded = new Set(dupes.map((d) => d.row));
  const kept = ok.filter((o) => !superseded.has(o.row));

  const [proc] = await db.execute<RowDataPacket[]>("SELECT id FROM process_master WHERE process_name = 'Bla Bli Blu' AND active_status = 1 LIMIT 1");
  const processId = proc[0]?.id ? String(proc[0].id) : null;
  const existingIds = new Set<string>();
  const before = new Map<string, number>();
  if (processId && kept.length) {
    const ids = [...new Set(kept.map((k) => k.orderId))];
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const [e] = await db.execute<RowDataPacket[]>(
        `SELECT order_id FROM ${SALES} WHERE process_id = ? AND order_id IN (${part.map(() => "?").join(",")})`, [processId, ...part]);
      for (const x of e) existingIds.add(String(x.order_id));
    }
    const dates = [...new Set(kept.map((k) => k.reportDate))];
    const [c] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS d, COUNT(*) AS c FROM ${SALES}
        WHERE process_id = ? AND report_date IN (${dates.map(() => "?").join(",")}) GROUP BY d`, [processId, ...dates]);
    for (const x of c) before.set(String(x.d), n(x.c));
  }
  const dates = planDateCorrections(kept, before, existingIds);
  const rejectedRows = new Set(issues.filter((i) => i.severity === "reject").map((i) => i.row)).size;
  return {
    batchId, processConfigured: !!processId,
    ...uploadSummary(rows.length, rows.length - rejectedRows, rejectedRows),
    duplicateInFile: dupes.length,
    updatedOrders: dates.reduce((s, d) => s + d.updatedCount, 0),
    newOrders: dates.reduce((s, d) => s + d.insertedCount, 0),
    reasons: groupRejectsByReason(issues),
    sampleRejects: issues.filter((i) => i.severity === "reject").slice(0, 20),
    dates,
  };
}
