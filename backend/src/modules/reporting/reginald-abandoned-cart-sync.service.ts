import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getNamedPool } from "../kpi/kpi-studio.pools.js";

/**
 * Reginald Men's own "Abandoned Cart Dashboard SOP" (a separate dashboard
 * from the already-built Reginald Men Email one, email-ticket-daily-bulk.
 * service.ts / sql/1700) is not a manual-paste procedure -- its own "Data
 * Source Mapping"/"Direct Paths" sheets name exact live tables:
 * dialer_db.cdr_ob_25 and dialer_db.vicidial_agent_log_10_25, both
 * confirmed live 2026-09-10 (2.7M / 1.42M rows), filtered to this
 * dashboard's own 5 campaigns (ABANDON, KANNADA, KERALA, TAMIL, TELUGU),
 * all confirmed present in the real data. Lands in mas_hrms's
 * reginald_abandoned_cart_daily_actual (sql/1726), per the Database
 * Boundary Rule -- dialer_db stays read-only.
 *
 * Scoped to what the SOP defines unambiguously (Total CDR, Unique Dialed,
 * APR login/talk/wrap/wait/dead) -- "Unique Connected"/"Connect %"/"AHT"
 * depend on a "strict connect flag" the SOP never enumerates against the
 * real CallStatus values, so those are deliberately not computed here
 * rather than guessed.
 */

const CAMPAIGNS = ["ABANDON", "KANNADA", "KERALA", "TAMIL", "TELUGU"];

function inList(vals: string[]): string {
  return vals.map((v) => `'${v.replace(/'/g, "''")}'`).join(",");
}

interface DailyCdrRow extends RowDataPacket {
  report_date: string;
  total_cdr: number;
  unique_dialed: number;
}
interface DailyAprRow extends RowDataPacket {
  report_date: string;
  login_count: number;
  talk_seconds: number | null;
  wrapup_seconds: number | null;
  wait_seconds: number | null;
  dead_seconds: number | null;
}
interface Ref extends RowDataPacket { id: string }

/** Exported so unit tests can assert on the exact SQL text without needing a live dialer_db connection. */
export function buildCdrDailySql(): string {
  const list = inList(CAMPAIGNS);
  return `SELECT DATE(CallDate) AS report_date,
      COUNT(*) AS total_cdr,
      COUNT(DISTINCT PhoneNumber) AS unique_dialed
    FROM cdr_ob_25
    WHERE campaign_id IN (${list}) AND CallDate >= ?
    GROUP BY DATE(CallDate)
    ORDER BY report_date DESC`;
}

export function buildAprDailySql(): string {
  const list = inList(CAMPAIGNS);
  return `SELECT DATE(event_time) AS report_date,
      COUNT(DISTINCT user) AS login_count,
      SUM(talk_sec) AS talk_seconds,
      SUM(dispo_sec) AS wrapup_seconds,
      SUM(wait_sec) AS wait_seconds,
      SUM(dead_sec) AS dead_seconds
    FROM vicidial_agent_log_10_25
    WHERE campaign_id IN (${list}) AND event_time >= ?
    GROUP BY DATE(event_time)
    ORDER BY report_date DESC`;
}

/** mysql2 returns a DATE column as a Date object -- see inbound-cdr-sync.service.ts's formatCallDate for why toISOString() is wrong on an IST host. */
export function formatReportDate(raw: unknown): string {
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(raw).slice(0, 10);
}

export async function syncReginaldAbandonedCartDaily(
  importedByUserId: string,
  lookbackDays = 30,
): Promise<{ rowsUpserted: number; error?: string }> {
  const dialerPool = await getNamedPool("dialer");
  const sinceDate = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);

  const [procRows] = await db.execute<Ref[]>(
    `SELECT id FROM process_master WHERE process_name = 'Reginald' AND active_status = 1 LIMIT 1`,
  );
  const processId = procRows[0]?.id;
  if (!processId) {
    return { rowsUpserted: 0, error: `No active "Reginald" process found` };
  }

  try {
    const [cdrRows] = await dialerPool.query<DailyCdrRow[]>(buildCdrDailySql(), [sinceDate]);
    const [aprRows] = await dialerPool.query<DailyAprRow[]>(buildAprDailySql(), [sinceDate]);
    const aprByDate = new Map(aprRows.map((r) => [formatReportDate(r.report_date), r]));

    let rowsUpserted = 0;
    for (const row of cdrRows) {
      const reportDate = formatReportDate(row.report_date);
      const apr = aprByDate.get(reportDate);
      await db.execute(
        `INSERT INTO reginald_abandoned_cart_daily_actual
           (id, process_id, report_date, total_cdr, unique_dialed,
            login_count, talk_seconds, wrapup_seconds, wait_seconds, dead_seconds,
            data_source, synced_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dialer_db_live_sync', NOW(), ?)
         ON DUPLICATE KEY UPDATE
            total_cdr = VALUES(total_cdr),
            unique_dialed = VALUES(unique_dialed),
            login_count = VALUES(login_count),
            talk_seconds = VALUES(talk_seconds),
            wrapup_seconds = VALUES(wrapup_seconds),
            wait_seconds = VALUES(wait_seconds),
            dead_seconds = VALUES(dead_seconds),
            synced_at = NOW()`,
        [
          randomUUID(), processId, reportDate, row.total_cdr, row.unique_dialed,
          apr?.login_count ?? null, apr?.talk_seconds ?? null, apr?.wrapup_seconds ?? null,
          apr?.wait_seconds ?? null, apr?.dead_seconds ?? null,
          importedByUserId,
        ] as never[],
      );
      rowsUpserted++;
    }
    return { rowsUpserted };
  } catch (err: unknown) {
    return { rowsUpserted: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
