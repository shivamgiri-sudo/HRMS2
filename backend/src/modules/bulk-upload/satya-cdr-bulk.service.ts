import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * satya_cdr -- writes into db_masmis.satya_cdr (sql/1770). Source: Satya CDR.xlsx (Sheet1).
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

export async function importSatyaCdrBatch(
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

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const requiredVal = getByColumn(data, "Call Id");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "Call Id" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.satya_cdr
           (number_val, in_call_from, call_id, scenario, sub_scenario_1, amount, beat_name, shop_name, warehouse, remarks, roster, call_date, call_action, call_sub_action, call_action_remarks, closer_date, follow_up_date, case_close_by, tat, due_date, call_created, call_status, connected, closer_time, report_date, attempt, agent_name, uid, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n(data, "Numner"),
          n(data, "IN CALL FROM"),
          requiredVal,
          n(data, "SCENARIO"),
          n(data, "SUB SCENARIO 1"),
          n(data, "Amount"),
          n(data, "Beatname"),
          n(data, "Shop Name"),
          n(data, "Warehouse"),
          n(data, "Remarks"),
          n(data, "Roster"),
          n(data, "CallDate"),
          n(data, "Call Action"),
          n(data, "Call Sub Action"),
          n(data, "Call Action Remarks"),
          n(data, "Closer Date"),
          n(data, "Follow Up Date"),
          n(data, "Case Close By"),
          n(data, "TAT"),
          n(data, "Due Date"),
          n(data, "Call Created"),
          n(data, "Call Status"),
          n(data, "Connected"),
          n(data, "Closer Time"),
          n(data, "Date"),
          n(data, "Attempt"),
          n(data, "Agent Name"),
          n(data, "UID"),
          uploadedByInt, batchId,
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
       VALUES (?, 'satya_cdr', ?, ?, NULL)`,
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
