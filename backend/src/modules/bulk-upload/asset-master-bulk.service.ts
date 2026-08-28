import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}

interface ParsedRow {
  rowId: string;
  rowNo: number;
  assetCode: string;
  assetName: string;
  category: string;
  status: string;
  assetType: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  vendor: string | null;
  warrantyExpiry: string | null;
  notes: string | null;
  branchCode: string | null;
}

const CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Mirrors asset_master.status's live ENUM exactly.
const VALID_STATUSES = new Set(["available", "assigned", "maintenance", "repair", "retired", "lost"]);

export async function importAssetMasterBatch(
  batchId: string,
  importedByUserId: string
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId]
  );

  if (batchRows.length === 0) {
    return { importedRows: 0, errorRows: 0, errors: [] };
  }

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];
  let errorRows = 0;
  const errorUpdates: Array<{ rowId: string; message: string }> = [];
  const branchCodes = new Set<string>();

  for (const row of batchRows) {
    const data =
      typeof row.normalized_data === "string"
        ? JSON.parse(row.normalized_data)
        : (row.normalized_data ?? {});

    const assetCode = String(data.asset_code ?? "").trim();
    const assetName = String(data.asset_name ?? "").trim();
    // The template's required category column is asset_category, not category —
    // reading the wrong key meant every uploaded category was discarded in favour
    // of the literal string "General", even once the INSERT itself is fixed below.
    const category = String(data.asset_category ?? "").trim();

    if (!assetCode || !assetName || !category) {
      const msg = `Row ${row.row_no}: asset_code, asset_name and asset_category are required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const statusRaw = String(data.status ?? "").trim().toLowerCase();
    if (!statusRaw || !VALID_STATUSES.has(statusRaw)) {
      const msg = `Row ${row.row_no}: status "${data.status ?? ""}" must be one of ${[...VALID_STATUSES].sort().join(", ")}`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const branchCode = data.branch_code ? String(data.branch_code).trim() : null;
    if (branchCode) branchCodes.add(branchCode);

    parsed.push({
      rowId: row.id, rowNo: row.row_no, assetCode, assetName, category, status: statusRaw,
      assetType: data.asset_type ? String(data.asset_type).trim() : null,
      serialNumber: data.serial_number ? String(data.serial_number).trim() : null,
      // The template's cost column is purchase_cost, not cost — same class of
      // key-name mismatch as asset_category above.
      purchaseDate: data.purchase_date ? String(data.purchase_date).slice(0, 10) : null,
      purchaseCost: data.purchase_cost ? parseFloat(String(data.purchase_cost)) : null,
      vendor: data.vendor ? String(data.vendor).trim() : null,
      warrantyExpiry: data.warranty_expiry ? String(data.warranty_expiry).slice(0, 10) : null,
      notes: data.notes ? String(data.notes).trim() : null,
      branchCode,
    });
  }

  // One bulk lookup covering every branch_code referenced in the file, instead of
  // up to one SELECT per row.
  const branchIdByCode = new Map<string, string>();
  if (branchCodes.size > 0) {
    const codes = Array.from(branchCodes);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, branch_code FROM branch_master WHERE branch_code IN (${codes.map(() => "?").join(",")})`,
      codes
    );
    for (const r of rows) branchIdByCode.set(r.branch_code as string, r.id as string);
  }

  let importedRows = 0;
  const importedRowIds: string[] = [];

  // Chunked multi-row upsert instead of one INSERT per row. If a chunk's
  // statement fails (a constraint violation on one of its rows), that chunk
  // alone is retried row-by-row so only the actually-bad row ends up marked
  // as an error — every other row in the batch still lands, matching the
  // original per-row loop's error isolation.
  for (const rowsInChunk of chunk(parsed, CHUNK_SIZE)) {
    const placeholders = rowsInChunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?)").join(", ");
    const params = rowsInChunk.flatMap((r) => [
      r.assetCode, r.assetName, r.category, r.assetType, r.serialNumber,
      r.purchaseDate, r.purchaseCost, r.vendor, r.warrantyExpiry, r.notes,
      r.branchCode ? branchIdByCode.get(r.branchCode) ?? null : null,
      r.status,
    ]);

    try {
      await db.execute(
        // asset_condition/asset_status were never real columns on asset_master —
        // every row of every ASSET_MASTER upload failed with ER_BAD_FIELD_ERROR
        // before this fix, live-confirmed via PREPARE (consistent with the live
        // table holding 0 rows system-wide). The real status column is `status`,
        // and it — along with asset_type/vendor/warranty_expiry/notes/branch_code,
        // all template-declared optional columns — was never read from the
        // uploaded row at all; status was hardcoded to 'available' regardless of
        // what the file said.
        `INSERT INTO asset_master
           (asset_code, asset_name, asset_category, asset_type, serial_number,
            purchase_date, purchase_cost, vendor, warranty_expiry, notes, branch_id, status)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           asset_name = VALUES(asset_name),
           asset_category = VALUES(asset_category),
           asset_type = COALESCE(VALUES(asset_type), asset_type),
           serial_number = COALESCE(VALUES(serial_number), serial_number),
           purchase_date = COALESCE(VALUES(purchase_date), purchase_date),
           purchase_cost = COALESCE(VALUES(purchase_cost), purchase_cost),
           vendor = COALESCE(VALUES(vendor), vendor),
           warranty_expiry = COALESCE(VALUES(warranty_expiry), warranty_expiry),
           notes = COALESCE(VALUES(notes), notes),
           branch_id = COALESCE(VALUES(branch_id), branch_id),
           status = VALUES(status)`,
        params
      );
      for (const r of rowsInChunk) {
        importedRowIds.push(r.rowId);
        importedRows++;
      }
    } catch {
      for (const r of rowsInChunk) {
        try {
          await db.execute(
            `INSERT INTO asset_master
               (asset_code, asset_name, asset_category, asset_type, serial_number,
                purchase_date, purchase_cost, vendor, warranty_expiry, notes, branch_id, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               asset_name = VALUES(asset_name),
               asset_category = VALUES(asset_category),
               asset_type = COALESCE(VALUES(asset_type), asset_type),
               serial_number = COALESCE(VALUES(serial_number), serial_number),
               purchase_date = COALESCE(VALUES(purchase_date), purchase_date),
               purchase_cost = COALESCE(VALUES(purchase_cost), purchase_cost),
               vendor = COALESCE(VALUES(vendor), vendor),
               warranty_expiry = COALESCE(VALUES(warranty_expiry), warranty_expiry),
               notes = COALESCE(VALUES(notes), notes),
               branch_id = COALESCE(VALUES(branch_id), branch_id),
               status = VALUES(status)`,
            [r.assetCode, r.assetName, r.category, r.assetType, r.serialNumber,
             r.purchaseDate, r.purchaseCost, r.vendor, r.warrantyExpiry, r.notes,
             r.branchCode ? branchIdByCode.get(r.branchCode) ?? null : null,
             r.status]
          );
          importedRowIds.push(r.rowId);
          importedRows++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Row ${r.rowNo}: ${msg}`);
          errorUpdates.push({ rowId: r.rowId, message: msg.slice(0, 500) });
          errorRows++;
        }
      }
    }
  }

  if (importedRowIds.length > 0) {
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'imported'
       WHERE id IN (${importedRowIds.map(() => "?").join(",")})`,
      importedRowIds
    );
  }
  if (errorUpdates.length > 0) {
    const cases = errorUpdates.map(() => "WHEN ? THEN ?").join(" ");
    const caseParams = errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]);
    const ids = errorUpdates.map((u) => u.rowId);
    await db.execute(
      `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      [...caseParams, ...ids]
    );
  }

  const finalStatus =
    errorRows === 0
      ? "imported"
      : importedRows === 0
      ? "validation_failed"
      : "imported_with_errors";

  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId]
  );

  return { importedRows, errorRows, errors };
}
