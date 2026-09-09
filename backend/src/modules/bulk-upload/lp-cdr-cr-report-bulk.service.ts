import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * LP's "10. CR Reports" / "11. CDR" (per its own SOP: "Open BPO Panel...
 * Select Mascallnet NRGN Call History... Paste into CR Reports sheet" /
 * "Select BPO CR Reports... Paste into CDR sheet" -- no DB backing exists
 * for either). Columns read verbatim from two real samples: "Lp Regional
 * Sale Dashboard July26.xlsx" and "Lp Non Regional Dashboard July'26.xlsx",
 * sheets "CDR" and "CR Report".
 *
 * The CDR sheet's own "Connected Time" column is corrupted at the source
 * (its cell format is time-only, but the underlying value decodes to
 * nonsense years) -- deliberately not read here.
 */

export const LP_CDR_HEADERS = [
  "Ticket_Ref", "Unique", "Date", "Agent_Name", "Client_Name", "Campaign",
  "CallNumber", "Disconnected_Time", "Call_Duration", "Feedback",
  "Lead_Status", "Lead_Sub_Status", "Dispo", "Attempt",
] as const;

export const LP_CR_REPORT_HEADERS = [
  "Name", "Mobile", "Email", "Status", "Unsecured_Loan", "AgentName", "CreatedOn",
] as const;

export function parseNullableAmount(raw: unknown): number | null {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseNullableInt(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Call_Duration arrives as HH:MM:SS or MM:SS text in the real sample (e.g. "00:01:42"). */
export function parseDurationSeconds(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const parts = v.split(":").map((p) => Number(p));
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return parts[0] * 60 + parts[1];
  }
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
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

/**
 * "Disconnected Time" arrives as "01 Jul 2026 17:43" -- a date-and-time in
 * one text field, unlike every other date column this session which is
 * date-only. Parsed to a full DATETIME string for MySQL.
 */
export function parseDateTime(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})\s+(\d{1,2}):(\d{2})/.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const date = `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return `${date} ${m[4].padStart(2, "0")}:${m[5]}:00`;
  }
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

async function importCdrBatch(
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

    const ticketRef = String(data["Ticket_Ref"] ?? "").trim();
    const callSeq = parseNullableInt(data["Unique"]);
    const reportDate = parseDate(data["Date"]);
    if (!ticketRef || callSeq === null || !reportDate) {
      const msg = `Row ${row.row_no}: "Ticket_Ref", "Unique" and "Date" are all required — together they are the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO lp_cdr_raw
           (id, process_id, dashboard_label, ticket_ref, call_seq, report_date, agent_name,
            lead_name, campaign, branch_code, disconnected_at, call_duration_seconds,
            feedback, lead_status, lead_sub_status, dispo, attempt_total,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            agent_name = VALUES(agent_name),
            lead_name = VALUES(lead_name),
            campaign = VALUES(campaign),
            branch_code = VALUES(branch_code),
            disconnected_at = VALUES(disconnected_at),
            call_duration_seconds = VALUES(call_duration_seconds),
            feedback = VALUES(feedback),
            lead_status = VALUES(lead_status),
            lead_sub_status = VALUES(lead_sub_status),
            dispo = VALUES(dispo),
            attempt_total = VALUES(attempt_total)`,
        [
          randomUUID(), processId, dashboardLabel, ticketRef, callSeq, reportDate,
          String(data["Agent_Name"] ?? "").trim() || null,
          String(data["Client_Name"] ?? "").trim() || null,
          String(data["Campaign"] ?? "").trim() || null,
          String(data["CallNumber"] ?? "").trim() || null,
          parseDateTime(data["Disconnected_Time"]),
          parseDurationSeconds(data["Call_Duration"]),
          String(data["Feedback"] ?? "").trim() || null,
          String(data["Lead_Status"] ?? "").trim() || null,
          String(data["Lead_Sub_Status"] ?? "").trim() || null,
          String(data["Dispo"] ?? "").trim() || null,
          parseNullableInt(data["Attempt"]),
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

export async function importLpCdrRegionalBatch(batchId: string, importedByUserId: string) {
  return importCdrBatch(batchId, importedByUserId, "REGIONAL");
}
export async function importLpCdrNonRegionalBatch(batchId: string, importedByUserId: string) {
  return importCdrBatch(batchId, importedByUserId, "NON_REGIONAL");
}
export async function importLpCrReportRegionalBatch(batchId: string, importedByUserId: string) {
  return importCrReportBatch(batchId, importedByUserId, "REGIONAL");
}
export async function importLpCrReportNonRegionalBatch(batchId: string, importedByUserId: string) {
  return importCrReportBatch(batchId, importedByUserId, "NON_REGIONAL");
}
