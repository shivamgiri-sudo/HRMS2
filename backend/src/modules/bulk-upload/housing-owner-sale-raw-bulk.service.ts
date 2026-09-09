import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Housing Owner's "Sale Raw" (per its own SOP: "Open the Sale Raw Google
 * Sheet... Copy the required Sale data up to the Discount % column...
 * Paste the data into the Sale Raw sheet" -- no DB backing exists anywhere).
 * Columns read directly from a real sample: "Housing Owner Sep'26.xlsx",
 * sheet "Sale Raw" -- a plain .xlsx (not .xlsb), whose Date column already
 * comes back as a native datetime through openpyxl/the sheet's own export,
 * so no Excel-serial parsing is needed here.
 */

export const HOUSING_OWNER_SALE_RAW_HEADERS = [
  "Opp_ID",
  "Date",
  "Agent_ID",
  "Agent_Name",
  "TL_Name",
  "Value",
  "Count",
  "Payment_Mode",
  "Package_Name",
  "Package_Type",
  "Discount_Pct",
  "Week",
] as const;

/** value is NOT NULL with a 0 default -- a blank cell means zero, not null. */
export function parseAmount(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function parseNullableAmount(raw: unknown): number | null {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseCount(raw: unknown, fallback: number): number {
  const v = String(raw ?? "").trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

/**
 * The real sample's Date column is already a proper date (this source is a
 * plain .xlsx, unlike the .xlsb workbooks used for Housing Premium/Clovia),
 * but a bulk-upload row still arrives as text/serial through the CSV
 * pipeline, so both forms are handled defensively.
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
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
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

export async function importHousingOwnerSaleRawBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Housing Owner' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Housing Owner" process found to attach this row to`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const oppId = String(data["Opp_ID"] ?? "").trim();
    if (!oppId) {
      const msg = `Row ${row.row_no}: "Opp_ID" is required — it is the row's identity`;
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
        `INSERT INTO housing_owner_sale_raw
           (id, process_id, opp_id, report_date, agent_id, agent_name, tl_name,
            value, sale_count, payment_mode, package_name, package_type,
            discount_pct, week_label, data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            agent_id = VALUES(agent_id),
            agent_name = VALUES(agent_name),
            tl_name = VALUES(tl_name),
            value = VALUES(value),
            sale_count = VALUES(sale_count),
            payment_mode = VALUES(payment_mode),
            package_name = VALUES(package_name),
            package_type = VALUES(package_type),
            discount_pct = VALUES(discount_pct),
            week_label = VALUES(week_label)`,
        [
          randomUUID(), processId, oppId, reportDate,
          String(data["Agent_ID"] ?? "").trim() || null,
          String(data["Agent_Name"] ?? "").trim() || null,
          String(data["TL_Name"] ?? "").trim() || null,
          parseAmount(data["Value"]),
          parseCount(data["Count"], 1),
          String(data["Payment_Mode"] ?? "").trim() || null,
          String(data["Package_Name"] ?? "").trim() || null,
          String(data["Package_Type"] ?? "").trim() || null,
          parseNullableAmount(data["Discount_Pct"]),
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
