import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  parseFlexibleSheet, normalizeDate, normalizeNumber, normalizeText, type FieldSpec,
} from "../housing-dashboards/flexible-parser.js";
import { buildDashboard, type ReceivedAgg, type SalesAgg, type TargetCfg } from "./bla-metrics.js";
import { ingestReceived, newBatchId } from "./bbb-uploads.service.js";

/** Received Data headers of BLA_BLI_BLU_Dashboard_Calculation. "CON" appears twice; the first is used. */
const RECEIVED_FIELDS: FieldSpec[] = [
  { key: "date", aliases: ["Date"] },
  { key: "phone", aliases: ["Phone", "Mobile", "Mobile Number", "Customer Number", "Customer Mobile", "Customer/Mobile Number"] },
  { key: "lob", aliases: ["LOB"] },
  { key: "dataType", aliases: ["Data Type", "Data_Type"] },
  { key: "workable", aliases: ["Workable"] },
  { key: "callAnswer", aliases: ["Call Answer With in Same Day", "Call Answer Within Same Day"] },
  { key: "sameDayAttempt", aliases: ["Same Day Attempt"] },
  { key: "finalDispo", aliases: ["Final Dispo"] },
  { key: "empId", aliases: ["Emp Id", "Emp ID", "EMP_ID"] },
  { key: "empName", aliases: ["Emp Name", "Emp_Name"] },
];

/**
 * Received Data upload. One row per date + mobile number: a number already stored for that date is skipped as a
 * duplicate, the same number on another date is a new row, and Fresh / NC is derived from the previous 1-3 days
 * (see received-rules.ts). Each file is one batch that can be trashed and restored.
 */
export async function uploadReceivedData(buffer: Buffer, userId: string) {
  const parsed = parseFlexibleSheet(buffer, RECEIVED_FIELDS, []);
  const batchId = newBatchId();
  const result = await ingestReceived(
    parsed.rows.map((r) => ({
      date: normalizeDate(r.date), phone: r.phone, lob: normalizeText(r.lob), sourceDataType: normalizeText(r.dataType),
      workable: normalizeText(r.workable), callAnswer: normalizeText(r.callAnswer), sameDayAttempt: normalizeNumber(r.sameDayAttempt) ?? 0,
      finalDispo: normalizeText(r.finalDispo), empId: normalizeText(r.empId), empName: normalizeText(r.empName),
    })),
    batchId, userId,
  );
  return {
    batchId, fileType: "received_data", totalRows: parsed.totalRows, validRows: parsed.validRows,
    storedRows: result.inserted, duplicateSameDay: result.duplicateSameDay, skippedNoNumber: result.noNumber, skippedNoDate: result.noDate,
    fresh: result.fresh, nc: result.nc, pending: result.pending, datesReplaced: 0, dateFrom: result.dateFrom, dateTo: result.dateTo,
    recognizedColumns: parsed.recognizedColumns, additionalColumns: parsed.additionalColumns,
    missingOptionalColumns: parsed.missingOptionalColumns, preview: parsed.previewRaw,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function resolveRange(from?: string, to?: string): { from: string; to: string } {
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to)) return from <= to ? { from, to } : { from: to, to: from };
  const now = new Date();
  const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, "0")}` };
}

const n = (v: unknown) => Number(v ?? 0);

export async function getTargets(): Promise<TargetCfg[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT lob, required_per_day, cap_pct, conversion_target, prepaid_target, rto_target, target_aov FROM bla_dash_target ORDER BY lob");
  return rows.map((r) => ({
    lob: String(r.lob), requiredPerDay: n(r.required_per_day), capPct: n(r.cap_pct), conversionTarget: n(r.conversion_target),
    prepaidTarget: n(r.prepaid_target), rtoTarget: n(r.rto_target), targetAov: n(r.target_aov),
  }));
}

export async function saveTarget(t: TargetCfg, userId: string) {
  await db.execute(
    `INSERT INTO bla_dash_target (lob, required_per_day, cap_pct, conversion_target, prepaid_target, rto_target, target_aov, updated_by)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE required_per_day=VALUES(required_per_day), cap_pct=VALUES(cap_pct), conversion_target=VALUES(conversion_target),
       prepaid_target=VALUES(prepaid_target), rto_target=VALUES(rto_target), target_aov=VALUES(target_aov), updated_by=VALUES(updated_by)`,
    [t.lob, t.requiredPerDay, t.capPct, t.conversionTarget, t.prepaidTarget, t.rtoTarget, t.targetAov, userId]);
}

/** Formula Demo rows 7-15: every count is a COUNTIFS on Date + LOB (+ filters). Bucket labels keep the source's "Grater" typo, matched loosely. */
async function loadReceived(from: string, to: string): Promise<ReceivedAgg[]> {
  // Read from the daily summary, not the raw rows: summing a month of bla_dash_received takes over a minute on the
  // production database. bbb-uploads.service.ts keeps the summary in step with uploads, trash and restore.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS d, lob, fresh_base, fresh_workable, total_workable, dnd,
            unique_attempt, connected, le30, lt1m, ge1m
       FROM bla_dash_received_daily WHERE report_date BETWEEN ? AND ?`, [from, to]);
  return rows.map((r) => ({
    date: String(r.d), lob: String(r.lob), freshBase: n(r.fresh_base), freshWorkable: n(r.fresh_workable), totalWorkable: n(r.total_workable),
    dnd: n(r.dnd), uniqueAttempt: n(r.unique_attempt), connected: n(r.connected), le30: n(r.le30), lt1m: n(r.lt1m), ge1m: n(r.ge1m),
  }));
}

