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
const DAILY = "bla_dash_received_daily";
const BATCHES = "bbb_upload_batch";
const UPLOAD_LOCK = "bbb_received_upload";
const CHUNK = 500;
/** How long a request waits for the heavy follow-up work before answering; the work itself always finishes. */
const BUDGET_MS = 25_000;

/**
 * Wait for `task` up to the budget. Returns true if it finished. The task keeps running either way: on this
 * database re-deriving statuses or summing a month of rows can take minutes, far longer than a request may.
 */
async function withinBudget(task: Promise<void>, ms = BUDGET_MS): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); timer.unref?.(); });
  const finished = await Promise.race([task.then(() => true as const), timeout]);
  if (timer) clearTimeout(timer);
  return finished;
}

/**
 * Rebuild the per-day, per-LOB counts the dashboard reads, for every date from..to. The dashboard must never sum
 * the raw table on a page load (that takes over a minute for a busy month), so this runs when data changes.
 */
export async function refreshDailySummary(from: string, to: string): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM ${DAILY} WHERE report_date BETWEEN ? AND ?`, [from, to]);
    // COALESCE on every SUM: a condition on a column that is NULL for the whole day (no answer-time value, say)
    // makes SUM return NULL, not 0, and the summary columns are NOT NULL.
    await conn.query(
      `INSERT INTO ${DAILY}
         (report_date, lob, fresh_base, fresh_workable, total_workable, dnd, unique_attempt, connected, le30, lt1m, ge1m, total_rows, nc_rows)
       SELECT report_date, lob,
              COALESCE(SUM(data_type = 'Fresh'), 0),
              COALESCE(SUM(data_type = 'Fresh' AND workable = 'Workable'), 0),
              COALESCE(SUM(workable = 'Workable'), 0),
              COALESCE(SUM(workable = 'DND'), 0),
              COALESCE(SUM(same_day_attempt > 0 AND workable = 'Workable'), 0),
              COALESCE(SUM(data_type = 'Fresh' AND final_dispo = 'Connected'), 0),
              COALESCE(SUM(data_type = 'Fresh' AND final_dispo = 'Connected' AND call_answer = 'Less Than 30 Sec'), 0),
              COALESCE(SUM(data_type = 'Fresh' AND final_dispo = 'Connected' AND call_answer = 'Less Than 1 Min'), 0),
              COALESCE(SUM(data_type = 'Fresh' AND final_dispo = 'Connected' AND call_answer IN ('Grater Than 1 Min','Greater Than 1 Min')), 0),
              COUNT(*),
              COALESCE(SUM(data_type <> 'Fresh'), 0)
         FROM ${RECEIVED}
        WHERE live_key = 0 AND report_date BETWEEN ? AND ? AND lob IS NOT NULL
        GROUP BY report_date, lob`, [from, to]);
    await conn.commit();
  } catch (e) { await conn.rollback().catch(() => undefined); throw e; } finally { conn.release(); }
}

async function setBatchState(batchId: string, state: "ready" | "updating" | "failed"): Promise<void> {
  await db.execute(`UPDATE ${BATCHES} SET state = ? WHERE batch_id = ?`, [state, batchId]);
}

/** Statuses, then the summary, for a date range; marks the batch ready (or failed) when done. Never throws. */
function followUp(batchId: string, from: string, to: string): Promise<void> {
  return (async () => {
    try {
      await reclassifyReceived(from, to);
      await refreshDailySummary(from, to);
      await setBatchState(batchId, "ready");
    } catch (e) {
      console.warn(`[bbb-uploads] follow-up for batch ${batchId} failed:`, e instanceof Error ? e.message : e);
      await setBatchState(batchId, "failed").catch(() => undefined);
    }
  })();
}

export interface IngestResult {
  batchId: string; totalRows: number; inserted: number;
  duplicateSameDay: number; noNumber: number; noDate: number;
  fresh: number; nc: number; dateFrom: string | null; dateTo: string | null;
  /** True when Fresh/NC and the dashboard totals are still being updated in the background. */
  pending: boolean;
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
    }

    const ins = plan.insert.map((r) => r.date).sort();
    const from = ins[0] ?? null, to = ins[ins.length - 1] ?? null;
    await conn.query(
      `INSERT INTO ${BATCHES} (batch_id, kind, uploaded_by, live_rows, date_from, date_to, state)
       VALUES (?, 'received', ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE live_rows = VALUES(live_rows), date_from = VALUES(date_from), date_to = VALUES(date_to), state = VALUES(state)`,
      [batchId, userId, plan.insert.length, from, to, plan.insert.length ? "updating" : "ready"]);
    // The upload itself is done; release the lock before the slow follow-up so another file is not kept waiting.
    await conn.query("SELECT RELEASE_LOCK(?)", [UPLOAD_LOCK]).catch(() => undefined);
    locked = false;

    let pending = false, fresh = 0, nc = 0;
    if (from && to) {
      // A new row can turn rows on the following 3 days into NC (a file for an earlier date uploaded late).
      pending = !(await withinBudget(followUp(batchId, from, addDays(to, NC_WINDOW_DAYS))));
      if (!pending) {
        const [st] = await db.execute<RowDataPacket[]>(
          `SELECT data_type, COUNT(*) AS n FROM ${RECEIVED} WHERE upload_batch_id = ? AND live_key = 0 GROUP BY data_type`, [batchId]);
        fresh = Number(st.find((r) => r.data_type === "Fresh")?.n ?? 0);
        nc = Number(st.find((r) => r.data_type === "NC")?.n ?? 0);
      }
    }
    return {
      batchId, totalRows: rows.length, inserted: plan.insert.length,
      duplicateSameDay: plan.duplicateSameDay.length, noNumber: plan.noNumber.length, noDate: plan.noDate.length,
      fresh, nc, dateFrom: from, dateTo: to, pending,
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

async function batchRange(batchId: string): Promise<{ from: string; to: string } | null> {
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(date_from,'%Y-%m-%d') AS f, DATE_FORMAT(date_to,'%Y-%m-%d') AS t FROM ${BATCHES} WHERE batch_id = ? AND kind = 'received'`, [batchId]);
  if (r[0]?.f) return { from: String(r[0].f), to: String(r[0].t) };
  // A batch the registry does not know yet (uploaded before it existed): fall back to the rows themselves.
  return receivedRange(batchId);
}

