import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { flushDalmiaRows } from "./dalmia-chunk-import.js";
import type { ChunkInsertRow } from "./masmis-chunked-insert.js";
import {
  canonicalizeRow, cleanText, parseClockTime, parseDurationSeconds, parseFlexibleDate, parseLooseNumber, parsePercent,
} from "./dalmia-import-helpers.js";

/**
 * Dalmia Cement's own APR (agent productivity / utilisation) sheet -- the "dalmia_apr" uploader.
 *
 * One row per agent per day. Columns are read verbatim from the real sample the user supplied (header names
 * are matched case/space/punctuation-insensitively, so a re-typed header still lands):
 *   Unique ID | Week | Date | Emp_Name | NOIID | No. of Calls/Chat | LOB | Login Time | WAIT | TALK | DISPO | PAUSE |
 *   ACHT | Lunch | Tea | Tea1 | Washr | Team Briefing AUX | Net Pause | Avg Dispo | Total Break | Actual Login Hrs |
 *   Downtime | Login | Logout | Net Login Hrs+DN+Briefing | Utilization | Attendance | Week 1 | MTD | Unique Count |
 *   Attendence 2 | Capping | Attendance
 *
 * Coercions (the uploader page reads cells as Excel DISPLAYS them, i.e. text):
 *   - WAIT/TALK/DISPO/PAUSE/Lunch/Tea/Tea1/Washr/Team Briefing AUX/Net Pause/Total Break/Actual Login Hrs/Downtime/
 *     Login Time/Net Login.../Capping are DURATIONS ("7:46:42") stored as whole seconds; ACHT and Avg Dispo are already
 *     seconds (162, 5). Login / Logout are CLOCK times ("9:32:52" / "19:01:07").
 *   - Utilization "43%" is stored as 43. "Attendance" appears twice in the sheet: the first is the day count (1.00) and
 *     the second is the P/A status -- the second copy arrives as "Attendance_1" (SheetJS renames duplicates).
 * Row identity: "Unique ID" (date serial + employee id, e.g. 46235MAS62624); if it is blank it is built as
 * "<date>|<employee id>". Re-uploading the same day/agent updates the row instead of duplicating it.
 *
 * This is a RAW store of the uploaded sheet. Nothing reads it for KPIs -- productivity KPIs continue to come from
 * mas_hrms.apr (the dialer sync, see the 2026-09-10 retraction of sql/1733), so the two never compete as a source.
 */

export const DALMIA_APR_HEADERS = [
  "Unique ID", "Week", "Date", "Emp_Name", "NOIID", "No. of Calls/Chat", "LOB", "Login Time", "WAIT", "TALK", "DISPO",
  "PAUSE", "ACHT", "Lunch", "Tea", "Tea1", "Washr", "Team Briefing AUX", "Net Pause", "Avg Dispo", "Total Break",
  "Actual Login Hrs", "Downtime", "Login", "Logout", "Net Login Hrs+DN+Briefing", "Utilization", "Attendance",
  "Week 1", "MTD", "Unique Count", "Attendence 2", "Capping",
] as const;

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

const secInt = (raw: unknown): number | null => {
  const n = parseDurationSeconds(raw);
  return n === null ? null : Math.round(n);
};
const intOrNull = (raw: unknown): number | null => {
  const n = parseLooseNumber(raw);
  return n === null ? null : Math.round(n);
};

/** The sheet's two "Attendance" columns: a number (1.00) and a status letter (P / A / WO ...), in either order. */
export function splitAttendance(first: unknown, second: unknown): { days: number | null; status: string | null } {
  let days: number | null = null;
  let status: string | null = null;
  for (const v of [first, second]) {
    const s = cleanText(v);
    if (!s) continue;
    const n = parseLooseNumber(s);
    if (n !== null && days === null) days = n;
    else if (n === null && status === null) status = s.slice(0, 10);
  }
  return { days, status };
}

