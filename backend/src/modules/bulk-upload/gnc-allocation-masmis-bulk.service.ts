import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * GNC's real "Allocation" export -- the 3rd of GNC's 3 real My Dashboards
 * upload types (Sale and APR shipped earlier). Writes into the SAME
 * already-live db_masmis.gnc_allocation table (60,375 real rows, most
 * recent upload 2026-05-31) the separate My Dashboards tool already uses.
 * Live schema matches the doc exactly -- no drift found here.
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
function parseNullableDecimal(v: string): number | null {
  const num = parseFloat(v);
  return Number.isFinite(num) ? num : null;
}

/** Excel serial or plain text date -> "YYYY-MM-DD". */
export function parseGncAllocationDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "0" || v === "-") return null;
  const sn = parseFloat(v);
  if (Number.isFinite(sn) && sn > 40000 && sn < 60000) {
    const d = new Date((sn - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? m[0] : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importGncAllocationMasmisBatch(
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

    const uid = get(data, "uid");
    if (!uid) {
      const msg = `Row ${row.row_no}: "uid" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.gnc_allocation
           (uid, alloc_date, helper, date_type, time_slot, store, customer_name, email, total,
            created_at, lineitem_name, lineitem_sku, shipping_name, shipping_street, shipping_city,
            shipping_zip, shipping_phone, emp_id, calling_status, sub_scenarios_1, callback_date,
            same_day_connect, nc_connect, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uid, parseGncAllocationDate(get(data, "alloc_date")), n(data, "helper"),
          n(data, "date_type"), n(data, "time_slot"), n(data, "store"),
          n(data, "customer_name"), n(data, "email"), parseNullableDecimal(get(data, "total")),
          n(data, "created_at"), n(data, "lineitem_name"), n(data, "lineitem_sku"),
          n(data, "shipping_name"), n(data, "shipping_street"), n(data, "shipping_city"),
          n(data, "shipping_zip"), n(data, "shipping_phone"), n(data, "emp_id"),
          n(data, "calling_status"), n(data, "sub_scenarios_1"),
          parseGncAllocationDate(get(data, "callback_date")),
          n(data, "same_day_connect"), n(data, "nc_connect"),
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
       VALUES (?, 'gnc_allocation', ?, ?, NULL)`,
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