/**
 * Formula Demo rows 16-21. Reads the existing Overall Sales table (bulk-uploaded, sql/1729): Real Time Sale =
 * row count of Business='Real Time Sales' for that Campaign/day.
 */
async function loadSales(from: string, to: string): Promise<SalesAgg[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS d, campaign,
       SUM(business_type='Real Time Sales') AS rts,
       SUM(business_type='Real Time Sales' AND payment_status='Paid') AS prepaid,
       SUM(business_type='Real Time Sales' AND current_status='RTO') AS rto,
       SUM(CASE WHEN business_type='Real Time Sales' THEN COALESCE(amount,0) ELSE 0 END) AS revenue,
       SUM(business_type='Same Day PTP') AS ptp,
       SUM(business_type='24 Hrs Sale') AS h24
     FROM bla_bli_blu_overall_sales_raw WHERE report_date BETWEEN ? AND ? AND campaign IS NOT NULL GROUP BY d, campaign`, [from, to]);
  return rows.map((r) => ({
    date: String(r.d), campaign: String(r.campaign), realTimeSale: n(r.rts), prepaid: n(r.prepaid), rto: n(r.rto),
    revenue: n(r.revenue), ptp: n(r.ptp), h24: n(r.h24),
  }));
}

/** Newest day that has either sales or received data, so the page can open on real data instead of an empty current month. */
async function latestDataDate(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(GREATEST(COALESCE((SELECT MAX(report_date) FROM bla_bli_blu_overall_sales_raw), '1000-01-01'),
                                 COALESCE((SELECT MAX(report_date) FROM bla_dash_received_daily), '1000-01-01')), '%Y-%m-%d') AS d`);
  const d = rows[0]?.d ? String(rows[0].d) : null;
  return d && d > "1000-01-01" ? d : null;
}

export async function getDashboard(fromRaw?: string, toRaw?: string) {
  const { from, to } = resolveRange(fromRaw, toRaw);
  const [received, sales, targets, latest] = await Promise.all([loadReceived(from, to), loadSales(from, to), getTargets(), latestDataDate()]);
  return { from, to, latestDataDate: latest, ...buildDashboard(received, sales, targets) };
}

/** "Product Wise Sales": SUMIFS of Count by category, split by Campaign and Payment status. */
export async function getProductWise(fromRaw?: string, toRaw?: string) {
  const { from, to } = resolveRange(fromRaw, toRaw);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT new_sold_line_item_category AS category,
       SUM(CASE WHEN campaign='Cart ABC' THEN COALESCE(item_count,1) ELSE 0 END) AS cart_abc,
       SUM(CASE WHEN campaign='Inbound' THEN COALESCE(item_count,1) ELSE 0 END) AS inbound,
       SUM(CASE WHEN campaign='Upgrade' THEN COALESCE(item_count,1) ELSE 0 END) AS upgrade_qty,
       SUM(COALESCE(item_count,1)) AS total,
       SUM(CASE WHEN payment_status='Paid' THEN COALESCE(item_count,1) ELSE 0 END) AS paid,
       SUM(CASE WHEN payment_status='COD' THEN COALESCE(item_count,1) ELSE 0 END) AS cod
     FROM bla_bli_blu_overall_sales_raw WHERE report_date BETWEEN ? AND ? AND new_sold_line_item_category IS NOT NULL GROUP BY new_sold_line_item_category ORDER BY total DESC`, [from, to]);
  const grand = rows.reduce((s, r) => s + n(r.total), 0);
  return {
    from, to, grandTotal: grand,
    products: rows.map((r) => ({
      product: String(r.category), cartAbc: n(r.cart_abc), inbound: n(r.inbound), upgrade: n(r.upgrade_qty),
      other: Math.max(0, n(r.total) - n(r.cart_abc) - n(r.inbound) - n(r.upgrade_qty)),
      total: n(r.total), contributionPct: grand > 0 ? n(r.total) / grand : 0, paid: n(r.paid), cod: n(r.cod),
    })),
  };
}