export async function importDalmiaAprBatch(
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

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Dalmia Cement' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const insertRows: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const raw =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);
    const data = canonicalizeRow(raw, DALMIA_APR_HEADERS);
    const fail = (msg: string) => { errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg.slice(0, 500) }); };

    if (!processId) { fail(`Row ${row.row_no}: no active "Dalmia Cement" process found to attach this row to`); continue; }

    const reportDate = parseFlexibleDate(data["Date"]);
    const empId = cleanText(data["NOIID"]);
    if (!reportDate || !empId) {
      fail(`Row ${row.row_no}: a readable "Date" and "NOIID" (employee id) are both required -- together they are this row's identity`);
      continue;
    }
    const uniqueId = (cleanText(data["Unique ID"]) ?? `${reportDate}|${empId}`).slice(0, 60);
    const att = splitAttendance(data["Attendance"], raw["Attendance_1"]);

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(), processId, uniqueId, reportDate,
        cleanText(data["Week"]), cleanText(data["Emp_Name"]), empId, intOrNull(data["No. of Calls/Chat"]), cleanText(data["LOB"]),
        secInt(data["Login Time"]), secInt(data["WAIT"]), secInt(data["TALK"]), secInt(data["DISPO"]), secInt(data["PAUSE"]),
        intOrNull(data["ACHT"]),
        secInt(data["Lunch"]), secInt(data["Tea"]), secInt(data["Tea1"]), secInt(data["Washr"]),
        secInt(data["Team Briefing AUX"]), secInt(data["Net Pause"]), intOrNull(data["Avg Dispo"]), secInt(data["Total Break"]),
        secInt(data["Actual Login Hrs"]), secInt(data["Downtime"]),
        parseClockTime(data["Login"]), parseClockTime(data["Logout"]),
        secInt(data["Net Login Hrs+DN+Briefing"]), parsePercent(data["Utilization"]),
        att.days, att.status, cleanText(data["Week 1"]), cleanText(data["MTD"]),
        intOrNull(data["Unique Count"]), intOrNull(data["Attendence 2"]), secInt(data["Capping"]),
        "bulk_upload", batchId, importedByUserId,
      ],
    });
  }

  return flushDalmiaRows({
    batchId, table: "db_masmis.dalmia_apr_raw",
    columns: ["id","process_id","unique_id","report_date","week_label","emp_name","emp_id","calls_chats","lob","login_time_sec","wait_sec","talk_sec","dispo_sec","pause_sec","acht_sec","lunch_sec","tea_sec","tea1_sec","washroom_sec","team_briefing_aux_sec","net_pause_sec","avg_dispo_sec","total_break_sec","actual_login_sec","downtime_sec","login_clock","logout_clock","net_login_incl_dn_briefing_sec","utilization_pct","attendance_days","attendance_status","week_bucket","period_label","unique_count","attendance_2","capping_sec","data_source","source_reference","created_by"],
    suffix: "ON DUPLICATE KEY UPDATE report_date = VALUES(report_date), week_label = VALUES(week_label), emp_name = VALUES(emp_name), calls_chats = VALUES(calls_chats), lob = VALUES(lob), login_time_sec = VALUES(login_time_sec), wait_sec = VALUES(wait_sec), talk_sec = VALUES(talk_sec), dispo_sec = VALUES(dispo_sec), pause_sec = VALUES(pause_sec), acht_sec = VALUES(acht_sec), lunch_sec = VALUES(lunch_sec), tea_sec = VALUES(tea_sec), tea1_sec = VALUES(tea1_sec), washroom_sec = VALUES(washroom_sec), team_briefing_aux_sec = VALUES(team_briefing_aux_sec), net_pause_sec = VALUES(net_pause_sec), avg_dispo_sec = VALUES(avg_dispo_sec), total_break_sec = VALUES(total_break_sec), actual_login_sec = VALUES(actual_login_sec), downtime_sec = VALUES(downtime_sec), login_clock = VALUES(login_clock), logout_clock = VALUES(logout_clock), net_login_incl_dn_briefing_sec = VALUES(net_login_incl_dn_briefing_sec), utilization_pct = VALUES(utilization_pct), attendance_days = VALUES(attendance_days), attendance_status = VALUES(attendance_status), week_bucket = VALUES(week_bucket), period_label = VALUES(period_label), unique_count = VALUES(unique_count), attendance_2 = VALUES(attendance_2), capping_sec = VALUES(capping_sec), source_reference = VALUES(source_reference)",
    rows: insertRows, errorUpdates, errors,
  });
}
