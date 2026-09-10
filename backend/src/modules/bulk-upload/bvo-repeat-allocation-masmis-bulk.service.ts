import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Bellavita's real "Repeat Allocation" export -- writes into the SAME
 * already-live db_masmis.bvo_repeat_allocation table (currently 0 rows --
 * a genuinely never-used upload type in My Dashboards, confirmed via
 * SHOW COLUMNS matching the doc exactly; not a drift case).
 */

export const BVO_REPEAT_ALLOCATION_HEADERS = [
  "unique_id", "mobile_no", "payment_mode", "email", "order_invoice_amount",
  "order_id", "product_name", "shipping_customer_name", "previous_order_creation_date",
] as const;

function get(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") {
      return String(data[k]).trim();
    }
  }
  return "";
}

function parseNullableDecimal(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importBvoRepeatAllocationMasmisBatch(
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

    const mobile = get(data, "mobile_no");
    if (!mobile) {
      const msg = `Row ${row.row_no}: "mobile_no" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.bvo_repeat_allocation
           (unique_id, mobile_no, payment_mode, email, order_invoice_amount, order_id,
            product_name, shipping_customer_name, previous_order_creation_date,
            uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          get(data, "unique_id") || null, mobile,
          get(data, "payment_mode") || null, get(data, "email") || null,
          parseNullableDecimal(get(data, "order_invoice_amount")),
          get(data, "order_id") || null, get(data, "product_name") || null,
          get(data, "shipping_customer_name") || null,
          get(data, "previous_order_creation_date") || null,
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
       VALUES (?, 'bvo_repeat_allocation', ?, ?, NULL)`,
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
