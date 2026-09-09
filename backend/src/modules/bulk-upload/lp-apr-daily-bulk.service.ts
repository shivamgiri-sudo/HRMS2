import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * LP (Lawyer Panel) WebConsole "Agent Wise Performance" APR, daily.
 *
 * The SOP for this report names real columns (Total Calls, Login Time, Net
 * LoginTime, Total Break Duration, Idle Duration, Talk Duration, Wrapup
 * Duration, CallDate) -- unlike most of the other Report Builder SOP gaps,
 * which name only a system, not a format. dialer_db.apr_5/apr_137_235/
 * apr_bla_bli_blu, where this data would otherwise land, are confirmed empty
 * (a dead external sync job), so this lands in mas_hrms instead, per this
 * project's Database Boundary Rule (upstream databases are read-only).
 */

export const LP_APR_DAILY_HEADERS = [
  "Agent",
  "Call Date",
  "Total Calls",
  "Login Time",
  "Net LoginTime",
  "Total Break Duration",
  "Idle Duration",
  "Talk Duration",
  "Wrapup Duration",
] as const;

/** total_calls is NOT NULL with a 0 default -- a blank cell means zero, not null. */
export function parseCallCount(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/**
 * The SOP's own instruction is "Convert text to numbers" on every duration
 * column -- the raw WebConsole export is HH:MM:SS text. Also accepts a bare
 * seconds count and MM:SS, so a sheet that has already been partly cleaned
 * still imports rather than zeroing every duration.
 */
export function parseDurationSeconds(raw: unknown): number {
  const v = String(raw ?? "").trim();
  if (!v) return 0;
  let m = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(v);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = /^(\d{1,3}):(\d{2})$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export function parseDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
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

export async function importLpAprDailyBatch(
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

  // "Lawyer Panel" exists in process_master but is currently inactive
  // (active_status=0) -- resolved without that filter, because a storage
  // gap should not be gated on a business decision about the process's KPI
  // Studio visibility. That decision is separate and deliberately left open.
  const [procRows] = await db.execute<Ref[]>(
    "SELECT id FROM process_master WHERE process_name = 'Lawyer Panel' LIMIT 1",
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
      const msg = `Row ${row.row_no}: no "Lawyer Panel" process found to attach this row to`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const agentName = String(data["Agent"] ?? "").trim();
    if (!agentName) {
      const msg = `Row ${row.row_no}: "Agent" is required — it is part of the row's identity`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const callDate = parseDate(data["Call Date"]);
    if (!callDate) {
      const msg = `Row ${row.row_no}: "Call Date" is required and could not be read`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    try {
      await db.execute(
        `INSERT INTO lp_apr_daily_actual
           (id, process_id, agent_name, call_date, total_calls, login_seconds, net_login_seconds,
            total_break_seconds, idle_seconds, talk_seconds, wrapup_seconds,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            total_calls = VALUES(total_calls),
            login_seconds = VALUES(login_seconds),
            net_login_seconds = VALUES(net_login_seconds),
            total_break_seconds = VALUES(total_break_seconds),
            idle_seconds = VALUES(idle_seconds),
            talk_seconds = VALUES(talk_seconds),
            wrapup_seconds = VALUES(wrapup_seconds)`,
        [
          randomUUID(), processId, agentName, callDate,
          parseCallCount(data["Total Calls"]),
          parseDurationSeconds(data["Login Time"]),
          parseDurationSeconds(data["Net LoginTime"]),
          parseDurationSeconds(data["Total Break Duration"]),
          parseDurationSeconds(data["Idle Duration"]),
          parseDurationSeconds(data["Talk Duration"]),
          parseDurationSeconds(data["Wrapup Duration"]),
          // source_reference is part of the unique key, so a re-upload of the
          // same agent+day from a different batch does not silently collide.
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
