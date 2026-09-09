import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Clovia's own "APR-Utilization Raw" sheet -- found while auditing every
 * sheet of the same workbook family already used this session for Chat
 * Performance/CRM Disposition/Team Alignment, not named in Clovia
 * Steps.docx's own SOP text, but real data with no DB backing anywhere:
 * per-agent per-day productivity across Inbound/Outbound/Email.
 *
 * Duration columns are day-fraction decimals (e.g. 0.3824537037037037 =
 * 33,044 seconds), same convention as this session's DU APR
 * (du-apr-daily-bulk.service.ts's parseSecondsFlexible).
 */

export const CLOVIA_APR_HEADERS = [
  "MAS_ID", "Date", "USER_NAME", "LOB", "No_of_Calls", "Chat_Count", "Email_Count",
  "Actual_Login_Hrs", "Net_Login_Hrs_DN", "WAIT", "TALK", "DISPO", "Total_Break",
  "ACHT", "Utilization", "Attendance", "CSAT",
] as const;

export function parseNullableInt(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Accepts a day-fraction decimal (0 <= n <= 3) or an already-converted raw seconds value. */
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
  return n <= 3 ? Math.round(n * 86400) : Math.round(n);
}

/** Utilization/CSAT arrive as plain fractions (0.4427... = 44.28%), same convention as DU APR. */
export function parsePctFraction(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 3 ? n * 100 : n;
}

export function parseNullableDecimal(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  return null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importCloviaAprDailyBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Clovia' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Clovia" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const masId = String(data["MAS_ID"] ?? "").trim();
    const callDate = parseDate(data["Date"]);
    if (!masId || !callDate) {
      const msg = `Row ${row.row_no}: "MAS_ID" and "Date" are both required — together they are the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO clovia_apr_daily_actual
           (id, process_id, mas_employee_code, agent_name, call_date, lob, total_calls,
            chat_count, email_count, login_seconds, net_login_seconds, wait_seconds,
            talk_seconds, dispo_seconds, total_break_seconds, acht_seconds,
            utilization_pct, attendance_fraction, csat_pct,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            agent_name = VALUES(agent_name),
            lob = VALUES(lob),
            total_calls = VALUES(total_calls),
            chat_count = VALUES(chat_count),
            email_count = VALUES(email_count),
            login_seconds = VALUES(login_seconds),
            net_login_seconds = VALUES(net_login_seconds),
            wait_seconds = VALUES(wait_seconds),
            talk_seconds = VALUES(talk_seconds),
            dispo_seconds = VALUES(dispo_seconds),
            total_break_seconds = VALUES(total_break_seconds),
            acht_seconds = VALUES(acht_seconds),
            utilization_pct = VALUES(utilization_pct),
            attendance_fraction = VALUES(attendance_fraction),
            csat_pct = VALUES(csat_pct)`,
        [
          randomUUID(), processId, masId,
          String(data["USER_NAME"] ?? "").trim() || null,
          callDate,
          String(data["LOB"] ?? "").trim() || null,
          parseNullableInt(data["No_of_Calls"]),
          parseNullableInt(data["Chat_Count"]),
          parseNullableInt(data["Email_Count"]),
          parseSecondsFlexible(data["Actual_Login_Hrs"]),
          parseSecondsFlexible(data["Net_Login_Hrs_DN"]),
          parseSecondsFlexible(data["WAIT"]),
          parseSecondsFlexible(data["TALK"]),
          parseSecondsFlexible(data["DISPO"]),
          parseSecondsFlexible(data["Total_Break"]),
          parseSecondsFlexible(data["ACHT"]),
          parsePctFraction(data["Utilization"]),
          parseNullableDecimal(data["Attendance"]),
          parsePctFraction(data["CSAT"]),
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
