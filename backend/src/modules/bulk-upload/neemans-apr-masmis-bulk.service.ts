import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Neemans' real APR export -- writes into the SAME already-live
 * db_masmis.neemans_apr table (132 real rows) the separate My Dashboards
 * tool already uses.
 *
 * Header aliases below are the REAL file's own headers, read directly off
 * the app's own "Columns actually found in this file" error message
 * (reported live: "Unique ID, Week, Date, Emp_Name, EMP ID, No. of
 * Calls/Chat, UCA OB, LOB, LOGIN TIME, PARKS, PARK TIME, AVG PARK,
 * PARKS/CALL, WAIT, TALK, DISPO, PAUSE, Login, Logout, ACHT, Team Briefing
 * AUX, Lunch, Tea, Tea1, Washr, Total Break, Net Login Hrs+DN+Briefing,
 * Occu%, Week_1, MTD, Attendance, Capping") -- not a guess. The original
 * camelCase-only keys never matched any of these, which is why every row
 * failed the required-field check even with "Emp_Name" plainly present.
 * All 32 headers line up 1:1 positionally with this table's 32 columns.
 */

function get(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") {
      return String(data[k]).trim();
    }
  }
  return "";
}
function n(data: Record<string, unknown>, ...keys: string[]): string | null {
  const v = get(data, ...keys);
  return v || null;
}
function parseNullableInt(v: string): number | null {
  const num = parseInt(v, 10);
  return Number.isFinite(num) ? num : null;
}
function parseNullableDecimal(v: string): number | null {
  const num = parseFloat(v);
  return Number.isFinite(num) ? num : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importNeemansAprMasmisBatch(
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

    const empName = get(data, "Emp_Name", "empName", "emp_name");
    if (!empName) {
      const msg = `Row ${row.row_no}: "empName" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
          n(data, "Unique ID", "uniqueId", "unique_id"), n(data, "Week", "week"), n(data, "Date", "date"), empName,
          n(data, "EMP ID", "empId", "emp_id"), parseNullableInt(get(data, "No. of Calls/Chat", "calls")),
          parseNullableInt(get(data, "UCA OB", "ucaOb", "uca_ob")), n(data, "LOB", "lob"),
          n(data, "LOGIN TIME", "loginTime", "login_time"), parseNullableInt(get(data, "PARKS", "parks")),
          n(data, "PARK TIME", "parkTime", "park_time"), n(data, "AVG PARK", "avgPark", "avg_park"),
          parseNullableDecimal(get(data, "PARKS/CALL", "parksPerCall", "parks_per_call")),
          n(data, "WAIT", "wait"), n(data, "TALK", "talk"), n(data, "DISPO", "dispo"), n(data, "PAUSE", "pause"),
          n(data, "Login", "loginTs", "login_ts"), n(data, "Logout", "logoutTs", "logout_ts"),
          parseNullableInt(get(data, "ACHT", "acht")), n(data, "Team Briefing AUX", "teamBriefing", "team_briefing"),
          n(data, "Lunch", "lunch"), n(data, "Tea", "tea"), n(data, "Tea1", "tea1"), n(data, "Washr", "washr"),
          n(data, "Total Break", "totalBreak", "total_break"), n(data, "Net Login Hrs+DN+Briefing", "netLogin", "net_login"),
          parseNullableDecimal(get(data, "Occu%", "occuPct", "occu_pct")),
          n(data, "Week_1", "weekShort", "week_short"), n(data, "MTD", "mtd"),
          parseNullableInt(get(data, "Attendance", "attendance")), n(data, "Capping", "capping"),
          null, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.neemans_apr
           (unique_id, week, date, emp_name, emp_id, calls, uca_ob, lob, login_time, parks,
            park_time, avg_park, parks_per_call, wait, talk, dispo, pause, login_ts, logout_ts,
            acht, team_briefing, lunch, tea, tea1, washr, total_break, net_login, occu_pct,
            week_short, mtd, attendance, capping, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'neemans_apr', ?, ?, NULL)`,
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

  // Same convention as every other importer in this module (e.g. gnc-apr-masmis-bulk.service.ts)
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
