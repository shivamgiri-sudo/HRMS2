import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * satya_allocation -- writes into db_masmis.satya_allocation (sql/1770). Source: Satya Allocation.xlsx (Allocation sheet).
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

export async function importSatyaAllocationBatch(
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

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const requiredVal = getByColumn(data, "UID");
    if (!requiredVal) {
      const msg = `Row ${row.row_no}: "UID" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        n(data, "Roster"),
        n(data, "Warehouse"),
        n(data, "Beatname"),
        n(data, "Shop Name"),
        n(data, "Shop Phone"),
        n(data, "MASID"),
        n(data, "Date"),
        requiredVal,
        n(data, "Number"),
        n(data, "Unique"),
        n(data, "All Date"),
        n(data, "Agent ID"),
        n(data, "Disposition"),
        n(data, "Sub-Disposition"),
        n(data, "Attempt"),
        n(data, "dd"),
        n(data, "Same Day Connected"),
        n(data, "Agent Name"),
        n(data, "Order Value"),
        n(data, "Call Type"),
        n(data, "Order Match (filtered)"),
        n(data, "Agent Name_1"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.satya_allocation
       (roster, warehouse, beat_name, shop_name, shop_phone, mas_id, report_date, uid, number_val, unique_flag, all_date, agent_id, disposition, sub_disposition, attempt, dd_val, same_day_connected, agent_name, order_value, call_type, order_match_filtered, agent_name_2, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'satya_allocation', ?, ?, NULL)`,
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
