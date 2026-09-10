import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Dalmia Cement's own "APR-Utilization Raw" sheet -- per-agent per-day
 * productivity. See sql/1733's own comment for the cross-schema check
 * that confirmed this has no DB backing anywhere, and for which columns
 * were dropped as broken VLOOKUP formula errors or constants.
 */

export const DALMIA_APR_UTILIZATION_HEADERS = [
  "Unique ID", "Week", "Date", "NOIID", "Emp_Name", "LOB", "No. of Calls/Chat", "Login Time",
  "WAIT", "TALK", "DISPO", "PAUSE", "ACHT", "Lunch", "Tea", "Tea1", "Washr",
  "Team Briefing AUX", "Net Pause", "Avg Dispo", "Total Break", "Actual Login Hrs",
  "Downtime", "Login", "Logout", "Net Login Hrs+DN+Briefing", "Utilization", "Attendance",
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
 * parseSecondsFlexible (cutoff at 1, not 3).
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

/** Utilization arrives as a plain fraction (0.4132... = 41.33%). */
export function parsePctFraction(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 3 ? n * 100 : n;
}

export function parseNullableInt(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
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

export async function importDalmiaAprUtilizationBatch(
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

    const uniqueId = cleanText(data["Unique ID"]);
    const reportDate = parseDate(data["Date"]);
    if (!uniqueId || !reportDate) {
      const msg = `Row ${row.row_no}: "Unique ID" and "Date" are both required -- Unique ID is this row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO dalmia_apr_utilization_raw
           (id, process_id, source_unique_id, report_date, week_label, emp_code, emp_name, lob,
            call_chat_count, login_seconds, wait_seconds, talk_seconds, dispo_seconds,
            pause_seconds, acht_seconds, lunch_seconds, tea_seconds, tea1_seconds,
            washroom_seconds, team_briefing_seconds, net_pause_seconds, avg_dispo_seconds,
            total_break_seconds, actual_login_seconds, downtime_seconds, login_time, logout_time,
            net_login_dn_briefing_seconds, utilization_pct, attendance_code,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            emp_name = VALUES(emp_name),
            utilization_pct = VALUES(utilization_pct),
            attendance_code = VALUES(attendance_code)`,
        [
          randomUUID(), processId, uniqueId, reportDate,
          cleanText(data["Week"]),
          cleanText(data["NOIID"]),
          cleanText(data["Emp_Name"]),
          cleanText(data["LOB"]),
          parseNullableInt(data["No. of Calls/Chat"]),
          parseSecondsFlexible(data["Login Time"]),
          parseSecondsFlexible(data["WAIT"]),
          parseSecondsFlexible(data["TALK"]),
          parseSecondsFlexible(data["DISPO"]),
          parseSecondsFlexible(data["PAUSE"]),
          parseSecondsFlexible(data["ACHT"]),
          parseSecondsFlexible(data["Lunch"]),
          parseSecondsFlexible(data["Tea"]),
          parseSecondsFlexible(data["Tea1"]),
          parseSecondsFlexible(data["Washr"]),
          parseSecondsFlexible(data["Team Briefing AUX"]),
          parseSecondsFlexible(data["Net Pause"]),
          parseSecondsFlexible(data["Avg Dispo"]),
          parseSecondsFlexible(data["Total Break"]),
          parseSecondsFlexible(data["Actual Login Hrs"]),
          parseSecondsFlexible(data["Downtime"]),
          parseDateTime(data["Login"]),
          parseDateTime(data["Logout"]),
          parseSecondsFlexible(data["Net Login Hrs+DN+Briefing"]),
          parsePctFraction(data["Utilization"]),
          cleanText(data["Attendance"]),
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
