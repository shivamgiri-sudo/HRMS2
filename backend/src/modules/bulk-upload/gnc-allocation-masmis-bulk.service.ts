import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * GNC's real "Allocation" export -- the 3rd of GNC's 3 real My Dashboards
 * upload types (Sale and APR shipped earlier). Writes into the SAME
 * already-live db_masmis.gnc_allocation table (60,375 real rows, most
 * recent upload 2026-05-31) the separate My Dashboards tool already uses.
 * Live schema matches the doc exactly -- no drift found here.
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
function parseNullableDecimal(v: string): number | null {
  const num = parseFloat(v);
  return Number.isFinite(num) ? num : null;
}

const MONTH_ABBREVIATIONS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Excel serial or plain text date -> "YYYY-MM-DD". Also handles "D-Mon-YY"
 * (e.g. "29-May-26") -- BellavitaMasmisUploader.tsx parses every file with
 * `raw: false`, which turns a date cell into that formatted text, not the
 * numeric serial this function otherwise expects; confirmed as the real
 * format via GNC_SALE_MASMIS's own catalog sample_row ("29-May-26"), the
 * sibling GNC upload type staged through the identical code path. */
export function parseGncAllocationDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "0" || v === "-") return null;
  const sn = parseFloat(v);
  if (Number.isFinite(sn) && sn > 40000 && sn < 60000 && /^\d+(\.\d+)?$/.test(v)) {
    const d = new Date((sn - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  m = /^(\d{1,2})-([A-Za-z]{3,})-(\d{2,4})$/.exec(v);
  if (m) {
    const mon = MONTH_ABBREVIATIONS[m[2].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${mon}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/** "created_at" is a DATETIME column, not just a date, and the real file carries two
 * different source formats depending on which storefront the order came from: Shopify's
 * "YYYY-MM-DD HH:MM:SS +ZZZZ" and Gokwik's "M/D/YY H:MM". Confirmed live: the 60,375
 * existing rows already store plain naive "YYYY-MM-DD HH:MM:SS" text with no offset, so
 * a trailing Shopify offset is stripped here to match, not converted -- this is not a
 * UTC normalization. */
export function parseGncAllocationDateTime(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "0" || v === "-") return null;

  let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(v);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    return `${y}-${mo}-${d} ${h.padStart(2, "0")}:${mi}:${(s ?? "00").padStart(2, "0")}`;
  }

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}) (\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(v);
  if (m) {
    const [, mo, d, y, h, mi, s] = m;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")} ${h.padStart(2, "0")}:${mi}:${(s ?? "00").padStart(2, "0")}`;
  }

  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

export async function importGncAllocationMasmisBatch(
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
  const insertRows: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    // Key aliases here are load-bearing, same lesson as gnc-apr-masmis-bulk.service.ts:
    // upload_template_master's canonical snake_case names never matched what the real
    // file (and BellavitaMasmisUploader.tsx's pass-through staging) actually produce --
    // the raw headers below, in the exact order the real export uses. The file has TWO
    // columns literally named "Date" (allocation date, then a callback date); SheetJS's
    // sheet_to_json (confirmed live against this project's installed xlsx@0.18.5)
    // deduplicates repeats by suffixing "_1", "_2", ... so the second one arrives as
    // "Date_1", not a second "Date" that would silently clobber the first.
    const uid = get(data, "UID", "uid");
    if (!uid) {
      const msg = `Row ${row.row_no}: "uid" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        uid, parseGncAllocationDate(get(data, "Date", "alloc_date")), n(data, "Helper", "helper"),
        n(data, "Data Type", "date_type"), n(data, "Time Slot", "time_slot"), n(data, "Store", "store"),
        n(data, "Name", "customer_name"), n(data, "Email", "email"), parseNullableDecimal(get(data, "Total", "total")),
        parseGncAllocationDateTime(get(data, "Created at", "created_at")), n(data, "Lineitem name", "lineitem_name"), n(data, "Lineitem sku", "lineitem_sku"),
        n(data, "Shipping Name", "shipping_name"), n(data, "Shipping Street", "shipping_street"), n(data, "Shipping City", "shipping_city"),
        n(data, "Shipping Zip", "shipping_zip"), n(data, "ShippingPhone", "shipping_phone"), n(data, "Agent", "emp_id"),
        n(data, "Disposition", "calling_status"), n(data, "SUB SCENARIOS 1", "sub_scenarios_1"),
        parseGncAllocationDate(get(data, "Date_1", "callback_date")),
        n(data, "Same Day Connnect", "same_day_connect"), n(data, "NC Connect", "nc_connect"),
        null, batchId,
      ],
    });
  }

  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.gnc_allocation
       (uid, alloc_date, helper, date_type, time_slot, store, customer_name, email, total,
        created_at, lineitem_name, lineitem_sku, shipping_name, shipping_street, shipping_city,
        shipping_zip, shipping_phone, emp_id, calling_status, sub_scenarios_1, callback_date,
        same_day_connect, nc_connect, uploaded_by, upload_batch_id)`,
    placeholderGroup: "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    rows: insertRows,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

  if (importedRows > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
       VALUES (?, 'gnc_allocation', ?, ?, NULL)`,
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

  // Same convention as every other importer in this module (e.g. employee-master-bulk.service.ts)
  // -- this was missing here, which is why a completed batch stayed stuck at 'importing' forever
  // regardless of outcome instead of ever reaching a terminal status.
  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
