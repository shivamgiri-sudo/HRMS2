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
 * Re-uploads of the same audit date are allowed — ON DUPLICATE KEY UPDATE
 * overwrites all mutable columns so corrections land cleanly.
 *
 * Upload type: GS1_APPROVAL_AUDIT
 * Target table: gs1_approval_audit_raw
 * UNIQUE key: (process_id, audit_date, auditee_name, auditor_name)
 */

export const GS1_APPROVAL_AUDIT_HEADERS = [
  "Audit Date",
  "Auditee Name",
  "Auditor Name",
  "Audit Result",
  "Error Category",
  "Error Flag",
  "GCP Code",
  "Company Name",
  "SKU Count",
] as const;

const AUDIT_RESULT_MAP: Record<string, "PASS" | "FAIL" | "PENDING"> = {
  pass: "PASS",
  passed: "PASS",
  ok: "PASS",
  fail: "FAIL",
  failed: "FAIL",
  error: "FAIL",
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
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

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

    const auditDate = parseDate(data["Audit Date"]);
    if (!auditDate) {
      const msg = `Row ${row.row_no}: "Audit Date" is required and could not be parsed`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const auditeeName = String(data["Auditee Name"] ?? "").trim();
    if (!auditeeName) {
      const msg = `Row ${row.row_no}: "Auditee Name" is required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const auditorName = String(data["Auditor Name"] ?? "").trim();
    if (!auditorName) {
      const msg = `Row ${row.row_no}: "Auditor Name" is required`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

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
          normalizeAuditResult(data["Audit Result"]),
          String(data["Error Category"] ?? "").trim() || null,
          parseErrorFlag(data["Error Flag"]),
          String(data["GCP Code"] ?? "").trim() || null,
          String(data["Company Name"] ?? "").trim() || null,
          parseCount(data["SKU Count"]),
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
