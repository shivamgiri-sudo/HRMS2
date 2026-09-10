import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Dalmia Cement's own "IB CDR Raw" sheet -- see sql/1730's own comment for
 * the cross-schema check that confirmed this has no DB backing anywhere.
 */

export const DALMIA_IB_CDR_HEADERS = [
  "CallDate", "Time", "CallTime", "Agent Id", "Name", "Campname", "Phone Number",
  "Disposition", "Disconn.By", "Callduration", "Queue Duration", "Hold Time",
  "Acwduration (Wrapup or Dispo time)", "End Time", "Count", "Unique/Repeat",
  "Short Calls", "Calling  Status",
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

/**
 * Accepts an "HH:MM:SS" duration string or a day-fraction decimal, same
 * shared convention as clovia-apr-daily-bulk.service.ts's
 * parseSecondsFlexible (cutoff at 1, not 3 -- see that file's own comment
 * for the bug this avoids).
 */
export function parseSecondsFlexible(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (v.includes(":")) {
    const parts = v.split(":").map((p) => Number(p));
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n < 1 ? Math.round(n * 86400) : Math.round(n);
}

export function parseNullableInt(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseBoolFlag(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return n === 0 ? 0 : 1;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  return v === "true" || v === "yes" ? 1 : 0;
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

export async function importDalmiaIbCdrBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Dalmia Cement' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Dalmia Cement" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const agentCode = cleanText(data["Agent Id"]);
    const callTime = parseDateTime(data["CallTime"]);
    const reportDate = parseDate(data["CallDate"]) ?? callTime?.slice(0, 10) ?? null;
    if (!agentCode || !callTime || !reportDate) {
      const msg = `Row ${row.row_no}: "Agent Id", "CallTime" and "CallDate" are all required -- (Agent Id, CallTime, Phone Number) is this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO dalmia_ib_cdr_raw
           (id, process_id, report_date, time_of_call, call_time, agent_code, agent_name,
            campaign_name, phone_number, disposition, disconnected_by, call_duration_seconds,
            queue_duration_seconds, hold_time_seconds, acw_duration_seconds, end_time,
            call_count, unique_repeat, is_short_call, calling_status,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            disposition = VALUES(disposition),
            calling_status = VALUES(calling_status),
            call_duration_seconds = VALUES(call_duration_seconds)`,
        [
          randomUUID(), processId, reportDate,
          parseDateTime(data["Time"]),
          callTime,
          agentCode,
          cleanText(data["Name"]),
          cleanText(data["Campname"]),
          cleanText(data["Phone Number"]),
          cleanText(data["Disposition"]),
          cleanText(data["Disconn.By"]),
          parseSecondsFlexible(data["Callduration"]),
          parseSecondsFlexible(data["Queue Duration"]),
          parseSecondsFlexible(data["Hold Time"]),
          parseSecondsFlexible(data["Acwduration (Wrapup or Dispo time)"]),
          parseDateTime(data["End Time"]),
          parseNullableInt(data["Count"]),
          cleanText(data["Unique/Repeat"]),
          parseBoolFlag(data["Short Calls"]),
          cleanText(data["Calling  Status"]),
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
