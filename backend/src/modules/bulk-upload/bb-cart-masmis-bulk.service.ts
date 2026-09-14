import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Bellavita's real "Cart" (abandoned cart follow-up) export -- writes into
 * the SAME already-live db_masmis.bb_cart table (48,000 real rows) the
 * separate My Dashboards tool already uses. Live schema matches the doc
 * exactly, header-name based (header row located by scanning for "CC" in
 * that repo's own controller).
 */

export const BB_CART_HEADERS = [
  "CC", "Source", "SNo", "Cart ID", "Created At", "Updated At", "Customer Name",
  "Customer Address", "Phone Number", "Email ID", "Line Items", "Variant Title",
  "Abandoned Cart Link", "Amount", "Phone (10 Digit)", "Dates", "Agent",
  "Disposition", "Sub Disposition", "Call Date", "Same Day Connect", "Status",
] as const;

function get(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") {
      return String(data[k]).trim();
    }
  }
  return "";
}

function parseNullableInt(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
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

export async function importBbCartMasmisBatch(
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

    const cartId = get(data, "Cart ID", "cart_id");
    if (!cartId) {
      const msg = `Row ${row.row_no}: "Cart ID" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.bb_cart
           (cc, source, sno, cart_id, created_at, updated_at, customer_name, customer_address,
            phone_number, email_id, line_items, variant_title, abandoned_cart_link, amount,
            phone_10_digit, dates, agent, disposition, sub_disposition, call_date,
            same_day_connect, status, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          get(data, "CC", "cc") || null,
          get(data, "Source", "source") || null,
          parseNullableInt(get(data, "SNo", "sno")),
          cartId,
          get(data, "Created At", "created_at") || null,
          get(data, "Updated At", "updated_at") || null,
          get(data, "Customer Name", "customer_name") || null,
          get(data, "Customer Address", "customer_address") || null,
          get(data, "Phone Number", "phone_number") || null,
          get(data, "Email ID", "email_id") || null,
          get(data, "Line Items", "line_items") || null,
          get(data, "Variant Title", "variant_title") || null,
          get(data, "Abandoned Cart Link", "abandoned_cart_link") || null,
          parseNullableDecimal(get(data, "Amount", "amount")),
          get(data, "Phone (10 Digit)", "phone_10_digit") || null,
          get(data, "Dates", "dates") || null,
          get(data, "Agent", "agent") || null,
          get(data, "Disposition", "disposition") || null,
          get(data, "Sub Disposition", "sub_disposition") || null,
          get(data, "Call Date", "call_date") || null,
          get(data, "Same Day Connect", "same_day_connect") || null,
          get(data, "Status", "status") || null,
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
       VALUES (?, 'bb_cart', ?, ?, NULL)`,
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
