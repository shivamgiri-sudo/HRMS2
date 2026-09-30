import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { NC_WINDOW_DAYS, keyOf, normalizeNumber10, planReceived, type IncomingRow } from "./received-rules.js";

/**
 * BBB upload control (Today_Only_Data_Upload_Logic_Requirement): ingest Received Data with one row per date +
 * number and a derived Fresh/NC status, and let a user remove a wrong upload as a whole batch.
 *
 * A trashed row keeps its data and carries live_key = its own id; live rows have live_key = 0. Every reader
 * filters live_key = 0, so trashing is instant and restorable.
 */

const RECEIVED = "bla_dash_received";
const SALES = "bla_bli_blu_overall_sales_raw";
const HISTORY = "bla_bli_blu_overall_sales_history";
const UPLOAD_LOCK = "bbb_received_upload";
const CHUNK = 500;

export interface IngestResult {
  batchId: string; totalRows: number; inserted: number;
  duplicateSameDay: number; noNumber: number; noDate: number;
  fresh: number; nc: number; dateFrom: string | null; dateTo: string | null;
  /** Row indexes (into the input) that were not stored, for callers that report per row. */
  duplicateIndexes: number[]; noNumberIndexes: number[]; noDateIndexes: number[];
}

const pad = (n: number) => String(n).padStart(2, "0");
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/**
 * Re-derive Fresh / NC for every live row dated from..to: NC when the same number has a live row in the previous
 * 1-3 days, else Fresh. One statement, so an upload, a trash and a restore all leave the statuses consistent.
 * Mirrors classify() in received-rules.ts.
 */
export async function reclassifyReceived(from: string, to: string, run: (sql: string, params: unknown[]) => Promise<unknown> = (s, p) => db.execute(s, p as never[])): Promise<void> {
  await run(
    `UPDATE ${RECEIVED} r
       LEFT JOIN (SELECT DISTINCT a.id
                    FROM ${RECEIVED} a
                    JOIN ${RECEIVED} p
                      ON p.phone = a.phone AND p.live_key = 0
                     AND p.report_date < a.report_date
                     AND p.report_date >= DATE_SUB(a.report_date, INTERVAL ${NC_WINDOW_DAYS} DAY)
                   WHERE a.live_key = 0 AND a.report_date BETWEEN ? AND ?) x ON x.id = r.id
        SET r.data_type = IF(x.id IS NULL, 'Fresh', 'NC')
      WHERE r.live_key = 0 AND r.report_date BETWEEN ? AND ? AND r.phone IS NOT NULL AND r.phone <> ''`,
    [from, to, from, to],
  );
}

async function existingKeys(dates: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let i = 0; i < dates.length; i += 200) {
    const part = dates.slice(i, i + 200);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS d, phone FROM ${RECEIVED}
        WHERE live_key = 0 AND report_date IN (${part.map(() => "?").join(",")})`, part);
    for (const r of rows) { const p = normalizeNumber10(r.phone); if (p) keys.add(keyOf(String(r.d), p)); }
  }
  return keys;
}

/** Store one uploaded file of Received Data as a batch, applying the uniqueness and Fresh/NC rules. */
export async function ingestReceived(rows: IncomingRow[], batchId: string, userId: string | null): Promise<IngestResult> {
  const conn = await db.getConnection();
  let locked = false;
  try {
    // One upload at a time: the duplicate check reads then writes, and two files for the same date must not race.
    const [lk] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, 60) AS ok", [UPLOAD_LOCK]);
    locked = Number(lk[0]?.ok) === 1;
    if (!locked) throw new Error("Another Received Data upload is still being processed. Try again in a minute.");

    const dates = [...new Set(rows.map((r) => r.date).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    const plan = planReceived(rows, await existingKeys(dates));

    if (plan.insert.length) {
      await conn.beginTransaction();
      try {
        for (let i = 0; i < plan.insert.length; i += CHUNK) {
          const part = plan.insert.slice(i, i + CHUNK);
          await conn.query(
            `INSERT INTO ${RECEIVED}
               (upload_batch_id, report_date, lob, data_type, source_data_type, workable, call_answer, same_day_attempt,
                final_dispo, emp_id, emp_name, phone, created_by)
             VALUES ${part.map(() => "(?,?,?,'Fresh',?,?,?,?,?,?,?,?,?)").join(",")}`,
            part.flatMap((r) => [batchId, r.date, r.lob ?? null, r.sourceDataType ?? null, r.workable ?? null, r.callAnswer ?? null,
              Math.max(0, Math.round(r.sameDayAttempt ?? 0)), r.finalDispo ?? null, r.empId ?? null, r.empName ?? null, r.phone, userId]),
          );
        }
        await conn.commit();
      } catch (e) { await conn.rollback(); throw e; }
      const insertedDates = plan.insert.map((r) => r.date).sort();
      // A new row can turn rows on the following 3 days into NC (a file for an earlier date uploaded late).
      await reclassifyReceived(insertedDates[0], addDays(insertedDates[insertedDates.length - 1], NC_WINDOW_DAYS), (s, p) => conn.query(s, p as never[]));
    }

    const [st] = await conn.query<RowDataPacket[]>(
      `SELECT data_type, COUNT(*) AS n FROM ${RECEIVED} WHERE upload_batch_id = ? AND live_key = 0 GROUP BY data_type`, [batchId]);
    const count = (t: string) => Number(st.find((r) => r.data_type === t)?.n ?? 0);
    const ins = plan.insert.map((r) => r.date).sort();
    return {
      batchId, totalRows: rows.length, inserted: plan.insert.length,
      duplicateSameDay: plan.duplicateSameDay.length, noNumber: plan.noNumber.length, noDate: plan.noDate.length,
      fresh: count("Fresh"), nc: count("NC"), dateFrom: ins[0] ?? null, dateTo: ins[ins.length - 1] ?? null,
      duplicateIndexes: plan.duplicateSameDay, noNumberIndexes: plan.noNumber, noDateIndexes: plan.noDate,
    };
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [UPLOAD_LOCK]).catch(() => undefined);
    conn.release();
  }
}

export const newBatchId = (): string => randomUUID();

async function receivedRange(batchId: string): Promise<{ from: string; to: string } | null> {
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(MIN(report_date),'%Y-%m-%d') AS f, DATE_FORMAT(MAX(report_date),'%Y-%m-%d') AS t FROM ${RECEIVED} WHERE upload_batch_id = ?`, [batchId]);
  return r[0]?.f ? { from: String(r[0].f), to: String(r[0].t) } : null;
}

