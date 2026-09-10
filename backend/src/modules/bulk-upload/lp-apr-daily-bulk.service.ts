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
 * column, but the real WebConsole export (verified live against both real
 * "Lp Regional/Non Regional...xlsx" workbooks' own "APR" sheet) MIXES two
 * formats in the same row: some columns (Handle Duration, Idle Block
 * Duration, Ring Duration, Tea/Lunch/Meeting/BIO Break) are real HH:MM:SS
 * text, while others (Login Time, Net LoginTime, Idle Duration) are
 * fraction-of-a-day decimal text (e.g. "0.36966435185185187" = ~31,939
 * seconds) -- the same ambiguity this session has hit before. A bare
 * number strictly between 0 and 1 is treated as a day-fraction; "0" or a
 * whole/larger number is treated as already-seconds, since a real
 * duration is never a fraction unless it's a day-fraction by construction.
 * Also accepts a bare seconds count and MM:SS, so a sheet that has already
 * been partly cleaned still imports rather than zeroing every duration.
 */
export function parseDurationSeconds(raw: unknown): number {
  const v = String(raw ?? "").trim();
  if (!v) return 0;
  let m = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(v);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = /^(\d{1,3}):(\d{2})$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 0 && n < 1) return Math.round(n * 86400);
  return Math.round(n);
}

export function parseDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  // The real WebConsole export's own "CalLDate" column is a plain Excel
  // serial number as text (e.g. "46204"), confirmed against a real live
  // row from both "Lp Regional/Non Regional...xlsx" workbooks' own "APR"
  // sheet -- this branch was missing entirely (this function's only real
  // sample before was the SOP's idealized "Call Date" name, never the
  // real export), which is why every one of 119 real rows failed to
  // import on the first real run.
  if (/^\d+(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
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

    // The real WebConsole export's own header is "CalLDate" (that exact odd
    // casing, no space) -- "Call Date" is the SOP's idealized name, kept as
    // a fallback in case a cleaner export ever uses it.
    const callDate = parseDate(data["CalLDate"] ?? data["Call Date"]);
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
          parseCallCount(data["[Total_Calls]"] ?? data["[Total Calls]"] ?? data["Total Calls"]),
          parseDurationSeconds(data["[Login_Time]"] ?? data["[Login Time]"] ?? data["Login Time"]),
          parseDurationSeconds(data["[Net_LoginTime]"] ?? data["[Net LoginTime]"] ?? data["Net LoginTime"]),
          parseDurationSeconds(data["[Total_Break_Duration]"] ?? data["[Total Break Duration]"] ?? data["Total Break Duration"]),
          parseDurationSeconds(data["[Idle_Duration]"] ?? data["[Idle Duration]"] ?? data["Idle Duration"]),
          parseDurationSeconds(data["[Talk_Duration]"] ?? data["[Talk Duration]"] ?? data["Talk Duration"]),
          parseDurationSeconds(data["[Wrapup_Duration]"] ?? data["[Wrapup Duration]"] ?? data["Wrapup Duration"]),
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
