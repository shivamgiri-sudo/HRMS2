import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * LP's "10. CR Reports" (per its own SOP: "Open BPO Panel... Select
 * Mascallnet NRGN Call History... Paste into CR Reports sheet" -- no DB
 * backing exists). Columns read verbatim from two real samples: "Lp
 * Regional Sale Dashboard July26.xlsx" and "Lp Non Regional Dashboard
 * July'26.xlsx", sheet "CR Report".
 *
 * The sibling "11. CDR" sheet (lp_cdr_raw) was RETRACTED 2026-09-10:
 * db_masmis.CR_lp_regional/CR_lp_non_regional already carry this exact
 * call-detail-record data live (same ticket/task ref, agent, campaign,
 * disconnected time, call duration, lead status/sub-status, disposition).
 * CR Report's own content (loan status, unsecured_loan_amount) has no
 * such overlap in any CR_lp_* table -- kept.
 */

export const LP_CR_REPORT_HEADERS = [
  "Name", "Mobile", "Email", "Status", "Unsecured_Loan", "AgentName", "CreatedOn",
] as const;

export function parseNullableAmount(raw: unknown): number | null {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

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
  m = /^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/.exec(v);
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

async function resolveLpProcessId(): Promise<string | null> {
  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Lawyer Panel' LIMIT 1",
  );
  return procRows[0]?.id ?? null;
}

async function writeErrors(errorUpdates: Array<{ rowId: string; message: string }>) {
  if (!errorUpdates.length) return;
  const cases = errorUpdates.map(() => "WHEN ? THEN CAST(? AS JSON)").join(" ");
  const ids = errorUpdates.map((u) => u.rowId);
  await db.execute(
    `UPDATE upload_batch_row SET row_status = 'error', error_messages = CASE id ${cases} END
      WHERE id IN (${ids.map(() => "?").join(",")})`,
    [...errorUpdates.flatMap((u) => [u.rowId, JSON.stringify([u.message])]), ...ids],
  );
}

async function importCrReportBatch(
  batchId: string,
  importedByUserId: string,
  dashboardLabel: "REGIONAL" | "NON_REGIONAL",
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  const processId = await resolveLpProcessId();
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
      const msg = `Row ${row.row_no}: no "Lawyer Panel" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const name = String(data["Name"] ?? "").trim();
    const mobile = String(data["Mobile"] ?? "").trim();
    const createdOn = parseDate(data["CreatedOn"]);
    if (!name || !mobile || !createdOn) {
      const msg = `Row ${row.row_no}: "Name", "Mobile" and "CreatedOn" are all required — together they are the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO lp_cr_report_raw
           (id, process_id, dashboard_label, lead_name, email_masked, mobile_masked,
            status, unsecured_loan_amount, agent_name, created_on,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            email_masked = VALUES(email_masked),
            status = VALUES(status),
            unsecured_loan_amount = VALUES(unsecured_loan_amount),
            agent_name = VALUES(agent_name)`,
        [
          randomUUID(), processId, dashboardLabel, name,
          String(data["Email"] ?? "").trim() || null,
          mobile,
          String(data["Status"] ?? "").trim() || null,
          parseNullableAmount(data["Unsecured_Loan"]),
          String(data["AgentName"] ?? "").trim() || null,
          createdOn,
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

  await writeErrors(errorUpdates);
  return { importedRows, errorRows, errors };
}

export async function importLpCrReportRegionalBatch(batchId: string, importedByUserId: string) {
  return importCrReportBatch(batchId, importedByUserId, "REGIONAL");
}
export async function importLpCrReportNonRegionalBatch(batchId: string, importedByUserId: string) {
  return importCrReportBatch(batchId, importedByUserId, "NON_REGIONAL");
}