/**
 * Move every live row of a batch to the trash. For a large batch the rows are moved in the background and
 * `pending` is true; the registry shows it as "updating" until the statuses and totals are consistent again.
 */
export async function trashReceivedBatch(batchId: string, userId: string | null): Promise<{ batchId: string; trashed: number; pending: boolean }> {
  const range = await batchRange(batchId);
  if (!range) throw new Error("That upload was not found.");
  await db.execute(
    `INSERT INTO ${BATCHES} (batch_id, kind, date_from, date_to, state, trashed_at, trashed_by) VALUES (?, 'received', ?, ?, 'updating', NOW(), ?)
     ON DUPLICATE KEY UPDATE state = 'updating', trashed_at = NOW(), trashed_by = VALUES(trashed_by)`, [batchId, range.from, range.to, userId]);
  let trashed = 0;
  const work = (async () => {
    try {
      const [res] = await db.execute<ResultSetHeader>(
        `UPDATE ${RECEIVED} SET live_key = id, deleted_at = NOW(), deleted_by = ? WHERE upload_batch_id = ? AND live_key = 0`, [userId, batchId]);
      trashed = res.affectedRows;
      await db.execute(`UPDATE ${BATCHES} SET trashed_rows = trashed_rows + ?, live_rows = 0 WHERE batch_id = ?`, [trashed, batchId]);
      await followUp(batchId, range.from, addDays(range.to, NC_WINDOW_DAYS));
    } catch (e) {
      console.warn(`[bbb-uploads] trash of batch ${batchId} failed:`, e instanceof Error ? e.message : e);
      await setBatchState(batchId, "failed").catch(() => undefined);
    }
  })();
  const pending = !(await withinBudget(work));
  return { batchId, trashed, pending };
}

/**
 * Bring a trashed batch back. A row whose date + number has since been uploaded again stays in the trash (the rule
 * allows only one per day), and so do rows the de-duplication already removed.
 */