/** Move every live row of a batch to the trash. Returns how many rows were removed. */
export async function trashReceivedBatch(batchId: string, userId: string | null): Promise<{ batchId: string; trashed: number }> {
  const range = await receivedRange(batchId);
  if (!range) throw new Error("That upload was not found.");
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE ${RECEIVED} SET live_key = id, deleted_at = NOW(), deleted_by = ? WHERE upload_batch_id = ? AND live_key = 0`, [userId, batchId]);
  if (res.affectedRows) await reclassifyReceived(range.from, addDays(range.to, NC_WINDOW_DAYS));
  return { batchId, trashed: res.affectedRows };
}

/**
 * Bring a trashed batch back. A row whose date + number has since been uploaded again stays in the trash (the rule
 * allows only one per day), and so do rows the de-duplication already removed.
 */
export async function restoreReceivedBatch(batchId: string): Promise<{ batchId: string; restored: number; keptInTrash: number }> {
  const range = await receivedRange(batchId);
  if (!range) throw new Error("That upload was not found.");
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE ${RECEIVED} r
       JOIN (SELECT MAX(id) AS id FROM ${RECEIVED}
              WHERE upload_batch_id = ? AND live_key <> 0 AND COALESCE(deleted_by,'') <> 'migration-1961-duplicate'
              GROUP BY report_date, phone) pick ON pick.id = r.id
       LEFT JOIN ${RECEIVED} live ON live.report_date = r.report_date AND live.phone = r.phone AND live.live_key = 0
        SET r.live_key = 0, r.deleted_at = NULL, r.deleted_by = NULL
      WHERE live.id IS NULL`, [batchId]);
  if (res.affectedRows) await reclassifyReceived(range.from, addDays(range.to, NC_WINDOW_DAYS));
  const [left] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${RECEIVED} WHERE upload_batch_id = ? AND live_key <> 0`, [batchId]);
  return { batchId, restored: res.affectedRows, keptInTrash: Number(left[0]?.n ?? 0) };
}

export interface UploadBatch {
  batchId: string; kind: "received" | "sales"; uploadedAt: string | null; uploadedBy: string | null;
  liveRows: number; trashedRows: number; dateFrom: string | null; dateTo: string | null; trashedAt: string | null;
}

export async function listUploadBatches(): Promise<{ received: UploadBatch[]; sales: UploadBatch[] }> {
  const [rec] = await db.execute<RowDataPacket[]>(
    `SELECT b.*, COALESCE(e.full_name, b.by_user) AS by_name FROM (
       SELECT upload_batch_id AS batch, MIN(created_at) AS at, MAX(created_by) AS by_user,
              SUM(live_key = 0) AS live_rows, SUM(live_key <> 0) AS trashed_rows,
              DATE_FORMAT(MIN(report_date),'%Y-%m-%d') AS f, DATE_FORMAT(MAX(report_date),'%Y-%m-%d') AS t, MAX(deleted_at) AS trashed_at
         FROM ${RECEIVED} GROUP BY upload_batch_id ORDER BY at DESC LIMIT 60) b
     LEFT JOIN employees e ON e.user_id = b.by_user`);
  const [sal] = await db.execute<RowDataPacket[]>(
    `SELECT b.*, COALESCE(e.full_name, b.by_user) AS by_name FROM (
       SELECT source_reference AS batch, MAX(updated_at) AS at, MAX(created_by) AS by_user, COUNT(*) AS live_rows,
              DATE_FORMAT(MIN(report_date),'%Y-%m-%d') AS f, DATE_FORMAT(MAX(report_date),'%Y-%m-%d') AS t
         FROM ${SALES} WHERE source_reference IS NOT NULL GROUP BY source_reference ORDER BY at DESC LIMIT 60) b
     LEFT JOIN employees e ON e.user_id = b.by_user`);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const map = (kind: "received" | "sales") => (r: RowDataPacket): UploadBatch => ({
    batchId: String(r.batch), kind, uploadedAt: iso(r.at), uploadedBy: r.by_name ? String(r.by_name) : null,
    liveRows: Number(r.live_rows ?? 0), trashedRows: Number(r.trashed_rows ?? 0), dateFrom: r.f ?? null, dateTo: r.t ?? null, trashedAt: iso(r.trashed_at),
  });
  return { received: rec.map(map("received")), sales: sal.map(map("sales")) };
}

/** Columns of the sales master that an upload sets; the only ones a history snapshot may write back. */
export const SALES_COLUMNS = [
  "report_date", "week_label", "emp_code", "emp_name", "customer_number", "alternate_number", "payment_status", "amount", "campaign",
  "calling_status", "discount_code", "item_count", "current_status", "lineitem_sku", "new_sold_line_item", "new_sold_line_item_category",
  "lead_line_item", "source_channel", "business_type", "order_creation_time", "call_date_time", "call_duration_seconds",
  "call_attempt_count", "source_created_by", "recording_link", "source_reference",
] as const;

/** Before an upload overwrites existing orders, keep their current version. Returns how many were snapshotted. */
export async function snapshotSalesBeforeReplace(processId: string, orderIds: string[], batchId: string, userId: string | null): Promise<number> {
  let n = 0;
  const unique = [...new Set(orderIds)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK);
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO ${HISTORY} (process_id, order_id, action, previous_batch, replaced_by_batch, row_json, created_by)
       SELECT s.process_id, s.order_id, 'replaced', s.source_reference, ?, JSON_OBJECT(${SALES_COLUMNS.map((c) => `'${c}', s.${c}`).join(", ")}), ?
         FROM ${SALES} s
        WHERE s.process_id = ? AND s.order_id IN (${part.map(() => "?").join(",")}) AND COALESCE(s.source_reference,'') <> ?`,
      [batchId, userId, processId, ...part, batchId]);
    n += res.affectedRows;
  }
  return n;
}

