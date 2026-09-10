import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Neemans' real "Cart" export -- writes into the SAME already-live
 * db_masmis.neemans_cart table (currently 0 rows -- a never-used upload
 * type in My Dashboards, confirmed via SHOW COLUMNS matching the doc
 * exactly, not a drift case).
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

export async function importNeemansCartMasmisBatch(
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

    const cartId = get(data, "cartId", "cart_id");
    if (!cartId) {
      const msg = `Row ${row.row_no}: "cartId" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.neemans_cart
           (sno, cart_id, created_at, updated_at, customer_name, phone_number, email_id,
            line_items, amount, agent, disposition, sub_disposition, call_date, status,
            uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          parseNullableInt(get(data, "sno", "s_no", "serial")), cartId,
          n(data, "createdAt", "created_at", "created_date", "createdat"),
          n(data, "updatedAt", "updated_at", "updated_date", "updatedat"),
          n(data, "customerName", "customer_name", "customername", "name"),
          n(data, "phoneNumber", "phone_number", "phonenumber", "phone", "mobile"),
          n(data, "emailId", "email_id", "email", "emailid"),
          n(data, "lineItems", "line_items", "lineitems", "items", "products", "product"),
          parseNullableDecimal(get(data, "amount", "cart_value", "value", "total")),
          n(data, "agent", "agent_name", "agentname"),
          n(data, "disposition", "disp"),
          n(data, "subDisposition", "sub_disposition", "subdisposition", "sub_disp"),
          n(data, "callDate", "call_date", "calldate", "date"),
          n(data, "status"),
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
       VALUES (?, 'neemans_cart', ?, ?, NULL)`,
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
