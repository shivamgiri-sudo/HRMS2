import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Reginald Men Abandoned Cart Dashboard's Live Sales source. Two column layouts
 * have existed:
 *
 * 1. The original Google Form export (see sql/1752) -- "Timestamp", "Order id",
 *    "Amount", "LOB", "Order Date", "Payment Type", plus two mislabeled generic
 *    headers ("Column 6" = Agent Name, "Column 1" = Time Slot) read under those
 *    exact literal strings since that is what the real export contained.
 * 2. The direct Shopify order export downloaded 2026-09-17 ("Reginald men -
 *    Live sales.xlsx") -- "Date", "Agent ID", "Agents status" (this is actually
 *    the agent's NAME despite the header), "Shopify Order Name", "Grand Total",
 *    "Coupon Code", plus columns this table has no equivalent for (Customer
 *    Name/Phone, Billing State, "Number") that are simply not imported.
 *
 * Every field below tries format 1's header first, falling back to format 2's,
 * so a re-upload of an old-format file keeps working exactly as before.
 */

export const REGINALD_ABANDONED_CART_SALES_HEADERS = [
  "Timestamp", "Order id", "Amount", "LOB", "Order Date", "Payment Type",
  "Column 6", "Order id ", "Column 1", "EMP ID",
  "Date", "Agent ID", "Agents status", "Shopify Order Name", "Grand Total", "Coupon Code",
] as const;

export function cleanText(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

export function normalizeName(raw: unknown): string | null {
  const v = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return v || null;
}

export function parseAmount(raw: unknown): number | null {
  const v = String(raw ?? "").replace(/,/g, "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Handles "9/10/2026 18:39:29" (Timestamp), "9/10/2026"/"30-Apr-2026" (Order Date,
 * 4-digit year), and "1-Sep-26" (the Shopify export's "Date" column -- SheetJS's
 * sheet_to_csv renders this cell's own stored format, a 2-digit year; confirmed
 * against the real Reginald men - Live sales.xlsx, cell format "1-Sep-26").
 * 2-digit years are assumed 20xx -- safe for sales data, this feed did not exist
 * before 2000.
 */
export function parseDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const mSlash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (mSlash) {
    const [, m, d, y] = mSlash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const mDash4 = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(v);
  const mDash2 = !mDash4 ? /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(v) : null;
  const mDash = mDash4 ?? mDash2;
  if (mDash) {
    const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const mon = months[mDash[2].toLowerCase()];
    const year = mDash4 ? mDash[3] : `20${mDash[3]}`;
    if (mon) return `${year}-${mon}-${mDash[1].padStart(2, "0")}`;
  }
  return null;
}

export function parseDateTime(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const [, mo, d, y, h, mi, s] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")} ${h.padStart(2, "0")}:${mi}:${s}`;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importReginaldAbandonedCartSalesBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Reginald' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Reginald" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    // Shopify Order Name (#RM1152445 etc.) is the same order-number shape as the Google
    // Form's own "Order id" -- confirmed against 10,736 already-imported rows (all
    // "#RM..."). Grand Total -> Amount, Date -> Order Date are direct renames.
    const orderId = cleanText(data["Order id"]) ?? cleanText(data["Shopify Order Name"]);
    const amount = parseAmount(data["Amount"]) ?? parseAmount(data["Grand Total"]);
    // LOB has no equivalent column in the Shopify export at all -- inferred from Coupon
    // Code's presence, since it tracks the historical ABCD/REPT split closely (this file:
    // 994/1096 = 90.7% carry a coupon vs. the existing table's 10,161/10,736 = 94.6% ABCD).
    // This is a heuristic, not a confirmed business rule -- flagged to the owner as such.
    const lobExplicit = cleanText(data["LOB"]);
    const lob = lobExplicit ?? (cleanText(data["Coupon Code"]) ? "ABCD" : "REPT");
    if (!orderId || amount === null) {
      const msg = `Row ${row.row_no}: an order number ("Order id" or "Shopify Order Name") and an amount ("Amount" or "Grand Total") are required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    // "Agents status" in the Shopify export is actually the agent's NAME (e.g. "S ABHINAV"),
    // not a status -- confirmed against the file's own real values. "Agent ID" -> EMP ID.
    const agentName = cleanText(data["Column 6"]) ?? cleanText(data["Agents status"]);
    const empId = cleanText(data["EMP ID"]) ?? cleanText(data["Agent ID"]);
    const orderDate = parseDate(data["Order Date "]) ?? parseDate(data["Date"]);
    const paymentType = cleanText(data["Payment Type "]) ?? cleanText(data["Payment Type"]);

    toInsert.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        randomUUID(), processId, orderId,
        cleanText(data["Order id "]),
        parseDateTime(data["Timestamp"]),
        amount, lob,
        orderDate,
        paymentType,
        agentName, normalizeName(agentName),
        cleanText(data["Column 1"]),
        empId,
        batchId,
        importedByUserId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO reginald_abandoned_cart_sales_raw
           (id, process_id, order_id, order_id_numeric, submitted_at, amount, lob, order_date,
            payment_type, agent_name, agent_name_norm, time_slot, emp_id, data_source,
            source_reference, created_by)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)",
    insertSuffix: `ON DUPLICATE KEY UPDATE
            amount = VALUES(amount),
            payment_type = VALUES(payment_type),
            time_slot = VALUES(time_slot)`,
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
