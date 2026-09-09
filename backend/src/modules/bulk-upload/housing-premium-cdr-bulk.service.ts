import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Housing Premium's own "CDR" sheet -- found while auditing every sheet of
 * the same real workbook already downloaded this session for Sale Raw
 * (housing-premium-sale-raw-bulk.service.ts), not named in Housing
 * Premium's own SOP text, but real data with no DB backing anywhere: a
 * full outbound call log, 194,546 real rows in the sample file.
 *
 * Row identity (verified live across all 194,546 real rows, zero
 * collisions): (Date, Date_Row_Count) -- the sheet's own per-date running
 * counter. CALLER+MEMBER+End_Time alone collides: two rows can share an
 * identical phone/agent/timestamp with a different DURATION.
 */

export const HOUSING_PREMIUM_CDR_HEADERS = [
  "Date", "Date_Row_Count", "CALLER", "MEMBER", "TL_Name",
  "End_Time", "DURATION", "Talk_Duration", "Ringing_Duration", "STATUS",
] as const;

/**
 * DURATION/Talk_Duration/Ringing_Duration arrive as plain seconds already
 * in the real sample (e.g. 4.0, 0.0) -- unlike this session's other
 * duration columns, these are NOT day-fraction decimals or HH:MM:SS text.
 */
export function parseNullableSeconds(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseNullableInt(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
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
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  return null;
}

/**
 * End_Time is a FRACTIONAL Excel serial (date + time-of-day, e.g.
 * 46235.81636574074 = 2026-08-01 19:35:34) -- floored for the date part,
 * with the fractional remainder giving the time, same convention as this
 * session's clovia-crm-disposition-bulk.service.ts.
 */
export function parseEndTime(raw: unknown): string | null {
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

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importHousingPremiumCdrBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'Housing Premium' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "Housing Premium" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const reportDate = parseDate(data["Date"]);
    const dateRowCount = parseNullableInt(data["Date_Row_Count"]);
    if (!reportDate || dateRowCount === null) {
      const msg = `Row ${row.row_no}: "Date" and "Date_Row_Count" are both required — together they are the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO housing_premium_cdr_raw
           (id, process_id, report_date, date_row_count, caller_number, agent_name, tl_name,
            end_time, duration_seconds, talk_duration_seconds, ringing_duration_seconds, status,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            caller_number = VALUES(caller_number),
            agent_name = VALUES(agent_name),
            tl_name = VALUES(tl_name),
            end_time = VALUES(end_time),
            duration_seconds = VALUES(duration_seconds),
            talk_duration_seconds = VALUES(talk_duration_seconds),
            ringing_duration_seconds = VALUES(ringing_duration_seconds),
            status = VALUES(status)`,
        [
          randomUUID(), processId, reportDate, dateRowCount,
          String(data["CALLER"] ?? "").trim() || null,
          String(data["MEMBER"] ?? "").trim() || null,
          String(data["TL_Name"] ?? "").trim() || null,
          parseEndTime(data["End_Time"]),
          parseNullableSeconds(data["DURATION"]),
          parseNullableSeconds(data["Talk_Duration"]),
          parseNullableSeconds(data["Ringing_Duration"]),
          String(data["STATUS"] ?? "").trim() || null,
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
