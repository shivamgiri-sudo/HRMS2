import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * GNC's daily Agent Productivity Report (APR) — writes into db_masmis.gnc_apr,
 * the same live table My Dashboards already uses (confirmed real rows, stale
 * since 2026-05-30 until this uploader is used). No dedup key — insert-only
 * like every other My Dashboards table; revert by deleting the batch via
 * upload_log.
 *
 * Column lookup is intentionally flexible: the real file can use "USER" or
 * "user_name" / "User Name" depending on who exported it.
 */

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
function getOrNull(data: Record<string, unknown>, ...keys: string[]): string | null {
  const v = get(data, ...keys);
  return v || null;
}
function parseNullableInt(v: string): number | null {
  const n = parseInt(v.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function parseReportDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  // Excel serial (e.g. 46266)
  if (/^\d{5}$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importGncAprMasmisBatch(
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
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    // Accept both template column name ("USER", "Date") and legacy lowercase variants
    const userName = get(data, "USER", "user_name", "User Name");
    const reportDate = parseReportDate(get(data, "Date", "report_date"));
    if (!userName || !reportDate) {
      const msg = `Row ${row.row_no}: "USER" (agent name) and "Date" (report date) are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    // UID: if not supplied, synthesise from emp_id + date serial (matches existing rows)
    const empId = getOrNull(data, "ID", "emp_id");
    const rawDate = get(data, "Date", "report_date");
    const syntheticUid = empId
      ? `${empId}${rawDate}`
      : null;
    const uid = getOrNull(data, "UID", "uid") ?? syntheticUid;

    try {
      await db.execute(
        `INSERT INTO db_masmis.gnc_apr
           (uid, report_date, user_name, emp_id, tl_name, calls, process_type,
            login_time, wait_time, talk_time, dispo_time, pause_time, login_duration,
            logout_time, acht, aoc, bio, bre, briefing, down_time, lunch, meet, qa, sb,
            tea_break, training_break, wash, net_login, break_time, tra_qa, downtime,
            atten, capping, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uid,
          reportDate,
          userName,
          empId,
          getOrNull(data, "TL Name", "tl_name"),
          parseNullableInt(get(data, "CALLS", "calls")),
          getOrNull(data, "Process Type", "process_type"),
          getOrNull(data, "Login Time", "login_time"),
          getOrNull(data, "WAIT", "wait_time"),
          getOrNull(data, "TALK", "talk_time"),
          getOrNull(data, "DISPO", "dispo_time"),
          getOrNull(data, "PAUSE", "pause_time"),
          getOrNull(data, "Login", "login_duration"),
          getOrNull(data, "Logout", "logout_time"),
          parseNullableInt(get(data, "ACHT", "acht")),
          getOrNull(data, "AOC", "aoc"),
          getOrNull(data, "BIO", "bio"),
          getOrNull(data, "Bre", "bre"),
          getOrNull(data, "Briefing", "briefing"),
          getOrNull(data, "DOWN", "down_time"),
          getOrNull(data, "Lunch", "lunch"),
          getOrNull(data, "Meet", "meet"),
          getOrNull(data, "QA", "qa"),
          getOrNull(data, "SB", "sb"),
          getOrNull(data, "Tea break", "tea_break"),
          getOrNull(data, "Training break", "training_break"),
          getOrNull(data, "Wash", "wash"),
          getOrNull(data, "Net Login", "net_login"),
          getOrNull(data, "Break", "break_time"),
          getOrNull(data, "TRA+QA", "tra_qa"),
          getOrNull(data, "Downtime", "downtime"),
          parseNullableInt(get(data, "Atten", "atten")),
          getOrNull(data, "Capping", "capping"),
          null, // uploaded_by: HRMS user IDs are UUIDs, gnc_apr.uploaded_by is int
          batchId,
        ] as never[],
      );
      importedRows++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${row.row_no}: ${msg}`);
      errorUpdates.push({ rowId: row.id, message: msg.slice(0, 500) });
      errorRows++;
    }
  }

  if (importedRows > 0) {
    try {
      await db.execute(
        `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
         VALUES (?, 'gnc_apr', ?, ?, NULL)`,
        [batchId, `HRMS2 upload by ${importedByUserId}`, importedRows],
      );
    } catch {
      // upload_log is audit-only; swallow so a missing row doesn't fail an otherwise clean import
    }
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

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";

  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
