import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * GS1 India — Approval/Audit quality review raw log.
 *
 * Each row is one audited record: who was audited, who audited them, the
 * audit outcome (PASS/FAIL/PENDING), the error category if any, whether an
 * error was flagged, the GCP code and company name, and the SKU count reviewed.
 *
 * Real export ("GS1.xlsx", "Approval" sheet) is a much wider per-SKU QC log (89
 * columns: product/company/GTIN detail, images, AI validation, human QC fields).
 * Confirmed live: "Name" is who processed/verified the product, "Auditor" is who did
 * the final QC pass on that work, "Date of Completion" is populated on every row (a
 * more reliable audit-date source than "Allocation Date"/"Created at", which are
 * either constant-per-batch or a distant original-upload timestamp), "Approve/Reject"
 * is the direct pass/fail call, "Errors Yes/No" is the error flag, "Products count" is
 * the SKU count for that row (1 in every sampled real row -- one row = one product).
 * The old imagined "Audit Date/Auditee Name/.../SKU Count" 9-column format is still
 * tried first, so a hand-built file in that shape keeps working.
 *
 * Re-uploads of the same audit date are allowed — ON DUPLICATE KEY UPDATE
 * overwrites all mutable columns so corrections land cleanly.
 *
 * Upload type: GS1_APPROVAL_AUDIT
 * Target table: gs1_approval_audit_raw
 * UNIQUE key: (process_id, audit_date, auditee_name, auditor_name)
 */

export const GS1_APPROVAL_AUDIT_HEADERS = [
  "Audit Date", "Auditee Name", "Auditor Name", "Audit Result", "Error Category",
  "Error Flag", "GCP Code", "Company Name", "SKU Count",
  "GCP", "Name", "Auditor", "Approve/Reject", "Errors Yes/No",
  "Date of Completion", "Products count",
] as const;

const AUDIT_RESULT_MAP: Record<string, "PASS" | "FAIL" | "PENDING"> = {
  pass: "PASS",
  passed: "PASS",
  ok: "PASS",
  approve: "PASS",
  approved: "PASS",
  fail: "FAIL",
  failed: "FAIL",
  error: "FAIL",
  reject: "FAIL",
  rejected: "FAIL",
  pending: "PENDING",
  review: "PENDING",
  hold: "PENDING",
};

export function parseDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
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
  // "1-Sep-26" (2-digit year) -- the real Approval export's "Date of Completion" column
  // (confirmed live), assumed 20xx.
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `20${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export function parseCount(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export function parseErrorFlag(raw: unknown): number {
  const v = String(raw ?? "").trim().toUpperCase();
  return v === "YES" || v === "1" || v === "TRUE" || v === "ERROR" ? 1 : 0;
}

export function normalizeAuditResult(raw: unknown): "PASS" | "FAIL" | "PENDING" {
  const v = String(raw ?? "").trim().toLowerCase();
  return AUDIT_RESULT_MAP[v] ?? "PENDING";
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importGs1ApprovalAuditBatch(
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
    "SELECT id FROM process_master WHERE process_name LIKE '%GS1%' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active GS1 process found in process_master`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    // "Date of Completion" is the real export's reliable per-row date (confirmed populated
    // on every real row); "Allocation Date"/"Created at" are batch-constant or a distant
    // original-upload timestamp, not this audit event's own date.
    const auditDate = parseDate(data["Audit Date"]) ?? parseDate(data["Date of Completion"]);
    if (!auditDate) {
      const msg = `Row ${row.row_no}: an audit date ("Audit Date" or "Date of Completion") is required and could not be parsed`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    // "Name" is who processed/verified the product; that is the person whose work this
    // audit event is auditing.
    const auditeeName = String(data["Auditee Name"] ?? data["Name"] ?? "").trim();
    if (!auditeeName) {
      const msg = `Row ${row.row_no}: an auditee ("Auditee Name" or "Name") is required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    // "Auditor" is who did the final QC pass on that work.
    const auditorName = String(data["Auditor Name"] ?? data["Auditor"] ?? "").trim();
    if (!auditorName) {
      const msg = `Row ${row.row_no}: an auditor ("Auditor Name" or "Auditor") is required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    // "Approve/Reject" is the real export's direct pass/fail call.
    const auditResult = data["Audit Result"] !== undefined
      ? normalizeAuditResult(data["Audit Result"])
      : normalizeAuditResult(data["Approve/Reject"]);
    const errorFlag = data["Error Flag"] !== undefined
      ? parseErrorFlag(data["Error Flag"])
      : parseErrorFlag(data["Errors Yes/No"]);
    const gcpCode = String(data["GCP Code"] ?? data["GCP"] ?? "").trim() || null;
    // "Products count" is the real export's per-row SKU count (1 on every sampled real
    // row -- one row = one product); default to 1 rather than 0 when genuinely absent,
    // since a raw per-product audit row that exists at all audited at least one SKU.
    const skuCountRaw = data["SKU Count"] ?? data["Products count"];
    const skuCount = skuCountRaw !== undefined ? (parseCount(skuCountRaw) || 1) : 0;

    try {
      await db.execute(
        `INSERT INTO gs1_approval_audit_raw
           (id, process_id, audit_date, auditee_name, auditor_name,
            audit_result, error_category, error_flag, gcp_code, company_name, sku_count,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            audit_result   = VALUES(audit_result),
            error_category = VALUES(error_category),
            error_flag     = VALUES(error_flag),
            gcp_code       = VALUES(gcp_code),
            company_name   = VALUES(company_name),
            sku_count      = VALUES(sku_count)`,
        [
          randomUUID(), processId, auditDate, auditeeName, auditorName,
          auditResult,
          String(data["Error Category"] ?? "").trim() || null,
          errorFlag,
          gcpCode,
          String(data["Company Name"] ?? "").trim() || null,
          skuCount,
          batchId,
          importedByUserId,
        ] as never[],
      );
      await db.execute(`UPDATE upload_batch_row SET row_status = 'imported' WHERE id = ?`, [row.id]);
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

  const finalStatus =
    errorRows === 0 ? "imported" : importedRows === 0 ? "validation_failed" : "imported_with_errors";
  await db.execute(
    `UPDATE upload_batch SET batch_status = ?, imported_rows = ?, error_rows = ? WHERE id = ?`,
    [finalStatus, importedRows, errorRows, batchId],
  );

  return { importedRows, errorRows, errors };
}
