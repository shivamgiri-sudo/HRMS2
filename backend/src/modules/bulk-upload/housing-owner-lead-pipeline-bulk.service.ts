import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Housing Owner's own "Look up Data" sheet -- a CRM lead/opportunity
 * pipeline log. See sql/1738's own comment for the identity/scoping
 * decisions this table makes.
 */

export const HOUSING_OWNER_LEAD_PIPELINE_HEADERS = [
  "Date", "caseId", "callId", "callType", "agentId", "agentName", "agentNumber",
  "customerName", "customerPhone", "alternatePhone", "tlId", "tlName", "opportunityId",
  "accountId", "ownerOpportunityStageName", "opportunityType", "createdAt", "assignedAt",
  "callStartTime", "callEndTime", "talkTime", "wrapupTime", "callStatus", "disposition",
  "notes", "followupTime", "recordingURL", "Fresh", "Hot Leads",
] as const;

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
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  return null;
}

/** FRACTIONAL Excel serial (date + time-of-day) -> "YYYY-MM-DD HH:MM:SS". */
export function parseDateTime(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const days = Math.floor(raw);
    const secondsOfDay = Math.round((raw - days) * 86400);
    const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000 + secondsOfDay * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  return null;
}

/** talkTime is a genuine fraction-of-a-day duration (a call never lasts a whole day). */
export function parseDurationSeconds(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw * 86400);
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 86400) : null;
}

/** wrapupTime is not a real duration -- it is exactly 1.0 on every non-null row. Stored as the boolean it actually is. */
export function parseBoolFlag(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? (n !== 0 ? 1 : 0) : null;
}

export function cleanText(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importHousingOwnerLeadPipelineBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Housing Owner' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Housing Owner" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const caseId = cleanText(data["caseId"]);
    const reportDate = parseDate(data["Date"]);
    if (!caseId || !reportDate) {
      const msg = `Row ${row.row_no}: "caseId" and "Date" are both required -- together with callId/disposition/createdAt they are this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO housing_owner_lead_pipeline_raw
           (id, process_id, report_date, case_id, call_id, call_type, agent_id, agent_name,
            agent_number, customer_name, customer_phone, alternate_phone, tl_id, tl_name,
            opportunity_id, account_id, opportunity_stage, opportunity_type, case_created_at,
            assigned_at, call_start_time, call_end_time, talk_time_seconds, had_wrapup,
            call_status, disposition, notes, followup_time, recording_url, is_fresh_lead,
            lead_temperature, data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            opportunity_stage = VALUES(opportunity_stage),
            call_status = VALUES(call_status),
            disposition = VALUES(disposition)`,
        [
          randomUUID(), processId, reportDate, caseId,
          cleanText(data["callId"]),
          cleanText(data["callType"]),
          cleanText(data["agentId"]),
          cleanText(data["agentName"]),
          cleanText(data["agentNumber"]),
          cleanText(data["customerName"]),
          cleanText(data["customerPhone"]),
          cleanText(data["alternatePhone"]),
          cleanText(data["tlId"]),
          cleanText(data["tlName"]),
          cleanText(data["opportunityId"]),
          cleanText(data["accountId"]),
          cleanText(data["ownerOpportunityStageName"]),
          cleanText(data["opportunityType"]),
          parseDateTime(data["createdAt"]),
          parseDateTime(data["assignedAt"]),
          parseDateTime(data["callStartTime"]),
          parseDateTime(data["callEndTime"]),
          parseDurationSeconds(data["talkTime"]),
          parseBoolFlag(data["wrapupTime"]),
          cleanText(data["callStatus"]),
          cleanText(data["disposition"]),
          cleanText(data["notes"]),
          parseDateTime(data["followupTime"]),
          cleanText(data["recordingURL"]),
          data["Fresh"] === "Fresh" ? 1 : data["Fresh"] === "No" ? 0 : null,
          cleanText(data["Hot Leads"]),
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
