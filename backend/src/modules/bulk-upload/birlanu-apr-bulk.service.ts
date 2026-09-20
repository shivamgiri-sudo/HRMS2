import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * birlanu_apr -- writes into db_masmis.birlanu_apr (sql/1770). Source: Birlanu APR.xlsx (APR sheet).
 * Columns confirmed directly against the real file, not guessed.
 */

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getByColumn(data: Record<string, unknown>, ...columnNames: string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const col of columnNames) {
    const v = normalized[normalizeKey(col)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function n(data: Record<string, unknown>, ...columnNames: string[]): string | null {
  const v = getByColumn(data, ...columnNames);
  return v || null;
}
/** Exact-case lookup, for the rare case where two real headers differ only
 * by case (e.g. "Login" vs "LOGIN") -- normalizeKey() would otherwise
 * collide them onto the same key. */
function exact(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  if (v === undefined || v === null || String(v).trim() === "") return null;
  return String(v).trim();
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importBirlanuAprBatch(
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

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  const toInsert: ChunkInsertRow[] = [];
  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const requiredVal = getByColumn(data, "ID");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "ID" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        n(data, "Date"),
        n(data, "Agent Name"),
        requiredVal,
        n(data, "Total"),
        n(data, "TIME CLOCK"),
        n(data, "LOGIN TIME"),
        n(data, "WAIT"),
        n(data, "WAIT %"),
        n(data, "TALK"),
        n(data, "TALK TIME %"),
        n(data, "DISPO"),
        n(data, "DISPOTIME %"),
        n(data, "PAUSE"),
        n(data, "PAUSETIME %"),
        n(data, "DEAD"),
        n(data, "DEAD TIME %"),
        n(data, "CUSTOMER"),
        exact(data, "Login"),
        n(data, "Logout"),
        n(data, "ACHT"),
        n(data, "AOM"),
        n(data, "BIO"),
        n(data, "LAGGED"),
        exact(data, "LOGIN"),
        n(data, "Lunch"),
        n(data, "Meet"),
        n(data, "TEA"),
        n(data, "Total break"),
        n(data, "Net login"),
        n(data, "Attandance"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.birlanu_apr
           (report_date, agent_name, mas_id, total_calls, time_clock, login_time, wait_time, wait_pct, talk_time, talk_time_pct, dispo_time, dispo_time_pct, pause_time, pause_time_pct, dead_time, dead_time_pct, customer_pct, login_pct, logout_count, acht, aom, bio, lagged, login_lagged, lunch, meet, tea, total_break, net_login, attendance, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'birlanu_apr', ?, ?, NULL)`,
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

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
