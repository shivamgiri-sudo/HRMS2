import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * DU Digital's "CDR Raw" sheet (Export Calls Report from dudigital.par-infinity.com,
 * a vicidial instance) -- the per-call counterpart to du-apr-daily-bulk.service.ts's
 * per-agent-day APR. Same "DU Digital" process, same KOREA/THAILAND dashboard_label
 * split, same table for both countries (see sql/1966_du_cdr_daily_actual.sql for the
 * full column rationale).
 *
 * call_date arrives as vicidial's own raw export format -- either an Excel serial
 * datetime (e.g. 46296.445810, confirmed against both reference workbooks' "CDR Raw"
 * sheet) when pasted straight from the browser into Excel, or a plain "YYYY-MM-DD[
 * HH:MM:SS]" string when re-saved as CSV/xlsx first (the uploader/du_* Python scripts
 * produce this cleaner shape). Both are accepted; parseCallDateTime never guesses.
 */

export const DU_CDR_HEADERS = [
  "uniqueid",
  "call_date",
  "status",
] as const;

export function parseCount(raw: unknown): number {
  const v = String(raw ?? "").trim();
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** Excel serial date (whole or fractional, pre-1900-leap-bug epoch Dec 30 1899) or a
 * plain ISO/slash date(+time) string. Returns both the calendar day and, when the
 * source carried a time-of-day (a fractional serial or an explicit HH:MM:SS), the
 * full datetime and hour-of-day -- needed for the Intraday Call Flow chart. */
export function parseCallDateTime(raw: unknown): { date: string | null; datetime: string | null; hour: number | null } {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const ms = Date.UTC(1899, 11, 30) + raw * 86400000;
    const d = new Date(Math.round(ms));
    const hasTime = Math.abs(raw % 1) > 1e-9;
    return {
      date: d.toISOString().slice(0, 10),
      datetime: hasTime ? d.toISOString().slice(0, 19).replace("T", " ") : null,
      hour: hasTime ? d.getUTCHours() : null,
    };
  }
  const v = String(raw ?? "").trim();
  if (!v) return { date: null, datetime: null, hour: null };
  if (/^\d+(\.\d+)?$/.test(v)) return parseCallDateTime(Number(v));
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    const date = `${y}-${mo}-${d}`;
    if (h) return { date, datetime: `${date} ${h}:${mi}:${s ?? "00"}`, hour: Number(h) };
    return { date, datetime: null, hour: null };
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (m) {
    const [, mo, d, y, h, mi, s] = m;
    const date = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    if (h) return { date, datetime: `${date} ${h.padStart(2, "0")}:${mi}:${s ?? "00"}`, hour: Number(h) };
    return { date, datetime: null, hour: null };
  }
  return { date: null, datetime: null, hour: null };
}

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

async function importBatch(
  batchId: string,
  importedByUserId: string,
  dashboardLabel: "KOREA" | "THAILAND",
): Promise<{ importedRows: number; errorRows: number; errors: string[] }> {
  const [batchRows] = await db.execute<BatchRow[]>(
    `SELECT id, row_no, normalized_data FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no`,
    [batchId],
  );
  if (batchRows.length === 0) return { importedRows: 0, errorRows: 0, errors: [] };

  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'DU Digital' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "DU Digital" process found to attach this row to`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const uniqueid = String(data["uniqueid"] ?? "").trim();
    if (!uniqueid) {
      const msg = `Row ${row.row_no}: "uniqueid" is required -- it is the row's own identity (vicidial's per-call id)`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    // call_date falls back to entry_date when the export's own call_date is blank --
    // both are the same vicidial-native format, confirmed against the reference sheets.
    const parsed = parseCallDateTime(data["call_date"]);
    const fallback = parsed.date ? parsed : parseCallDateTime(data["entry_date"]);
    if (!fallback.date) {
      const msg = `Row ${row.row_no}: "call_date" is required and could not be read`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const status = String(data["status"] ?? "").trim();
    if (!status) {
      const msg = `Row ${row.row_no}: "status" is required`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO db_masmis.du_cdr_daily_actual
           (id, process_id, dashboard_label, uniqueid, call_date, call_datetime, agent_user, agent_name,
            phone_number, campaign_id, user_group, status, status_name, length_in_sec, queue_time_sec,
            hour_of_day, data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            call_date = VALUES(call_date), call_datetime = VALUES(call_datetime),
            agent_user = VALUES(agent_user), agent_name = VALUES(agent_name),
            phone_number = VALUES(phone_number), campaign_id = VALUES(campaign_id),
            user_group = VALUES(user_group), status = VALUES(status), status_name = VALUES(status_name),
            length_in_sec = VALUES(length_in_sec), queue_time_sec = VALUES(queue_time_sec),
            hour_of_day = VALUES(hour_of_day)`,
        [
          randomUUID(), processId, dashboardLabel, uniqueid, fallback.date, fallback.datetime,
          String(data["user"] ?? "").trim() || null,
          String(data["full_name"] ?? data["Agent Name"] ?? "").trim() || null,
          String(data["phone_number_dialed"] ?? data["phone_number"] ?? "").trim() || null,
          String(data["campaign_id"] ?? "").trim() || null,
          String(data["user_group"] ?? "").trim() || null,
          status,
          String(data["status_name"] ?? "").trim() || null,
          parseCount(data["length_in_sec"]),
          parseCount(data["queue_time"]),
          fallback.hour,
          batchId, importedByUserId,
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

export async function importDuCdrKoreaBatch(batchId: string, importedByUserId: string) {
  return importBatch(batchId, importedByUserId, "KOREA");
}

export async function importDuCdrThailandBatch(batchId: string, importedByUserId: string) {
  return importBatch(batchId, importedByUserId, "THAILAND");
}
