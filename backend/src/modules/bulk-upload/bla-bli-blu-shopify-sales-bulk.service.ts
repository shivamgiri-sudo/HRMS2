import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Bla Bli Blu's real direct Shopify order export -- see sql/1745 for the
 * cross-schema check confirming this is genuinely different from
 * bla_bli_blu_overall_sales_raw (sql/1729), and the Excel error-byte-code
 * corruption found in several helper columns.
 */

export const ERROR_CODES = new Set(["0x00", "0x07", "0x0f", "0x17", "0x1d", "0x24", "0x2a"]);

export function isErrorCode(raw: unknown): boolean {
  return ERROR_CODES.has(String(raw ?? "").trim());
}

export function cleanText(raw: unknown): string | null {
  if (isErrorCode(raw)) return null;
  const v = String(raw ?? "").trim();
  return v === "" || v === "None" ? null : v;
}

export function parseNullableDecimal(raw: unknown): number | null {
  if (isErrorCode(raw)) return null;
  const v = String(raw ?? "").trim();
  if (!v || v === "None") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseNullableInt(raw: unknown): number | null {
  const n = parseNullableDecimal(raw);
  return n === null ? null : Math.round(n);
}

/** Shopify's own "YYYY-MM-DD HH:MM:SS +0530" text -> "YYYY-MM-DD HH:MM:SS". */
export function parseShopifyDateTime(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "None") return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(v);
  return m ? `${m[1]} ${m[2]}` : null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importBlaBliBluShopifySalesBatch(
  batchId: string,
  importedByUserId: string,
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) {
    const [staged] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ?`,
      [batchId],
    );
    if (Number((staged as RowDataPacket[])[0]?.n ?? 0) === 0) {
      await db.execute(
        `UPDATE upload_batch SET batch_status = 'validation_failed',
            error_summary = 'No rows were staged for this batch -- the upload''s row-staging step likely failed or timed out. Re-upload the file.',
            updated_at = NOW()
         WHERE id = ?`,
        [batchId],
      );
    }
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Bla Bli Blu' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];

  const toInsert: ChunkInsertRow[] = [];
  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "Bla Bli Blu" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    const orderName = cleanText(data["Name"]);
    const lineitemSku = cleanText(data["Lineitem sku"]);
    if (!orderName || !lineitemSku) {
      const msg = `Row ${row.row_no}: "Name" and "Lineitem sku" are both required -- together they are this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(), processId, orderName, lineitemSku,
        cleanText(data["Id"]),
        cleanText(data["Financial Status"]),
        parseShopifyDateTime(data["Paid at"]),
        cleanText(data["Fulfillment Status"]),
        parseNullableDecimal(data["Total"]),
        cleanText(data["Discount Code"]),
        parseNullableDecimal(data["Discount Amount"]),
        cleanText(data["Shipping Method"]),
        parseShopifyDateTime(data["Created at"]),
        parseNullableInt(data["Lineitem quantity"]),
        cleanText(data["Lineitem name"]),
        parseNullableDecimal(data["Lineitem price"]),
        parseNullableDecimal(data["Lineitem compare at price"]),
        cleanText(data["ShippingPhone"]),
        cleanText(data["Notes"]),
        cleanText(data["Employee"]),
        cleanText(data["Tags"]),
        cleanText(data["Risk Level"]),
        cleanText(data["Source"]),
        cleanText(data["OB Sale RAW"]),
        cleanText(data["GoKwik"]),
        cleanText(data["Order id"]),
        cleanText(data["Order id-Mobile"]),
        batchId,
        importedByUserId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO bla_bli_blu_shopify_sales_raw
           (id, process_id, order_name, lineitem_sku, shopify_order_id, financial_status, paid_at,
            fulfillment_status, total_amount, discount_code, discount_amount, shipping_method,
            order_created_at, lineitem_quantity, lineitem_name, lineitem_price,
            lineitem_compare_at_price, shipping_phone, notes, employee, tags, risk_level, source,
            ob_sale_raw, gokwik, order_id_lookup, order_id_mobile, data_source, source_reference, created_by)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)",
    insertSuffix: `ON DUPLICATE KEY UPDATE
            financial_status = VALUES(financial_status),
            fulfillment_status = VALUES(fulfillment_status),
            total_amount = VALUES(total_amount)`,
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    const failedRowIds = new Set(inserted.errorUpdates.map((e) => e.rowId));
    const successRowIds = toInsert.filter((r) => !failedRowIds.has(r.rowId)).map((r) => r.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported' WHERE id IN (${successRowIds.map(() => "?").join(",")})`,
      successRowIds as never[],
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
