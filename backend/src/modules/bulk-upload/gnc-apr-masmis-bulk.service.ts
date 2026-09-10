import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * GNC's daily Agent Productivity Report (APR) -- writes into the SAME
 * already-live db_masmis.gnc_apr table (829 real rows, stale since
 * 2026-05-30) the separate My Dashboards tool (github.com/tausifansari-mcn/
 * Mydashboards) already uses, per explicit user instruction given directly
 * in this conversation ("we will use the same database table just build
 * the uploader in HRMS"). This REPLACES the earlier gnc-apr-daily-bulk.
 * service.ts / sql/1736 approach (a separate mas_hrms.gnc_apr_daily_actual
 * table), which an earlier concurrent session built citing the project's
 * upstream-read-only default -- reconciled here per the user's explicit
 * direction, which supersedes that default for this case.
 *
 * Two real discrepancies found against the LIVE table (not assumed from
 * the sister repo's code, which itself has drifted from its own schema --
 * see gnc-sale-masmis-bulk.service.ts for the same pattern):
 *  1. Duration columns (login_time, wait_time, talk_time, dispo_time,
 *     pause_time, net_login, break_time, etc.) are varchar(50) holding
 *     FRACTION-OF-A-DAY DECIMAL TEXT (e.g. "0.4047337962962963"), not
 *     "HH:MM:SS" text as the retired service's own comment assumed --
 *     confirmed via a real live row (id 829). New rows keep that same
 *     fraction-of-day text convention rather than converting to seconds,
 *     so they read consistently with the 829 existing real rows in the
 *     same columns.
 *  2. The live table has far more real columns than the retired service's
 *     GNC_APR_HEADERS covered: aoc, bio, bre, briefing, down_time, lunch,
 *     meet, qa, sb, tea_break, training_break, wash, tra_qa, downtime,
 *     capping, login_duration, logout_time -- all included here.
 *
 * No dedup key: like every other My Dashboards table, gnc_apr has none
 * (insert-only, revert-by-deleting-the-batch via upload_log).
 */

export const GNC_APR_MASMIS_HEADERS = [
  "uid", "report_date", "user_name", "emp_id", "tl_name", "calls", "process_type",
  "login_time", "wait_time", "talk_time", "dispo_time", "pause_time",
  "login_duration", "logout_time", "acht", "aoc", "bio", "bre", "briefing",
  "down_time", "lunch", "meet", "qa", "sb", "tea_break", "training_break",
  "wash", "net_login", "break_time", "tra_qa", "downtime", "atten", "capping",
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

/** report_date: same "YYYY-MM-DD" / "M/D/YYYY" text parsing as the retired
 * gnc-apr-daily-bulk.service.ts -- this part of that service was never in
 * question, only its target table and duration-column assumption were. */
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

    const userName = get(data, "user_name", "User Name");
    const reportDate = parseReportDate(get(data, "report_date", "Date"));
    if (!userName || !reportDate) {
      const msg = `Row ${row.row_no}: "user_name" and "report_date" are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

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
          getOrNull(data, "uid"),
          reportDate,
          userName,
          getOrNull(data, "emp_id"),
          getOrNull(data, "tl_name"),
          parseNullableInt(get(data, "calls")),
          getOrNull(data, "process_type"),
          getOrNull(data, "login_time"),
          getOrNull(data, "wait_time"),
          getOrNull(data, "talk_time"),
          getOrNull(data, "dispo_time"),
          getOrNull(data, "pause_time"),
          getOrNull(data, "login_duration"),
          getOrNull(data, "logout_time"),
          parseNullableInt(get(data, "acht")),
          getOrNull(data, "aoc"),
          getOrNull(data, "bio"),
          getOrNull(data, "bre"),
          getOrNull(data, "briefing"),
          getOrNull(data, "down_time"),
          getOrNull(data, "lunch"),
          getOrNull(data, "meet"),
          getOrNull(data, "qa"),
          getOrNull(data, "sb"),
          getOrNull(data, "tea_break"),
          getOrNull(data, "training_break"),
          getOrNull(data, "wash"),
          getOrNull(data, "net_login"),
          getOrNull(data, "break_time"),
          getOrNull(data, "tra_qa"),
          getOrNull(data, "downtime"),
          parseNullableInt(get(data, "atten")),
          getOrNull(data, "capping"),
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
       VALUES (?, 'gnc_apr', ?, ?, NULL)`,
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
