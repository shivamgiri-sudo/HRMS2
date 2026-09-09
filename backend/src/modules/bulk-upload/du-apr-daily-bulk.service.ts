import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * DU Digital's "6. DU Korea" / "6. DU Thailand" (per its own SOP: "Open DU
 * CRM... Agents Reports... Click Agents Time details... Paste into APR Raw"
 * -- no DB backing exists anywhere). Columns read verbatim from two real
 * samples: "Du-Digital Korea MIS Dashboard Sep'26.xlsb" and "Du-Digital
 * Thailand MIS Dashboard Sep'26.xlsb", both sheet "APR Raw".
 *
 * Unlike LP's WebConsole APR (lp-apr-daily-bulk.service.ts), whose duration
 * columns are HH:MM:SS text, this source's duration columns are day-fraction
 * decimals (e.g. 0.4174 = 41.74% of a day = 36,061 seconds) -- confirmed
 * live against the source's own "Login Time In Sec" column. A raw seconds
 * value is also accepted defensively, in case a re-export already converts
 * it (same reasoning as this session's other duration coercions).
 */

export const DU_APR_HEADERS = [
  "Date",
  "Agent",
  "Agent_ID",
  "Calls",
  "Login_Seconds",
  "Net_Login_Seconds",
  "Talk_Seconds",
  "Idle_Seconds",
  "Wrapup_Seconds",
  "Break_Seconds",
  "Dead_Seconds",
  "Utilization_Pct",
  "Week",
] as const;

export function parseCount(raw: unknown): number {
  const v = String(raw ?? "").trim();
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/**
 * Accepts three shapes: HH:MM:SS text, a day-fraction decimal (0 <= n <= 3,
 * the source's own native format), or an already-converted raw seconds
 * value. The 0-3 day cutoff comfortably separates "fraction of a day" from
 * "seconds" for any realistic per-agent daily duration.
 */
export function parseSecondsFlexible(raw: unknown): number {
  const v = String(raw ?? "").trim();
  if (!v) return 0;
  if (v.includes(":")) {
    const parts = v.split(":").map((p) => Number(p));
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      return parts[0] * 60 + parts[1];
    }
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n <= 3 ? Math.round(n * 86400) : Math.round(n);
}

/** The source's Utilization % is a plain fraction (0.1503 = 15.04%), not a pre-multiplied percentage. */
export function parseUtilizationPct(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? n * 100 : n;
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

    const callDate = parseDate(data["Date"]);
    if (!callDate) {
      const msg = `Row ${row.row_no}: "Date" is required and could not be read`;
      errors.push(msg);
      errorUpdates.push({ rowId: row.id, message: msg });
      errorRows++;
      continue;
    }

    try {
      await db.execute(
        `INSERT INTO du_apr_daily_actual
           (id, process_id, dashboard_label, agent_name, agent_code, call_date, total_calls,
            login_seconds, net_login_seconds, talk_seconds, idle_seconds, wrapup_seconds,
            break_seconds, dead_seconds, utilization_pct, week_label,
            data_source, source_reference, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_upload', ?, ?)
         ON DUPLICATE KEY UPDATE
            agent_code = VALUES(agent_code),
            total_calls = VALUES(total_calls),
            login_seconds = VALUES(login_seconds),
            net_login_seconds = VALUES(net_login_seconds),
            talk_seconds = VALUES(talk_seconds),
            idle_seconds = VALUES(idle_seconds),
            wrapup_seconds = VALUES(wrapup_seconds),
            break_seconds = VALUES(break_seconds),
            dead_seconds = VALUES(dead_seconds),
            utilization_pct = VALUES(utilization_pct),
            week_label = VALUES(week_label)`,
        [
          randomUUID(), processId, dashboardLabel, agentName,
          String(data["Agent_ID"] ?? "").trim() || null,
          callDate,
          parseCount(data["Calls"]),
          parseSecondsFlexible(data["Login_Seconds"]),
          parseSecondsFlexible(data["Net_Login_Seconds"]),
          parseSecondsFlexible(data["Talk_Seconds"]),
          parseSecondsFlexible(data["Idle_Seconds"]),
          parseSecondsFlexible(data["Wrapup_Seconds"]),
          parseSecondsFlexible(data["Break_Seconds"]),
          parseSecondsFlexible(data["Dead_Seconds"]),
          parseUtilizationPct(data["Utilization_Pct"]),
          String(data["Week"] ?? "").trim() || null,
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

export async function importDuAprKoreaBatch(batchId: string, importedByUserId: string) {
  return importBatch(batchId, importedByUserId, "KOREA");
}

export async function importDuAprThailandBatch(batchId: string, importedByUserId: string) {
  return importBatch(batchId, importedByUserId, "THAILAND");
}
