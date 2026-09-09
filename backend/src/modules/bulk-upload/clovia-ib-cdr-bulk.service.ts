import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Clovia's own "IB CDR Raw" sheet -- found while auditing every sheet of
 * the same workbook family already used this session for Chat Performance/
 * CRM Disposition/Team Alignment/APR Utilization, not named in Clovia
 * Steps.docx's own SOP text, but real data with no DB backing anywhere: a
 * full inbound call log, 1,627 real rows in the sample file.
 *
 * Duration columns mix conventions within the same sheet: Callduration/
 * Queue Duration are day-fraction decimals (0.0021296296296296298 = 184s),
 * but Acwduration arrives already in plain seconds (58, not 0.00067) --
 * parseSecondsFlexible's <=3 heuristic (same helper as this session's
 * Clovia APR/DU APR) handles both without needing two separate parsers.
 */

export const CLOVIA_IB_CDR_HEADERS = [
  "Phone_Number", "CallTime", "Agent_Id", "Count", "Name", "Calltype", "Campname",
  "Disposition", "Disconn_By", "Callduration", "Queue_Duration", "Hold_Time",
  "ACW_Duration", "Unique_Repeat", "Status", "CallDate",
] as const;

export function parseNullableInt(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Accepts a day-fraction decimal (0 <= n < 1) or an already-converted raw
 * seconds value. The cutoff is 1, not some larger number: a fraction of a
 * single day can never reach or exceed 1.0 by definition, so any value
 * >= 1 is unambiguously already-seconds -- a real bug caught live while
 * verifying THIS file's own end-to-end test: a synthetic 3-second
 * Acwduration was silently read back as 259,200 seconds ("3 days") under
 * an earlier <= 3 cutoff, copied forward from du-apr-daily-bulk.service.ts
 * and clovia-apr-daily-bulk.service.ts -- both fixed the same way.
 */
export function parseSecondsFlexible(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n < 1 ? Math.round(n * 86400) : Math.round(n);
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
 * CallTime is a FRACTIONAL Excel serial (date + time-of-day), same
 * convention as this session's clovia-crm-disposition-bulk.service.ts.
 */
export function parseCallTime(raw: unknown): string | null {
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

export async function importCloviaIbCdrBatch(
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

    const phoneNumber = String(data["Phone_Number"] ?? "").trim();
    const callTime = parseCallTime(data["CallTime"]);
    const agentId = String(data["Agent_Id"] ?? "").trim();
    const rowCount = parseNullableInt(data["Count"]);
    if (!phoneNumber || !callTime || !agentId || rowCount === null) {
      const msg = `Row ${row.row_no}: "Phone_Number", "CallTime", "Agent_Id" and "Count" are all required — together they are the row's identity`;
      errors.push(msg); errorUpdates.push({ rowId: row.id, message: msg }); errorRows++; continue;
    }

    const reportDate = parseDate(data["CallDate"]) ?? callTime.slice(0, 10);

    try {
      await db.execute(
        `INSERT INTO clovia_ib_cdr_raw
           (id, process_id, report_date, call_time, agent_code, agent_name, call_type, campaign,
            phone_number, disposition, disconn_by, call_duration_seconds, queue_duration_seconds,
            hold_time_seconds, acw_duration_seconds, unique_or_repeat, status, row_count,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            agent_name = VALUES(agent_name),
            call_type = VALUES(call_type),
            campaign = VALUES(campaign),
            disposition = VALUES(disposition),
            disconn_by = VALUES(disconn_by),
            call_duration_seconds = VALUES(call_duration_seconds),
            queue_duration_seconds = VALUES(queue_duration_seconds),
            hold_time_seconds = VALUES(hold_time_seconds),
            acw_duration_seconds = VALUES(acw_duration_seconds),
            unique_or_repeat = VALUES(unique_or_repeat),
            status = VALUES(status)`,
        [
          randomUUID(), processId, reportDate, callTime, agentId,
          String(data["Name"] ?? "").trim() || null,
          String(data["Calltype"] ?? "").trim() || null,
          String(data["Campname"] ?? "").trim() || null,
          phoneNumber,
          String(data["Disposition"] ?? "").trim() || null,
          String(data["Disconn_By"] ?? "").trim() || null,
          parseSecondsFlexible(data["Callduration"]),
          parseSecondsFlexible(data["Queue_Duration"]),
          parseSecondsFlexible(data["Hold_Time"]),
          parseSecondsFlexible(data["ACW_Duration"]),
          String(data["Unique_Repeat"] ?? "").trim() || null,
          String(data["Status"] ?? "").trim() || null,
          rowCount,
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
