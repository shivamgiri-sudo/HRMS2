import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * Housing Premium's "Premium Sale" export -- writes into the NEW
 * db_masmis.pre_sale table (sql/1766), a separate, simpler table from the
 * existing, more sophisticated housing_premium_sale_raw-equivalent (mas_hrms,
 * see housing-premium-sale-raw-bulk.service.ts) -- kept deliberately
 * separate per explicit user confirmation after being shown the overlap.
 *
 * Column set mirrors HOUSING_PREMIUM_SALE_RAW_HEADERS (that sibling
 * service's own VERIFIED real header list, read off "Housing Premium MIS
 * Dashboard Aug'26 (1).xlsb"), so the date/amount parsing logic below is
 * the same proven logic, not a guess -- but that list used underscores
 * ("Order_ID"), while every other real Housing Owner/Premium file the user
 * supplied this session (Owner_Sale.xlsx, Owner_Cdrapr.xlsx,
 * Owner_AgentDetails.xlsx, Premium_CDR.xlsx, Premum_Agent Details.xlsx)
 * uses space-separated headers instead ("Opp ID", "Agent Name", ...). Both
 * forms are aliased defensively for that reason -- no direct Premium Sale
 * sample was available to confirm which this specific export uses.
 * Header matching is normalized (case/space/separator-stripped) on top of
 * that -- see aw-mandate-bulk.service.ts's own comment. month/day/am
 * mirror the extra columns confirmed present in every sibling Sale file.
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

/** amount is inserted with a 0 default -- a blank cell means zero, not null. */
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

/** The real source's date columns are plain Excel serials, per
 * housing-premium-sale-raw-bulk.service.ts's own confirmed finding. Also
 * handles ISO/M-D-Y text defensively, same as owner-sale-bulk.service.ts. */
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

export async function importPreSaleBatch(
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

    const orderId = getByColumn(data, "Order ID", "Order_ID", "order_id");
    if (!orderId) {
      const msg = `Row ${row.row_no}: "Order ID" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    toInsert.push({
      rowId: row.id, rowNo: row.row_no,
      values: [
        orderId, parseDate(getByColumn(data, "Date", "report_date")),
        parseDate(getByColumn(data, "Created At", "Created_At", "created_date")),
        n(data, "Agent Name", "Agent_Name", "agent_name"), n(data, "TL Name", "TL_Name", "tl_name"),
        n(data, "Partner Name", "Partner_Name", "partner_name"),
        parseAmount(getByColumn(data, "Amount", "amount")),
        parseNullableAmount(getByColumn(data, "Order Value", "Order_Value", "order_value")),
        parseNullableAmount(getByColumn(data, "Target", "target")),
        n(data, "Week", "week"), n(data, "Month", "month"), n(data, "Day", "day"), n(data, "AM", "am"),
        uploadedByInt, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.pre_sale
       (order_id, report_date, created_date, agent_name, tl_name, partner_name,
        amount, order_value, target, week, month, day, am, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: toInsert,
  });
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const importedRows = inserted.importedRows;
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'pre_sale', ?, ?, NULL)`,
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
