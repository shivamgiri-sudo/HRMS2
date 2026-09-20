import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Housing Owner's "Owner Sale" export -- writes into the NEW db_masmis.owner_sale
 * table (sql/1766), a separate, simpler table from the existing, more
 * sophisticated housing_owner_sale_raw (mas_hrms, see
 * housing-owner-sale-raw-bulk.service.ts) -- kept deliberately separate per
 * explicit user confirmation after being shown the overlap.
 *
 * Column set confirmed directly against the real file the user supplied
 * (C:\Users\MAS60358\Desktop\Housing Premium\Owner_Sale.xlsx, and the
 * "Sale Raw" sheet of "Housing Owner Sep'26 Sale.xlsx", 430 real rows,
 * identical header set): Date, Agent ID, Agent Name, Value, Count,
 * Payment Mode, Package Name, Package Type, Opp ID, Discount %, TL Name,
 * Week, Month, Day, AM. Header matching is normalized
 * (case/space/separator-stripped), same lesson as every upload type built
 * without a real sample -- but "Discount %" needs an explicit alias
 * regardless, since the normalizer strips "%" as non-alphanumeric, so
 * "Discount %" reduces to "discount", not "discountpct" the way
 * "Discount_Pct" does -- those two would never have matched each other.
 */

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getByColumn(data: Record<string, unknown>, ...columnNames: string[]): string {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const col of columnNames) {
    const v = normalized[normalizeKey(col)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function n(data: Record<string, unknown>, ...columnNames: string[]): string | null {
  const v = getByColumn(data, ...columnNames);
  return v || null;
}

/** value is inserted with a 0 default -- a blank cell means zero, not null. */
function parseAmount(raw: string): number {
  const v = raw.replace(/,/g, "");
  if (!v) return 0;
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
}
function parseNullableAmount(raw: string): number | null {
  const v = raw.replace(/,/g, "");
  if (!v) return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}
function parseCount(raw: string, fallback: number): number {
  if (!raw) return fallback;
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : fallback;
}

/** Same proven date logic as housing-owner-sale-raw-bulk.service.ts's own parseDate:
 * Excel serial, ISO, or M/D/YYYY. */
function parseDate(raw: string): string | null {
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(raw)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return m[0];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importOwnerSaleBatch(
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
  const toInsert: ChunkInsertRow[] = [];

  const uploadedByInt = /^\d+$/.test(importedByUserId) ? Number(importedByUserId) : null;

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    const oppId = getByColumn(data, "Opp ID", "Opp_ID", "opp_id");
    if (!oppId) {
      const msg = `Row ${row.row_no}: "Opp ID" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id, rowNo: row.row_no,
      values: [
        oppId, parseDate(getByColumn(data, "Date", "report_date")),
        n(data, "Agent ID", "Agent_ID", "agent_id"), n(data, "Agent Name", "Agent_Name", "agent_name"),
        n(data, "TL Name", "TL_Name", "tl_name"), parseAmount(getByColumn(data, "Value", "value")),
        parseCount(getByColumn(data, "Count", "sale_count"), 1),
        n(data, "Payment Mode", "Payment_Mode", "payment_mode"),
        n(data, "Package Name", "Package_Name", "package_name"),
        n(data, "Package Type", "Package_Type", "package_type"),
        parseNullableAmount(getByColumn(data, "Discount %", "Discount_Pct", "discount_pct")),
        n(data, "Week", "week"), n(data, "Month", "month"), n(data, "Day", "day"), n(data, "AM", "am"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.owner_sale
       (opp_id, report_date, agent_id, agent_name, tl_name, value, sale_count,
        payment_mode, package_name, package_type, discount_pct, week, month, day, am,
        uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'owner_sale', ?, ?, NULL)`,
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
