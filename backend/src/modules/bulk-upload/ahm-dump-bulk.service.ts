import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { chunkedMasmisInsert, type ChunkInsertRow } from "./masmis-chunked-insert.js";

/**
 * AHM "Dump" -- writes into db_masmis.ahm_dump_raw (sql/1875). One row per outlet/SKU order
 * line: a telesales agent takes the survey/order, a delivery agent fulfils it. Source: the
 * two real files the user supplied ("02 Oct Dump MP.xlsx", "03 Oct Dump MM.xlsx"), same
 * 43-column shape -- columns confirmed directly against those files, not guessed.
 *
 * Row identity: (Sales No, Product Code) -- Sales No is the order id, repeating once per SKU
 * line within an order; verified every sampled order's (Sales No, Product Code) pair is
 * unique. Upserts on re-upload / overlapping ranges rather than duplicating.
 *
 * Survey Date / Delivery Date: the source stores an unset Delivery Date as the literal
 * "0000-00-00 00:00:00" -- parseAhmDateTime() maps that (and any other unparsable value) to
 * null, never a guessed date. Both accept a JS Date (what the client's cellDates:true parse
 * produces), an ISO string, or an Excel day-serial number, covering however the staged JSON
 * ends up representing the cell.
 */

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getByColumn(data: Record<string, unknown>, ...columnNames: string[]): unknown {
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(data)) normalized[normalizeKey(k)] = data[k];
  for (const col of columnNames) {
    const v = normalized[normalizeKey(col)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}
function str(data: Record<string, unknown>, ...columnNames: string[]): string | null {
  const v = getByColumn(data, ...columnNames);
  return v === null ? null : String(v).trim() || null;
}
/** Strips a trailing ".0" a float-ish phone/code number can pick up once JSON round-trips it. */
function strNum(data: Record<string, unknown>, ...columnNames: string[]): string | null {
  const v = getByColumn(data, ...columnNames);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(v).trim() || null;
}
function intVal(data: Record<string, unknown>, ...columnNames: string[]): number {
  const v = getByColumn(data, ...columnNames);
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function intOrNull(data: Record<string, unknown>, ...columnNames: string[]): number | null {
  const v = getByColumn(data, ...columnNames);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function decimalOrNull(data: Record<string, unknown>, ...columnNames: string[]): number | null {
  const v = getByColumn(data, ...columnNames);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const ZERO_DATE_RE = /^0000-00-00/;

/** JS Date | ISO-ish string | Excel day-serial number -> "YYYY-MM-DD HH:MM:SS", or null for
 * anything unparsable (including the source's own "0000-00-00 00:00:00" unset-date sentinel). */
function parseAhmDateTime(data: Record<string, unknown>, ...columnNames: string[]): string | null {
  const v = getByColumn(data, ...columnNames);
  if (v === null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 19).replace("T", " ");
  }
  const s = String(v).trim();
  if (!s || ZERO_DATE_RE.test(s)) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(EXCEL_EPOCH_MS + Math.round(Number(s) * 86400000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace("T", " ");
  }
  const d = new Date(s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace("T", " ");
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

const COLUMNS = `
  process_id, source_region, region, state, gpi_state, zone, city_town, wd_code, wd_name,
  sales_no, survey_date, category, franchise, salesman, owner_type, outlet_id, outlet_name,
  address, phone_number, route_name, class_of_outlet, type_of_outlet, product_code,
  product_sku, product_batch, sku_mrp, survey_qty, survey_offer_qty, sales_qty,
  sales_offer_qty, outlet_description, delivery_date, phone_no, locality, coverage_frequency,
  delivered_by, last_status, telesales_id, telesales_type, suggested_quantity,
  last_disposition_status, product_shortname, scheme_description, free_sku_name,
  ts_interface, user_identity, upload_batch_id, created_by`;

const UPSERT = `ON DUPLICATE KEY UPDATE
  source_region = VALUES(source_region), region = VALUES(region), state = VALUES(state),
  gpi_state = VALUES(gpi_state), zone = VALUES(zone), city_town = VALUES(city_town),
  wd_code = VALUES(wd_code), wd_name = VALUES(wd_name), survey_date = VALUES(survey_date),
  category = VALUES(category), franchise = VALUES(franchise), salesman = VALUES(salesman),
  owner_type = VALUES(owner_type), outlet_id = VALUES(outlet_id), outlet_name = VALUES(outlet_name),
  address = VALUES(address), phone_number = VALUES(phone_number), route_name = VALUES(route_name),
  class_of_outlet = VALUES(class_of_outlet), type_of_outlet = VALUES(type_of_outlet),
  product_sku = VALUES(product_sku), product_batch = VALUES(product_batch), sku_mrp = VALUES(sku_mrp),
  survey_qty = VALUES(survey_qty), survey_offer_qty = VALUES(survey_offer_qty),
  sales_qty = VALUES(sales_qty), sales_offer_qty = VALUES(sales_offer_qty),
  outlet_description = VALUES(outlet_description), delivery_date = VALUES(delivery_date),
  phone_no = VALUES(phone_no), locality = VALUES(locality), coverage_frequency = VALUES(coverage_frequency),
  delivered_by = VALUES(delivered_by), last_status = VALUES(last_status), telesales_id = VALUES(telesales_id),
  telesales_type = VALUES(telesales_type), suggested_quantity = VALUES(suggested_quantity),
  last_disposition_status = VALUES(last_disposition_status), product_shortname = VALUES(product_shortname),
  scheme_description = VALUES(scheme_description), free_sku_name = VALUES(free_sku_name),
  ts_interface = VALUES(ts_interface), user_identity = VALUES(user_identity),
  upload_batch_id = VALUES(upload_batch_id), created_by = VALUES(created_by)`;

async function importBatch(
  batchId: string,
  importedByUserId: string,
  sourceRegion: "MP" | "MM",
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'AHM' AND active_status = 1 LIMIT 1",
  );
  const processId = procRows[0]?.id ?? null;

  const errors: string[] = [];
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const insertRows: ChunkInsertRow[] = [];

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : ((row.normalized_data ?? {}) as Record<string, unknown>);

    if (!processId) {
      const msg = `Row ${row.row_no}: no active "AHM" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    const salesNo = strNum(data, "Sales No");
    if (!salesNo) {
      const msg = `Row ${row.row_no}: "Sales No" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    const outletId = str(data, "Outlet ID");
    if (!outletId) {
      const msg = `Row ${row.row_no}: "Outlet ID" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }
    const productCode = str(data, "Product Code");
    if (!productCode) {
      const msg = `Row ${row.row_no}: "Product Code" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); continue;
    }

    insertRows.push({
      rowId: row.id,
      rowNo: row.row_no,
      values: [
        processId, sourceRegion,
        str(data, "Region"), str(data, "State"), str(data, "GPI State"), str(data, "Zone"),
        str(data, "City (TOWN)", "City"), str(data, "WD Code"), str(data, "WD Name"),
        salesNo, parseAhmDateTime(data, "Survey Date"),
        str(data, "Category"), str(data, "Franchise"), str(data, "Salesman"), str(data, "Owner Type"),
        outletId, str(data, "Outlet Name"), str(data, "Address"), strNum(data, "Phone Number"),
        str(data, "Route Name"), str(data, "Class of Outlet"), str(data, "Type of Outlet"),
        productCode, str(data, "Product SKU"), str(data, "Product Batch"), decimalOrNull(data, "SKU MRP"),
        intVal(data, "Survey Qty"), intVal(data, "Survey Offer Qty"),
        intVal(data, "Sales Qty"), intVal(data, "Sales Offer Qty"),
        str(data, "Outlet Description"), parseAhmDateTime(data, "Delivery Date"),
        strNum(data, "Phone No"), str(data, "Locality"), str(data, "Coverage Frequency"),
        str(data, "Delivered By"), str(data, "Last Status"), str(data, "Telesales ID"),
        str(data, "Telesales Type"), intOrNull(data, "Suggested Quantity"),
        str(data, "Last disposition Status"), str(data, "Product ShortName"),
        str(data, "Scheme Description"), str(data, "Free SKU name"),
        str(data, "TS Interface"), str(data, "User Identity"),
        batchId, importedByUserId || null,
      ],
    });
  }

  const placeholders = COLUMNS.split(",").map(() => "?").join(", ");
  const inserted = await chunkedMasmisInsert({
    insertPrefix: `INSERT INTO db_masmis.ahm_dump_raw (${COLUMNS})`,
    placeholderGroup: `(${placeholders})`,
    rows: insertRows,
    insertSuffix: UPSERT,
  });
  const importedRows = inserted.importedRows;
  errorUpdates.push(...inserted.errorUpdates);
  for (const u of inserted.errorUpdates) errors.push(u.message);
  const errorRows = errorUpdates.length;

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

export async function importAhmDumpMpBatch(batchId: string, importedByUserId: string) {
  return importBatch(batchId, importedByUserId, "MP");
}
export async function importAhmDumpMmBatch(batchId: string, importedByUserId: string) {
  return importBatch(batchId, importedByUserId, "MM");
}
