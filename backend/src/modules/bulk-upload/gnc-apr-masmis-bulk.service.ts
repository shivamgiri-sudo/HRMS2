import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

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

const MONTH_ABBREVIATIONS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** report_date: "YYYY-MM-DD" / "M/D/YYYY" text parsing as the retired
 * gnc-apr-daily-bulk.service.ts had -- this part of that service was never in
 * question, only its target table and duration-column assumption were. Also
 * handles "D-Mon-YY" (e.g. "1-Sep-26"), the format the real GNC APR export
 * actually uses -- confirmed against upload_template_master.required_columns
 * and a live rejected batch, neither of which the retired service ever saw. */
export function parseReportDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})-([A-Za-z]{3,})-(\d{2,4})$/.exec(v);
  if (m) {
    const mon = MONTH_ABBREVIATIONS[m[2].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${mon}-${m[1].padStart(2, "0")}`;
  }
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
  const insertRows: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    // Key aliases here are load-bearing, not decoration: upload_template_master's own
    // required_columns/optional_columns for GNC_APR list the RAW file headers below
    // ("USER", "Date", "ID", "TL Name", ...) and BellavitaMasmisUploader.tsx stages
    // normalized_data as that raw row verbatim (no rename step) -- so "user_name",
    // "report_date" etc. alone never matched a single real row. Confirmed against a
    // live rejected batch (6/6 rows, "user_name/report_date both required" on rows
    // that plainly had both, just spelled "USER"/"Date"). Canonical snake_case keys
    // are kept as a second alternative in case a future clean source stages those.
    const userName = get(data, "USER", "User Name", "user_name");
    const reportDate = parseReportDate(get(data, "Date", "report_date"));
    if (!userName || !reportDate) {
      const msg = `Row ${row.row_no}: "user_name" and "report_date" are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        getOrNull(data, "UID", "uid"),
        reportDate,
        userName,
        getOrNull(data, "ID", "emp_id"),
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
        null, // uploaded_by: HRMS user ids are UUIDs, don't fit this int column
        batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.gnc_apr
       (uid, report_date, user_name, emp_id, tl_name, calls, process_type,
        login_time, wait_time, talk_time, dispo_time, pause_time, login_duration,
        logout_time, acht, aoc, bio, bre, briefing, down_time, lunch, meet, qa, sb,
        tea_break, training_break, wash, net_login, break_time, tra_qa, downtime,
        atten, capping, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

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