export async function restoreReceivedBatch(batchId: string): Promise<{ batchId: string; restored: number; keptInTrash: number; pending: boolean }> {
  const range = await batchRange(batchId);
  if (!range) throw new Error("That upload was not found.");
  await db.execute(`UPDATE ${BATCHES} SET state = 'updating' WHERE batch_id = ?`, [batchId]);
  let restored = 0, keptInTrash = 0;
  const work = (async () => {
    try {
      const [res] = await db.execute<ResultSetHeader>(
        `UPDATE ${RECEIVED} r
           JOIN (SELECT MAX(id) AS id FROM ${RECEIVED}
                  WHERE upload_batch_id = ? AND live_key <> 0 AND COALESCE(deleted_by,'') <> 'migration-1961-duplicate'
                  GROUP BY report_date, phone) pick ON pick.id = r.id
           LEFT JOIN ${RECEIVED} live ON live.report_date = r.report_date AND live.phone = r.phone AND live.live_key = 0
            SET r.live_key = 0, r.deleted_at = NULL, r.deleted_by = NULL
          WHERE live.id IS NULL`, [batchId]);
      restored = res.affectedRows;
      const [left] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${RECEIVED} WHERE upload_batch_id = ? AND live_key <> 0`, [batchId]);
      keptInTrash = Number(left[0]?.n ?? 0);
      await db.execute(
        `UPDATE ${BATCHES} SET live_rows = ?, trashed_rows = ?, trashed_at = IF(? > 0, NULL, trashed_at), trashed_by = IF(? > 0, NULL, trashed_by) WHERE batch_id = ?`,
        [restored, keptInTrash, restored, restored, batchId]);
      await followUp(batchId, range.from, addDays(range.to, NC_WINDOW_DAYS));
    } catch (e) {
      console.warn(`[bbb-uploads] restore of batch ${batchId} failed:`, e instanceof Error ? e.message : e);
      await setBatchState(batchId, "failed").catch(() => undefined);
    }
  })();
  const pending = !(await withinBudget(work));
  return { batchId, restored, keptInTrash, pending };
}

export interface UploadBatch {
  batchId: string; kind: "received" | "sales"; uploadedAt: string | null; uploadedBy: string | null;
  liveRows: number; trashedRows: number; dateFrom: string | null; dateTo: string | null; trashedAt: string | null;
  /** ready | updating | failed: whether Fresh/NC and the dashboard totals already reflect this batch. */
  state: string;
}

export async function listUploadBatches(): Promise<{ received: UploadBatch[]; sales: UploadBatch[] }> {
  // From the registry, never from the rows: grouping 126k rows by batch takes ~45 s on this database.
  const [rec] = await db.execute<RowDataPacket[]>(
    `SELECT b.batch_id AS batch, b.uploaded_at AS at, COALESCE(e.full_name, b.uploaded_by) AS by_name, b.live_rows, b.trashed_rows,
            DATE_FORMAT(b.date_from,'%Y-%m-%d') AS f, DATE_FORMAT(b.date_to,'%Y-%m-%d') AS t, b.trashed_at, b.state
       FROM ${BATCHES} b LEFT JOIN employees e ON e.user_id = b.uploaded_by
      WHERE b.kind = 'received' ORDER BY b.uploaded_at DESC LIMIT 60`);
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
    state: r.state ? String(r.state) : "ready",
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

/**
 * One-time catch-up for data uploaded before the read model existed: register each batch and build the daily
 * summary, one month at a time. Runs in the background after startup (never during it), under a lock so two
 * servers do not both do it. Safe to call repeatedly: it only fills what is missing.
 */
export async function backfillBbbReadModel(): Promise<{ batches: number; months: number }> {
  const conn = await db.getConnection();
  let locked = false, batches = 0, months = 0;
  try {
    const [lk] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK('bbb_read_model_backfill', 0) AS ok");
    locked = Number(lk[0]?.ok) === 1;
    if (!locked) return { batches, months };

    const [known] = await db.execute<RowDataPacket[]>(`SELECT batch_id FROM ${BATCHES} WHERE kind = 'received'`);
    const have = new Set(known.map((r) => String(r.batch_id)));
    const [ids] = await db.execute<RowDataPacket[]>(`SELECT DISTINCT upload_batch_id AS b FROM ${RECEIVED}`);
    for (const r of ids) {
      const id = String(r.b);
      if (have.has(id)) continue;
      const [a] = await db.execute<RowDataPacket[]>(
        `SELECT MIN(created_at) AS at, MAX(created_by) AS by_user, SUM(live_key = 0) AS live_rows, SUM(live_key <> 0) AS trashed_rows,
                MIN(report_date) AS f, MAX(report_date) AS t
           FROM ${RECEIVED} WHERE upload_batch_id = ?`, [id]);
      const x = a[0];
      if (!x?.f) continue;
      await db.execute(
        `INSERT IGNORE INTO ${BATCHES} (batch_id, kind, uploaded_by, uploaded_at, live_rows, trashed_rows, date_from, date_to, state)
         VALUES (?, 'received', ?, ?, ?, ?, ?, ?, 'ready')`,
        [id, x.by_user ?? null, x.at ?? new Date(), Number(x.live_rows ?? 0), Number(x.trashed_rows ?? 0), x.f, x.t]);
      batches++;
    }

    const [ms] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT DATE_FORMAT(r.report_date,'%Y-%m-01') AS m FROM ${RECEIVED} r
        WHERE r.live_key = 0 AND NOT EXISTS (SELECT 1 FROM ${DAILY} d WHERE d.report_date = r.report_date)`);
    for (const r of ms) {
      const first = String(r.m); const [y, mo] = first.split("-").map(Number);
      const last = `${y}-${pad(mo)}-${pad(new Date(y, mo, 0).getDate())}`;
      await refreshDailySummary(first, last);
      months++;
    }
    return { batches, months };
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK('bbb_read_model_backfill')").catch(() => undefined);
    conn.release();
  }
}

// Well clear of startup: a slow boot (pending migrations on a busy database) can itself take several minutes, and
// this catch-up must never compete with it.
const BACKFILL_DELAY_MS = 15 * 60_000;
if (!process.env.VITEST && process.env.NODE_ENV !== "test" && process.env.BBB_READ_MODEL_BACKFILL !== "false") {
  setTimeout(() => {
    backfillBbbReadModel()
      .then((r) => { if (r.batches || r.months) console.log(`[bbb-uploads] read model backfilled: ${r.batches} batch(es), ${r.months} month(s)`); })
      .catch((e) => console.warn("[bbb-uploads] read model backfill failed:", e instanceof Error ? e.message : e));
  }, BACKFILL_DELAY_MS).unref();
}

