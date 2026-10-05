/**
 * Bellavita APR (db_masmis.bb_apr) check-and-insert.
 *
 * bb_apr has no natural upsert key the way bb_sale/bb_chat/bb_cart do (an
 * agent can legitimately have more than one row per day in source data), so
 * this only ever inserts and warns if any row's report_date is <= the
 * table's current max report_date -- i.e. it assumes each APR file is a
 * pure forward extension, the same shape "APR after 24.xlsx" was. Review the
 * warning before running with execute:true if a file might overlap.
 *
 * Column mapping matches bb-apr-masmis-bulk.service.ts's importBbAprMasmisBatch,
 * storing duration columns as raw decimal-fraction text (the table's existing
 * convention) rather than converting them to seconds.
 */
import XLSX from "xlsx";
import { db } from "../../../src/db/mysql.js";

export interface AprUploadOptions { execute: boolean }
export interface AprUploadResult { totalRows: number; validRows: number; overlapping: number; inserted: number; errors: number }

function get(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return v === undefined || v === null || v === "" ? "" : String(v).trim();
}
function getOrNull(data: Record<string, unknown>, key: string): string | null {
  const v = get(data, key);
  return v || null;
}
function parseNullableInt(v: string): number | null {
  const n = parseInt(v.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}
/** Excel serial number -> "YYYY-MM-DD". */
function excelSerialToIso(raw: unknown): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 40000 || n > 60000) return null;
  const d = new Date((n - 25569) * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function runAprUpload(filePath: string, opts: AprUploadOptions): Promise<AprUploadResult> {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  console.log(`[apr] Read ${rows.length} rows from ${filePath}`);

  const [[maxRow]] = await db.execute<any[]>(`SELECT MAX(report_date) AS mx FROM db_masmis.bb_apr`);
  console.log(`[apr] Current bb_apr max report_date: ${maxRow.mx}`);

  const prepared = rows.map((r) => ({ r, reportDate: excelSerialToIso(r["Date"]) ?? (typeof r["Date"] === "string" ? r["Date"] : null), empName: get(r, "Emp_Name") }));
  const good = prepared.filter((p) => p.reportDate && p.empName);
  console.log(`[apr] Rows with a valid report_date + emp_name: ${good.length} (skipped: ${prepared.length - good.length})`);

  const overlapping = good.filter((p) => p.reportDate! <= String(maxRow.mx));
  if (overlapping.length > 0) {
    console.log(`[apr] WARNING: ${overlapping.length} rows have report_date <= current max (${maxRow.mx}) -- bb_apr has no unique constraint, so re-running this file (or an overlapping one) WILL create duplicate rows. Review before proceeding.`);
  }

  if (!opts.execute) {
    console.log("[apr] DRY RUN -- no writes made.");
    return { totalRows: rows.length, validRows: good.length, overlapping: overlapping.length, inserted: 0, errors: 0 };
  }

  let inserted = 0;
  let errors = 0;
  for (const { r, reportDate, empName } of good) {
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
          getOrNull(r, "Unique ID"), getOrNull(r, "Week"), reportDate, empName, getOrNull(r, "NOIID"),
          parseNullableInt(get(r, "No. of Calls/Chat")), getOrNull(r, "LOB"),
          getOrNull(r, "Login Time"), getOrNull(r, "WAIT"), getOrNull(r, "TALK"), getOrNull(r, "DISPO"), getOrNull(r, "PAUSE"),
          parseNullableInt(get(r, "ACHT")), getOrNull(r, "Lunch"), getOrNull(r, "Tea"), getOrNull(r, "Tea1"), getOrNull(r, "Washr"),
          getOrNull(r, "Team Briefing AUX"), null, getOrNull(r, "Avg Dispo"), getOrNull(r, "Total Break"),
          getOrNull(r, "Actual Login Hrs"), getOrNull(r, "Downtime"), getOrNull(r, "Login"), getOrNull(r, "Logout"),
          getOrNull(r, "Net Login Hrs+DN+Briefing"), getOrNull(r, "Utilization"), getOrNull(r, "Attendance"),
          getOrNull(r, "Week 1"), getOrNull(r, "MTD"), getOrNull(r, "Team Leader"), getOrNull(r, "FHD"),
          parseNullableInt(get(r, "Tenure")), getOrNull(r, "Tenurity Week"), getOrNull(r, "Sub Lob"),
          parseNullableInt(get(r, "Unique Count")), getOrNull(r, "Attendence 2"), getOrNull(r, "Capping"),
          getOrNull(r, "Attendance_1"), null, null,
        ],
      );
      inserted += 1;
    } catch (e) {
      console.warn(`[apr] Insert failed for ${empName} / ${reportDate}:`, e instanceof Error ? e.message : e);
      errors += 1;
    }
  }

  if (inserted > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by) VALUES (UUID(), 'bb_apr', ?, ?, NULL)`,
      [filePath, inserted],
    );
  }

  console.log(`[apr] Done. Inserted ${inserted} rows (${errors} errors).`);
  return { totalRows: rows.length, validRows: good.length, overlapping: overlapping.length, inserted, errors };
}
