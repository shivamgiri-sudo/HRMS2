/**
 * Bellavita Cart (db_masmis.bb_cart) check-and-insert.
 *
 * For each row's Cart ID ("ID" column): dedupe within the file (keep the
 * last occurrence), then insert only the ones not already in bb_cart. Never
 * updates existing rows -- unlike bb_sale, cart rows don't have an obvious
 * "status that changes after upload" field the user has asked to keep fresh.
 *
 * Column mapping matches bb-cart-masmis-bulk.service.ts's importBbCartMasmisBatch,
 * with one addition: Created At/Updated At/Dates/Call Date are converted from
 * raw Excel serials to "D-Mon-YY" text (confirmed against live bb_cart rows)
 * since that service's own mapper does no date parsing at all and expects the
 * browser upload pipeline to have already formatted them by the time they
 * reach normalized_data -- reading the xlsx directly here bypasses that step.
 */
import XLSX from "xlsx";
import { db } from "../../../src/db/mysql.js";

export interface CartUploadOptions { execute: boolean }
export interface CartUploadResult { totalRows: number; distinctInFile: number; alreadyInDb: number; inserted: number; errors: number }

function get(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== "") return String(data[k]).trim();
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function toDMonYY(raw: string): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 30000 || n > 80000) return raw;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
}

export async function runCartUpload(filePath: string, opts: CartUploadOptions): Promise<CartUploadResult> {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  console.log(`[cart] Read ${rows.length} rows from ${filePath}`);

  const withId = rows.map((r) => ({ r, cartId: get(r, "ID", "Cart ID", "cart_id") })).filter((x) => x.cartId);
  console.log(`[cart] Rows with a Cart ID: ${withId.length} (missing: ${rows.length - withId.length})`);
  const byId = new Map<string, (typeof withId)[number]>();
  for (const x of withId) byId.set(x.cartId, x);
  const deduped = [...byId.values()];
  console.log(`[cart] Distinct Cart IDs in file: ${deduped.length} (dupes within file: ${withId.length - deduped.length})`);

  const idArr = deduped.map((x) => x.cartId);
  const existing = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < idArr.length; i += CHUNK) {
    const chunk = idArr.slice(i, i + CHUNK);
    const [existRows] = await db.execute<any[]>(
      `SELECT DISTINCT cart_id FROM db_masmis.bb_cart WHERE cart_id IN (${chunk.map(() => "?").join(",")})`, chunk,
    );
    for (const r of existRows) existing.add(r.cart_id);
  }
  console.log(`[cart] Of file's distinct Cart IDs, already in bb_cart: ${existing.size}`);
  const newRows = deduped.filter((x) => !existing.has(x.cartId));
  console.log(`[cart] NEW (not yet imported): ${newRows.length}`);

  if (!opts.execute) {
    console.log("[cart] DRY RUN -- no writes made.");
    return { totalRows: rows.length, distinctInFile: deduped.length, alreadyInDb: existing.size, inserted: 0, errors: 0 };
  }

  let inserted = 0;
  let errors = 0;
  for (const { r, cartId } of newRows) {
    try {
      await db.execute(
        `INSERT INTO db_masmis.bb_cart
           (cc, source, sno, cart_id, created_at, updated_at, customer_name, customer_address,
            phone_number, email_id, line_items, variant_title, abandoned_cart_link, amount,
            phone_10_digit, dates, agent, disposition, sub_disposition, call_date,
            same_day_connect, status, uploaded_by, upload_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          get(r, "CC.", "CC", "cc") || null,
          get(r, "Source") || null,
          parseNullableInt(get(r, "S.no", "SNo")),
          cartId,
          toDMonYY(get(r, "Created At")),
          toDMonYY(get(r, "Updated At")),
          get(r, "Customer Name") || null,
          get(r, "Customer Address") || null,
          get(r, "Phone Number") || null,
          get(r, "Email ID") || null,
          get(r, "Line items", "Line Items") || null,
          get(r, "Variant title", "Variant Title") || null,
          get(r, "Abandoned Cart Link") || null,
          parseNullableDecimal(get(r, "Amount")),
          get(r, "Phone Number (10 Digit)", "Phone (10 Digit)") || null,
          toDMonYY(get(r, "Dates")),
          get(r, "Agent") || null,
          get(r, "Disposition") || null,
          get(r, "Sub Dispotion", "Sub Disposition") || null,
          toDMonYY(get(r, "Call Date")),
          get(r, "Same Day Connect") || null,
          get(r, "Status") || null,
          null, null,
        ],
      );
      inserted += 1;
    } catch (e) {
      console.warn(`[cart] Insert failed for cart_id ${cartId}:`, e instanceof Error ? e.message : e);
      errors += 1;
    }
  }

  if (inserted > 0) {
    await db.execute(
      `INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by) VALUES (UUID(), 'bb_cart', ?, ?, NULL)`,
      [filePath, inserted],
    );
  }

  console.log(`[cart] Done. Inserted ${inserted} rows (${errors} errors).`);
  return { totalRows: rows.length, distinctInFile: deduped.length, alreadyInDb: existing.size, inserted, errors };
}
