import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Housing Owner's "1. Tata Dialer Report" -> Call Logs sheet: per-agent,
 * per-day call performance exported from Tata Dialer's Agent Performance
 * report. Per the SOP, by the time this reaches the sheet, rows with
 * All Calls/Total Calls = 0 have already been deleted and the Agent
 * column has already been trimmed to the MCN last name -- this importer
 * does not re-apply that cleaning, it trusts the uploaded sheet.
 * Columns read directly from a real sample: "Housing Owner Sep'26.xlsx",
 * sheet "Call Logs".
 */

export const HOUSING_OWNER_CALL_LOGS_HEADERS = [
  "Agent_Name",
  "Date",
  "TL_Name",
  "Total_Calls",
  "Calls_Handled",
  "Inbound_Calls_Answered",
  "Inbound_Calls_Missed",
  "Connected",
  "Not_Connected",
  "Available_Duration",
  "In_Call_Duration",
  "Break_Duration",
] as const;

export function parseCount(raw: unknown): number {
  const v = String(raw ?? "").trim();
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export function parseNullableCount(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** HH:MM:SS / MM:SS / bare-seconds -> seconds. The source's own durations are HH:MM:SS text. */
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

export async function importHousingOwnerCallLogsBatch(
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
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const agentName = String(data["Agent_Name"] ?? "").trim();
    if (!agentName) {
      const msg = `Row ${row.row_no}: "Agent_Name" is required — it is part of the row's identity`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const reportDate = parseDate(data["Date"]);
    if (!reportDate) {
      const msg = `Row ${row.row_no}: "Date" is required and could not be read`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    try {
      await db.execute(
        `INSERT INTO housing_owner_call_logs
           (id, process_id, agent_name, report_date, tl_name, total_calls,
            calls_handled, inbound_calls_answered, inbound_calls_missed,
            connected_calls, not_connected_calls, available_seconds,
            in_call_seconds, break_seconds, data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            tl_name = VALUES(tl_name),
            total_calls = VALUES(total_calls),
            calls_handled = VALUES(calls_handled),
            inbound_calls_answered = VALUES(inbound_calls_answered),
            inbound_calls_missed = VALUES(inbound_calls_missed),
            connected_calls = VALUES(connected_calls),
            not_connected_calls = VALUES(not_connected_calls),
            available_seconds = VALUES(available_seconds),
            in_call_seconds = VALUES(in_call_seconds),
            break_seconds = VALUES(break_seconds)`,
        [
          randomUUID(), processId, agentName, reportDate,
          String(data["TL_Name"] ?? "").trim() || null,
          parseCount(data["Total_Calls"]),
          parseNullableCount(data["Calls_Handled"]),
          parseNullableCount(data["Inbound_Calls_Answered"]),
          parseNullableCount(data["Inbound_Calls_Missed"]),
          parseNullableCount(data["Connected"]),
          parseNullableCount(data["Not_Connected"]),
          parseDurationSeconds(data["Available_Duration"]),
          parseDurationSeconds(data["In_Call_Duration"]),
          parseDurationSeconds(data["Break_Duration"]),
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
