import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Bellavita's real Agent Productivity Report (APR) -- writes into the
 * SAME already-live db_masmis.bb_apr table (4,961 real rows, most recent
 * upload 2026-07-02) the separate My Dashboards tool already uses.
 *
 * Live schema confirmed to match this repo's own column set (unlike
 * gnc_sale/gnc_apr, no drift found here). Duration columns are the same
 * fraction-of-a-day decimal TEXT convention as gnc_apr (confirmed via a
 * real live row, id 7495: "0.39538194444444447") -- kept as text, not
 * converted to seconds, for consistency with the 4,961 existing rows.
 * "fhd" is stored as a raw, UNCONVERTED Excel serial string ("45563") in
 * real live data -- also kept as-is, not guessed into a date.
 */

export const BB_APR_HEADERS = [
  "unique_id", "week", "report_date", "emp_name", "noiid", "num_calls_chat", "lob",
  "login_time", "wait_time", "talk_time", "dispo_time", "pause_time", "acht",
  "lunch", "tea", "tea1", "washr", "team_briefing_aux", "net_pause", "avg_dispo",
  "total_break", "actual_login_hrs", "downtime", "login_duration", "logout_time",
  "net_login_hrs", "utilization", "attendance_1", "week_1", "mtd", "team_leader",
  "fhd", "tenure", "tenurity_week", "sub_lob", "unique_count", "attendance_2",
  "capping", "attendance_3",
] as const;

function get(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") {
      return String(data[k]).trim();
    }
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
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  // "D-Mon-YY" (e.g. "1-Sep-26") -- the real APR export's actual date format,
  // confirmed from a real sample row. Neither branch above matches it, which
  // is why every row of a real file failed the required-field check here.
  m = /^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})$/i.exec(v);
  if (m) {
    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const monthKey = m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase();
    const year = parseInt(m[3], 10) < 50 ? `20${m[3]}` : `19${m[3]}`;
    return `${year}-${months[monthKey]}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importBbAprMasmisBatch(
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
  const insertRows: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const empName = get(data, "Emp_Name", "emp_name");
    const reportDate = parseReportDate(get(data, "Date", "report_date"));
    if (!empName || !reportDate) {
      const msg = `Row ${row.row_no}: "emp_name" and "report_date" are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        getOrNull(data, "Unique ID", "unique_id"),
        getOrNull(data, "Week", "week"),
        reportDate,
        empName,
        getOrNull(data, "NOIID", "noiid"),
        parseNullableInt(get(data, "No. of Calls/Chat", "num_calls_chat")),
        getOrNull(data, "LOB", "lob"),
        getOrNull(data, "Login Time", "login_time"),
        getOrNull(data, "WAIT", "wait_time"),
        getOrNull(data, "TALK", "talk_time"),
        getOrNull(data, "DISPO", "dispo_time"),
        getOrNull(data, "PAUSE", "pause_time"),
        parseNullableInt(get(data, "ACHT", "acht")),
        getOrNull(data, "Lunch", "lunch"),
        getOrNull(data, "Tea", "tea"),
        getOrNull(data, "Tea1", "tea1"),
        getOrNull(data, "Washr", "washr"),
        getOrNull(data, "Team Briefing AUX", "team_briefing_aux"),
        getOrNull(data, "net_pause"),
        getOrNull(data, "Avg Dispo", "avg_dispo"),
        getOrNull(data, "Total Break", "total_break"),
        getOrNull(data, "Actual Login Hrs", "actual_login_hrs"),
        getOrNull(data, "Downtime", "downtime"),
        getOrNull(data, "Login", "login_duration"),
        getOrNull(data, "Logout", "logout_time"),
        getOrNull(data, "Net Login Hrs+DN+Briefing", "net_login_hrs"),
        getOrNull(data, "Utilization", "utilization"),
        getOrNull(data, "Attendance", "attendance_1"),
        getOrNull(data, "Week 1", "week_1"),
        getOrNull(data, "MTD", "mtd"),
        getOrNull(data, "Team Leader", "team_leader"),
        getOrNull(data, "FHD", "fhd"),
        parseNullableInt(get(data, "Tenure", "tenure")),
        getOrNull(data, "Tenurity Week", "tenurity_week"),
        getOrNull(data, "Sub Lob", "sub_lob"),
        parseNullableInt(get(data, "Unique Count", "unique_count")),
        getOrNull(data, "Attendence 2", "attendance_2"),
        getOrNull(data, "Capping", "capping"),
        getOrNull(data, "attendance_3"),
        null, // uploaded_by: HRMS user ids are UUIDs, don't fit this int column
        batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.bb_apr
       (unique_id, week, report_date, emp_name, noiid, num_calls_chat, lob, login_time,
        wait_time, talk_time, dispo_time, pause_time, acht, lunch, tea, tea1, washr,
        team_briefing_aux, net_pause, avg_dispo, total_break, actual_login_hrs, downtime,
        login_duration, logout_time, net_login_hrs, utilization, attendance_1, week_1, mtd,
        team_leader, fhd, tenure, tenurity_week, sub_lob, unique_count, attendance_2,
        capping, attendance_3, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'bb_apr', ?, ?, NULL)`,
      [batchId, `HRMS2 upload by ${importedByUserId}`, importedRows],
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
