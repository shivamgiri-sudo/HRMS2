import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  parseFlexibleSheet, normalizeDate, normalizeNumber, normalizeText, type FieldSpec,
} from "../housing-dashboards/flexible-parser.js";
import { buildDashboard, type ReceivedAgg, type SalesAgg, type TargetCfg } from "./bla-metrics.js";

/** Received Data headers of BLA_BLI_BLU_Dashboard_Calculation. "CON" appears twice; the first is used. */
const RECEIVED_FIELDS: FieldSpec[] = [
  { key: "date", aliases: ["Date"] },
  { key: "phone", aliases: ["Phone"] },
  { key: "lob", aliases: ["LOB"] },
  { key: "dataType", aliases: ["Data Type", "Data_Type"] },
  { key: "workable", aliases: ["Workable"] },
  { key: "callAnswer", aliases: ["Call Answer With in Same Day", "Call Answer Within Same Day"] },
  { key: "sameDayAttempt", aliases: ["Same Day Attempt"] },
  { key: "finalDispo", aliases: ["Final Dispo"] },
  { key: "empId", aliases: ["Emp Id", "Emp ID", "EMP_ID"] },
  { key: "empName", aliases: ["Emp Name", "Emp_Name"] },
];

const CHUNK = 500;

async function bulkInsert(
  conn: { execute: (sql: string, params?: unknown[]) => Promise<unknown> },
  table: string, cols: string[], rows: unknown[][],
) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const ph = `(${cols.map(() => "?").join(",")})`;
    await conn.execute(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${part.map(() => ph).join(",")}`, part.flat());
  }
}

/** Re-uploading a date replaces that date's rows (never doubles them). Only dates present in the file are touched. */
async function replaceDates(table: string, cols: string[], rows: unknown[][], dates: string[]) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (dates.length) await conn.execute(`DELETE FROM ${table} WHERE report_date IN (${dates.map(() => "?").join(",")})`, dates);
    await bulkInsert(conn, table, cols, rows);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

function summary(batchId: string, fileType: string, parsed: ReturnType<typeof parseFlexibleSheet>, stored: number, skipped: number, dates: string[]) {
  return {
    batchId, fileType, totalRows: parsed.totalRows, validRows: parsed.validRows, duplicateRows: parsed.duplicateRows,
    storedRows: stored, skippedNoDate: skipped, datesReplaced: dates.length,
    dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null,
    recognizedColumns: parsed.recognizedColumns, additionalColumns: parsed.additionalColumns,
    missingOptionalColumns: parsed.missingOptionalColumns, preview: parsed.previewRaw,
  };
}

export async function uploadReceivedData(buffer: Buffer, userId: string) {
  const parsed = parseFlexibleSheet(buffer, RECEIVED_FIELDS, []);
  const batchId = randomUUID();
  const rows: unknown[][] = [];
  let skipped = 0;
  for (const r of parsed.rows) {
    const date = normalizeDate(r.date);
    if (!date) { skipped++; continue; }
    rows.push([
      batchId, date, normalizeText(r.lob), normalizeText(r.dataType), normalizeText(r.workable), normalizeText(r.callAnswer),
      Math.max(0, Math.round(normalizeNumber(r.sameDayAttempt) ?? 0)), normalizeText(r.finalDispo),
      normalizeText(r.empId), normalizeText(r.empName), normalizeText(r.phone), userId,
    ]);
  }
  const dates = [...new Set(rows.map((r) => r[1] as string))].sort();
  await replaceDates("bla_dash_received",
    ["upload_batch_id", "report_date", "lob", "data_type", "workable", "call_answer", "same_day_attempt", "final_dispo", "emp_id", "emp_name", "phone", "created_by"],
    rows, dates);
  return summary(batchId, "received_data", parsed, rows.length, skipped, dates);
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
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS d, lob,
       SUM(data_type='Fresh') AS fresh_base,
       SUM(data_type='Fresh' AND workable='Workable') AS fresh_workable,
       SUM(workable='Workable') AS total_workable,
       SUM(workable='DND') AS dnd,
       SUM(same_day_attempt>0 AND workable='Workable') AS unique_attempt,
       SUM(data_type='Fresh' AND final_dispo='Connected') AS connected,
       SUM(data_type='Fresh' AND final_dispo='Connected' AND call_answer='Less Than 30 Sec') AS le30,
       SUM(data_type='Fresh' AND final_dispo='Connected' AND call_answer='Less Than 1 Min') AS lt1m,
       SUM(data_type='Fresh' AND final_dispo='Connected' AND call_answer IN ('Grater Than 1 Min','Greater Than 1 Min')) AS ge1m
     FROM bla_dash_received WHERE report_date BETWEEN ? AND ? AND lob IS NOT NULL GROUP BY d, lob`, [from, to]);
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

export async function getDashboard(fromRaw?: string, toRaw?: string) {
  const { from, to } = resolveRange(fromRaw, toRaw);
  const [received, sales, targets] = await Promise.all([loadReceived(from, to), loadSales(from, to), getTargets()]);
  return { from, to, ...buildDashboard(received, sales, targets) };
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
      total: n(r.total), contributionPct: grand > 0 ? n(r.total) / grand : 0, paid: n(r.paid), cod: n(r.cod),
    })),
  };
}