/**
 * Remove a wrong sales upload: every order last written by that batch goes back to the version it replaced, or is
 * removed if the batch created it. What was removed is kept in the history table.
 */
export async function deleteSalesBatch(batchId: string, userId: string | null): Promise<{ batchId: string; reverted: number; removed: number }> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, process_id, order_id FROM ${SALES} WHERE source_reference = ? FOR UPDATE`, [batchId]);
    if (!rows.length) { await conn.rollback(); throw new Error("That sales upload was not found, or every order in it has since been replaced by a later upload."); }
    await conn.query(
      `INSERT INTO ${HISTORY} (process_id, order_id, action, previous_batch, replaced_by_batch, row_json, created_by)
       SELECT s.process_id, s.order_id, 'batch_deleted', s.source_reference, NULL, JSON_OBJECT(${SALES_COLUMNS.map((c) => `'${c}', s.${c}`).join(", ")}), ?
         FROM ${SALES} s WHERE s.source_reference = ?`, [userId, batchId]);
    let reverted = 0, removed = 0;
    for (const r of rows) {
      const [prev] = await conn.query<RowDataPacket[]>(
        `SELECT row_json FROM ${HISTORY} WHERE order_id = ? AND process_id <=> ? AND action = 'replaced' AND replaced_by_batch = ? ORDER BY id DESC LIMIT 1`,
        [r.order_id, r.process_id, batchId]);
      if (prev.length) {
        const old = typeof prev[0].row_json === "string" ? JSON.parse(prev[0].row_json) : prev[0].row_json;
        const cols = SALES_COLUMNS.filter((c) => c in old);
        await conn.query(`UPDATE ${SALES} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...cols.map((c) => old[c] ?? null), r.id]);
        reverted++;
      } else {
        await conn.query(`DELETE FROM ${SALES} WHERE id = ?`, [r.id]);
        removed++;
      }
    }
    await conn.commit();
    return { batchId, reverted, removed };
  } catch (e) { await conn.rollback().catch(() => undefined); throw e; } finally { conn.release(); }
}
