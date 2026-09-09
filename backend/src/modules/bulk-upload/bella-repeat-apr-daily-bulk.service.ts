import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Bella Vita Repeat LOB's own "APR" sheet -- found while auditing every
 * sheet of "Bella Vita Repeat LOB Mis Dashboard July26.xlsb", not named in
 * BELLAVITA Dashboard.docx's own SOP text, but real data with no DB backing
 * anywhere: per-agent per-day call/chat productivity for the Repeat
 * Customer LOB specifically.
 *
 * This dashboard's own "Sale Raw" sheet duplicates the already-live
 * db_masmis.bb_sale table (confirmed identical live) -- this APR sheet has
 * no such existing home.
 */

export const BELLA_REPEAT_APR_HEADERS = [
  "NOIID", "Date", "Emp_Name", "LOB", "Calls", "Login_Seconds", "Net_Login_Seconds",
  "Wait_Seconds", "Talk_Seconds", "Dispo_Seconds", "Pause_Seconds", "ACHT_Seconds",
  "Total_Break_Seconds", "Utilization", "Attendance", "Team_Leader", "Tenure",
] as const;

export function parseNullableInt(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Accepts a day-fraction decimal (0 <= n < 1) or an already-converted raw seconds value. */
export function parseSecondsFlexible(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n < 1 ? Math.round(n * 86400) : Math.round(n);
}

/** Utilization arrives as a plain fraction (0.4008 = 40.08%), same convention as Clovia/DU APR. */
export function parsePctFraction(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 3 ? n * 100 : n;
}

export function parseNullableDecimal(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v || v === "-") return null;
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

export async function importBellaRepeatAprDailyBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Bella-Vita Organic' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Bella-Vita Organic" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const noiid = String(data["NOIID"] ?? "").trim();
    const callDate = parseDate(data["Date"]);
    if (!noiid || !callDate) {
      const msg = `Row ${row.row_no}: "NOIID" and "Date" are both required — together they are the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO bella_repeat_apr_daily_actual
           (id, process_id, mas_employee_code, agent_name, call_date, lob, total_calls,
            login_seconds, net_login_seconds, wait_seconds, talk_seconds, dispo_seconds,
            pause_seconds, acht_seconds, total_break_seconds, utilization_pct,
            attendance_fraction, team_leader, tenure_days,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            agent_name = VALUES(agent_name),
            lob = VALUES(lob),
            total_calls = VALUES(total_calls),
            login_seconds = VALUES(login_seconds),
            wait_seconds = VALUES(wait_seconds),
            talk_seconds = VALUES(talk_seconds),
            dispo_seconds = VALUES(dispo_seconds),
            pause_seconds = VALUES(pause_seconds),
            acht_seconds = VALUES(acht_seconds),
            total_break_seconds = VALUES(total_break_seconds),
            utilization_pct = VALUES(utilization_pct),
            attendance_fraction = VALUES(attendance_fraction),
            team_leader = VALUES(team_leader),
            tenure_days = VALUES(tenure_days)`,
        [
          randomUUID(), processId, noiid,
          String(data["Emp_Name"] ?? "").trim() || null,
          callDate,
          String(data["LOB"] ?? "").trim() || null,
          parseNullableInt(data["Calls"]),
          parseSecondsFlexible(data["Login_Seconds"]),
          parseSecondsFlexible(data["Net_Login_Seconds"]),
          parseSecondsFlexible(data["Wait_Seconds"]),
          parseSecondsFlexible(data["Talk_Seconds"]),
          parseSecondsFlexible(data["Dispo_Seconds"]),
          parseSecondsFlexible(data["Pause_Seconds"]),
          parseSecondsFlexible(data["ACHT_Seconds"]),
          parseSecondsFlexible(data["Total_Break_Seconds"]),
          parsePctFraction(data["Utilization"]),
          parseNullableDecimal(data["Attendance"]),
          String(data["Team_Leader"] ?? "").trim() || null,
          parseNullableInt(data["Tenure"]),
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
