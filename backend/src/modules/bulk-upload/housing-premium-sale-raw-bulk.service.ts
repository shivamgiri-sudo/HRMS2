import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Housing Premium's "Sale Raw" (per its own SOP: "Open the Sale Raw Google
 * Sheet... paste the data into the Sale Raw sheet" -- no exact columns
 * given there, no DB backing). Columns read directly from a real sample:
 * "Housing Premium MIS Dashboard Aug'26 (1).xlsb", sheet "Sale Raw".
 *
 * The source carries two date-like columns: Created_At (an earlier date --
 * the original lead's creation) and Date (matching the file's own "Aug'26"
 * name -- the real sale/reporting date). "Date" is what report_date reads;
 * Created_At is kept only as an optional secondary field.
 */

export const HOUSING_PREMIUM_SALE_RAW_HEADERS = [
  "Order_ID",
  "Date",
  "Created_At",
  "Agent_Name",
  "TL_Name",
  "Partner_Name",
  "Amount",
  "Order_Value",
  "Target",
  "Week",
] as const;

/** amount is NOT NULL with a 0 default -- a blank cell means zero, not null. */
export function parseAmount(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** order_value/target are nullable: "not supplied" is not the same as zero. */
export function parseNullableAmount(raw: unknown): number | null {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The live source's date columns are plain Excel serials (no time-of-day
 * fraction, confirmed by reading the real workbook) -- Math.round is safe
 * here, unlike clovia-crm-disposition-bulk.service.ts's Date column.
 */
export function parseDate(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importHousingPremiumSaleRawBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Housing Premium' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Housing Premium" process found to attach this row to`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const orderId = String(data["Order_ID"] ?? "").trim();
    if (!orderId) {
      const msg = `Row ${row.row_no}: "Order_ID" is required — it is the row's identity`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const reportDate = parseDate(data["Date"]);
    if (!reportDate) {
      const msg = `Row ${row.row_no}: "Date" is required and could not be read`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    try {
      await db.execute(
        `INSERT INTO housing_premium_sale_raw
           (id, process_id, order_id, report_date, created_at_orig, agent_name, tl_name,
            partner_name, amount, order_value, target, week_label,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            created_at_orig = VALUES(created_at_orig),
            agent_name = VALUES(agent_name),
            tl_name = VALUES(tl_name),
            partner_name = VALUES(partner_name),
            amount = VALUES(amount),
            order_value = VALUES(order_value),
            target = VALUES(target),
            week_label = VALUES(week_label)`,
        [
          randomUUID(), processId, orderId, reportDate,
          parseDate(data["Created_At"]),
          String(data["Agent_Name"] ?? "").trim() || null,
          String(data["TL_Name"] ?? "").trim() || null,
          String(data["Partner_Name"] ?? "").trim() || null,
          parseAmount(data["Amount"]),
          parseNullableAmount(data["Order_Value"]),
          parseNullableAmount(data["Target"]),
          String(data["Week"] ?? "").trim() || null,
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
