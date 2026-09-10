import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Neemans' real APR export -- writes into the SAME already-live
 * db_masmis.neemans_apr table (132 real rows) the separate My Dashboards
 * tool already uses. Live schema matches the doc exactly, positional by
 * design in that repo (32 fixed columns, no header search) -- here we
 * still key off normalized_data by field name (our own upload_batch_row
 * convention already resolves the sheet's raw columns into named JSON),
 * so the same field-name set is used, just not re-deriving position.
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
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const empName = get(data, "empName", "emp_name");
    if (!empName) {
      const msg = `Row ${row.row_no}: "empName" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.neemans_apr
           (unique_id, week, date, emp_name, emp_id, calls, uca_ob, lob, login_time, parks,
            park_time, avg_park, parks_per_call, wait, talk, dispo, pause, login_ts, logout_ts,
            acht, team_briefing, lunch, tea, tea1, washr, total_break, net_login, occu_pct,
            week_short, mtd, attendance, capping, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n(data, "uniqueId", "unique_id"), n(data, "week"), n(data, "date"), empName,
          n(data, "empId", "emp_id"), parseNullableInt(get(data, "calls")),
          parseNullableInt(get(data, "ucaOb", "uca_ob")), n(data, "lob"),
          n(data, "loginTime", "login_time"), parseNullableInt(get(data, "parks")),
          n(data, "parkTime", "park_time"), n(data, "avgPark", "avg_park"),
          parseNullableDecimal(get(data, "parksPerCall", "parks_per_call")),
          n(data, "wait"), n(data, "talk"), n(data, "dispo"), n(data, "pause"),
          n(data, "loginTs", "login_ts"), n(data, "logoutTs", "logout_ts"),
          parseNullableInt(get(data, "acht")), n(data, "teamBriefing", "team_briefing"),
          n(data, "lunch"), n(data, "tea"), n(data, "tea1"), n(data, "washr"),
          n(data, "totalBreak", "total_break"), n(data, "netLogin", "net_login"),
          parseNullableDecimal(get(data, "occuPct", "occu_pct")),
          n(data, "weekShort", "week_short"), n(data, "mtd"),
          parseNullableInt(get(data, "attendance")), n(data, "capping"),
          null, batchId,
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

  return { importedRows, errorRows, errors };
}
