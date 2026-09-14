import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Reginald Men Abandoned Cart Dashboard's real Live Sales Google Form
 * export -- see sql/1752 for the cross-schema check confirming this is a
 * distinct dataset with no DB backing anywhere. The form's own export has
 * two mislabeled generic headers ("Column 6" = Agent Name, "Column 1" =
 * Time Slot); both are read here under those exact literal header strings
 * since that is what the real export actually contains.
 */

export const REGINALD_ABANDONED_CART_SALES_HEADERS = [
  "Timestamp", "Order id", "Amount", "LOB", "Order Date", "Payment Type",
  "Column 6", "Order id ", "Column 1", "EMP ID",
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

/** Handles both "9/10/2026 18:39:29" (Timestamp) and "9/10/2026"/"30-Apr-2026" (Order Date). */
export function parseDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const mSlash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (mSlash) {
    const [, m, d, y] = mSlash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const mDash = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(v);
  if (mDash) {
    const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const mon = months[mDash[2].toLowerCase()];
    if (mon) return `${mDash[3]}-${mon}-${mDash[1].padStart(2, "0")}`;
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
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Reginald' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  let importedRows = 0;
  let errorRows = 0;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "Reginald" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const orderId = cleanText(data["Order id"]);
    const amount = parseAmount(data["Amount"]);
    const lob = cleanText(data["LOB"]);
    if (!orderId || amount === null || !lob) {
      const msg = `Row ${row.row_no}: "Order id", "Amount" and "LOB" are all required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const agentName = cleanText(data["Column 6"]);
    try {
      await db.execute(
        `INSERT INTO reginald_abandoned_cart_sales_raw
           (id, process_id, order_id, order_id_numeric, submitted_at, amount, lob, order_date,
            payment_type, agent_name, agent_name_norm, time_slot, emp_id, data_source,
            source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            amount = VALUES(amount),
            payment_type = VALUES(payment_type),
            time_slot = VALUES(time_slot)`,
        [
          randomUUID(), processId, orderId,
          cleanText(data["Order id "]),
          parseDateTime(data["Timestamp"]),
          amount, lob,
          parseDate(data["Order Date "]),
          cleanText(data["Payment Type "]),
          agentName, normalizeName(agentName),
          cleanText(data["Column 1"]),
          cleanText(data["EMP ID"]),
          batchId,
          importedByUserId,
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
