import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Neemans' monthly revenue target -- writes into the SAME already-live
 * db_masmis.neemans_month_targets table (2 real rows: 2026-07, 2026-08)
 * the separate My Dashboards tool already uses. Unlike every other table in
 * this upload family, `month` carries a UNIQUE key (one row per month by
 * design), so this is an upsert (ON DUPLICATE KEY UPDATE), not a plain
 * insert-only append -- re-uploading a corrected month's target replaces
 * it rather than creating a second row that `month` would reject outright.
 *
 * No real Excel export of this table has been seen (it's a small admin
 * figure, not a system-generated report like Sale/APR/Allocation), so the
 * header aliases below are a best-effort guess, not confirmed against a
 * real file the way GNC's uploaders were. If a real upload rejects a
 * column, the fix is the same playbook already proven twice this session:
 * read the actual error, add the real header as an alias.
 */

function get(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") {
      return String(data[k]).trim();
    }
  }
  return "";
}

/** "2026-07" / "Jul-2026" / "July 2026" / "07/2026" -> "YYYY-MM", matching the
 * column's own varchar(7) storage convention (confirmed via a real live row). */
const MONTH_ABBREVIATIONS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
export function parseTargetMonth(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})$/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = /^([A-Za-z]{3,})[\s-](\d{4})$/.exec(v);
  if (m) {
    const mon = MONTH_ABBREVIATIONS[m[1].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    return `${m[2]}-${mon}`;
  }
  return null;
}

function parseNullableDecimal(v: string): number | null {
  const num = parseFloat(v.replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importNeemansMonthTargetBatch(
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

  const createdByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const month = parseTargetMonth(get(data, "Month", "month"));
    const target = parseNullableDecimal(get(data, "Target", "target", "Amount", "amount"));
    if (!month || target === null) {
      const msg = `Row ${row.row_no}: "month" (YYYY-MM) and "target" are both required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.neemans_month_targets (month, target, created_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE target = VALUES(target)`,
        [month, target, createdByInt],
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
       VALUES (?, 'neemans_month_targets', ?, ?, NULL)`,
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
