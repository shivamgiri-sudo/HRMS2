import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

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
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const empName = get(data, "emp_name");
    const reportDate = parseReportDate(get(data, "report_date"));
    if (!empName || !reportDate) {
      const msg = `Row ${row.row_no}: "emp_name" and "report_date" are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.bb_apr
           (unique_id, week, report_date, emp_name, noiid, num_calls_chat, lob, login_time,
            wait_time, talk_time, dispo_time, pause_time, acht, lunch, tea, tea1, washr,
            team_briefing_aux, net_pause, avg_dispo, total_break, actual_login_hrs, downtime,
            login_duration, logout_time, net_login_hrs, utilization, attendance_1, week_1, mtd,
            team_leader, fhd, tenure, tenurity_week, sub_lob, unique_count, attendance_2,
            capping, attendance_3, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          getOrNull(data, "unique_id"),
          getOrNull(data, "week"),
          reportDate,
          empName,
          getOrNull(data, "noiid"),
          parseNullableInt(get(data, "num_calls_chat")),
          getOrNull(data, "lob"),
          getOrNull(data, "login_time"),
          getOrNull(data, "wait_time"),
          getOrNull(data, "talk_time"),
          getOrNull(data, "dispo_time"),
          getOrNull(data, "pause_time"),
          parseNullableInt(get(data, "acht")),
          getOrNull(data, "lunch"),
          getOrNull(data, "tea"),
          getOrNull(data, "tea1"),
          getOrNull(data, "washr"),
          getOrNull(data, "team_briefing_aux"),
          getOrNull(data, "net_pause"),
          getOrNull(data, "avg_dispo"),
          getOrNull(data, "total_break"),
          getOrNull(data, "actual_login_hrs"),
          getOrNull(data, "downtime"),
          getOrNull(data, "login_duration"),
          getOrNull(data, "logout_time"),
          getOrNull(data, "net_login_hrs"),
          getOrNull(data, "utilization"),
          getOrNull(data, "attendance_1"),
          getOrNull(data, "week_1"),
          getOrNull(data, "mtd"),
          getOrNull(data, "team_leader"),
          getOrNull(data, "fhd"),
          parseNullableInt(get(data, "tenure")),
          getOrNull(data, "tenurity_week"),
          getOrNull(data, "sub_lob"),
          parseNullableInt(get(data, "unique_count")),
          getOrNull(data, "attendance_2"),
          getOrNull(data, "capping"),
          getOrNull(data, "attendance_3"),
          null, // uploaded_by: HRMS user ids are UUIDs, don't fit this int column
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

  return { importedRows, errorRows, errors };
}
