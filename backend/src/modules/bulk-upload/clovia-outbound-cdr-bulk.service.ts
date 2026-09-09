import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Clovia's own "Outbound Report" sheet -- found while auditing every sheet
 * of the same workbook family already used this session for Chat
 * Performance/CRM Disposition/Team Alignment/APR Utilization/IB CDR Raw,
 * not named in Clovia Steps.docx's own SOP text, but real data with no DB
 * backing anywhere: a full outbound call log, 1,317 real rows in the
 * sample file.
 */

export const CLOVIA_OUTBOUND_CDR_HEADERS = [
  "UAN", "Count", "Call_Date", "Agent", "Phone_Number", "Call_Code",
  "Start_Time", "End_Time", "Length_Sec", "Campaign", "Reason", "Status", "U_R",
] as const;

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
 * Start_Time/End_Time are FRACTIONAL Excel serials (date + time-of-day),
 * same convention as this session's clovia-crm-disposition-bulk.service.ts.
 */
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

interface BatchRow extends RowDataPacket {
  id: string;
  row_no: number;
  normalized_data: string | Record<string, unknown>;
}
interface Ref extends RowDataPacket { id: string }

export async function importCloviaOutboundCdrBatch(
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

    const uan = String(data["UAN"] ?? "").trim();
    const rowCount = parseNullableInt(data["Count"]);
    const reportDate = parseDate(data["Call_Date"]);
    if (!uan || rowCount === null || !reportDate) {
      const msg = `Row ${row.row_no}: "UAN", "Count" and "Call_Date" are all required — together they are the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    try {
      await db.execute(
        `INSERT INTO clovia_outbound_cdr_raw
           (id, process_id, report_date, agent_code, phone_number, call_code, start_time, end_time,
            length_seconds, campaign, reason, status, uan, row_count, unique_or_repeat,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            agent_code = VALUES(agent_code),
            phone_number = VALUES(phone_number),
            call_code = VALUES(call_code),
            start_time = VALUES(start_time),
            end_time = VALUES(end_time),
            length_seconds = VALUES(length_seconds),
            campaign = VALUES(campaign),
            reason = VALUES(reason),
            status = VALUES(status),
            unique_or_repeat = VALUES(unique_or_repeat)`,
        [
          randomUUID(), processId, reportDate,
          String(data["Agent"] ?? "").trim() || null,
          String(data["Phone_Number"] ?? "").trim() || null,
          String(data["Call_Code"] ?? "").trim() || null,
          parseDateTime(data["Start_Time"]),
          parseDateTime(data["End_Time"]),
          parseNullableInt(data["Length_Sec"]),
          String(data["Campaign"] ?? "").trim() || null,
          String(data["Reason"] ?? "").trim() || null,
          String(data["Status"] ?? "").trim() || null,
          uan,
          rowCount,
          String(data["U_R"] ?? "").trim() || null,
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
