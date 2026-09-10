import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * GNC's daily Agent Productivity Report (APR).
 *
 * Same report shape Mydashboards' own GNC APR Upload writes to
 * db_masmis.gnc_apr (github.com/tausifansari-mcn/Mydashboards, backend/src/
 * modules/sales/sales.service.ts, uploadGncApr()) -- confirmed live that
 * table is real (829 rows) but stale, last updated 2026-05-30. Lands in our
 * own gnc_apr_daily_actual (sql/1736) instead of db_masmis, per this
 * project's Database Boundary Rule -- upstream/external schemas we only
 * ever read, never write.
 *
 * Duration columns are HH:MM:SS text in Mydashboards' own real sample data
 * for this report -- same shape LP's WebConsole APR uses, so this reuses
 * lp-apr-daily-bulk.service.ts's exact parser rather than a new one.
 */

export const GNC_APR_HEADERS = [
  "report_date",
  "user_name",
  "calls",
  "uid",
  "emp_id",
  "tl_name",
  "process_type",
  "login_time",
  "wait_time",
  "talk_time",
  "dispo_time",
  "pause_time",
  "net_login",
  "break_time",
  "acht",
  "atten",
] as const;

/** total_calls is NOT NULL with a 0 default -- a blank cell means zero, not null. */
export function parseCallCount(raw: unknown): number {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** HH:MM:SS / MM:SS text, or a bare seconds count -- same parser as
 *  lp-apr-daily-bulk.service.ts's parseDurationSeconds, for the same
 *  export-format reason (a real WebConsole/CRM export, not a decimal
 *  day-fraction source like DU Digital's). */
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

export function parseDurationSecondsOrNull(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  return parseDurationSeconds(v);
}

export function parseDate(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
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

export async function importGncAprBatch(
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
    "SELECT id FROM process_master WHERE process_name = 'GNC' AND active_status = 1 LIMIT 1",
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
      const msg = `Row ${row.row_no}: no active "GNC" process found to attach this row to`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const userName = String(data["user_name"] ?? "").trim();
    if (!userName) {
      const msg = `Row ${row.row_no}: "user_name" is required — it is part of the row's identity`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    const reportDate = parseDate(data["report_date"]);
    if (!reportDate) {
      const msg = `Row ${row.row_no}: "report_date" is required and could not be read`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    try {
      await db.execute(
        `INSERT INTO gnc_apr_daily_actual
           (id, process_id, uid, report_date, user_name, agent_code, tl_name, process_type,
            total_calls, login_seconds, wait_seconds, talk_seconds, dispo_seconds, pause_seconds,
            net_login_seconds, break_seconds, acht_seconds, attendance, data_source, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?)
         ON DUPLICATE KEY UPDATE
            uid = VALUES(uid),
            agent_code = VALUES(agent_code),
            tl_name = VALUES(tl_name),
            process_type = VALUES(process_type),
            total_calls = VALUES(total_calls),
            login_seconds = VALUES(login_seconds),
            wait_seconds = VALUES(wait_seconds),
            talk_seconds = VALUES(talk_seconds),
            dispo_seconds = VALUES(dispo_seconds),
            pause_seconds = VALUES(pause_seconds),
            net_login_seconds = VALUES(net_login_seconds),
            break_seconds = VALUES(break_seconds),
            acht_seconds = VALUES(acht_seconds),
            attendance = VALUES(attendance)`,
        [
          randomUUID(), processId,
          String(data["uid"] ?? "").trim() || null,
          reportDate, userName,
          String(data["emp_id"] ?? "").trim() || null,
          String(data["tl_name"] ?? "").trim() || null,
          String(data["process_type"] ?? "").trim() || null,
          parseCallCount(data["calls"]),
          parseDurationSeconds(data["login_time"]),
          parseDurationSeconds(data["wait_time"]),
          parseDurationSeconds(data["talk_time"]),
          parseDurationSeconds(data["dispo_time"]),
          parseDurationSeconds(data["pause_time"]),
          parseDurationSeconds(data["net_login"]),
          parseDurationSeconds(data["break_time"]),
          parseDurationSecondsOrNull(data["acht"]),
          String(data["atten"] ?? "").trim() || null,
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
