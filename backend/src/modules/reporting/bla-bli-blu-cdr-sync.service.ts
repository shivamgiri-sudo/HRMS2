import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getNamedPool } from "../kpi/kpi-studio.pools.js";

/**
 * Bla Bli Blu's own "B-3 Dashboard" workbook family (e.g. "BLA BLI
 * BLU_Master_Dashboard Aug_26.xlsb", a real Drive download found this
 * session) has a "CDR Raw" sheet whose data already exists live:
 * dialer_db.cdr_bla_bli_blu, confirmed live 2026-09-10 with 321,917 real
 * rows, current to today. Lands a daily aggregate in mas_hrms's
 * bla_bli_blu_cdr_daily_actual (sql/1728), per the Database Boundary Rule.
 */

interface DailyRow extends RowDataPacket {
  report_date: string;
  total_calls: number;
  unique_customers: number;
  connected_calls: number;
  unique_agents: number;
  talk_seconds: number | null;
}
interface Ref extends RowDataPacket { id: string }

export function buildDailySql(): string {
  return `SELECT DATE(date_time) AS report_date,
      COUNT(*) AS total_calls,
      COUNT(DISTINCT customer_number) AS unique_customers,
      SUM(CASE WHEN call_status = 'patched' THEN 1 ELSE 0 END) AS connected_calls,
      COUNT(DISTINCT agent_name) AS unique_agents,
      SUM(talk_time) AS talk_seconds
    FROM cdr_bla_bli_blu
    WHERE date_time >= ?
    GROUP BY DATE(date_time)
    ORDER BY report_date DESC`;
}

/** Same fix as inbound-cdr-sync.service.ts's formatCallDate -- toISOString() is wrong on an IST host. */
export function formatReportDate(raw: unknown): string {
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(raw).slice(0, 10);
}

export async function syncBlaBliBluCdrDaily(
  importedByUserId: string,
  lookbackDays = 30,
): Promise<{ rowsUpserted: number; error?: string }> {
  const dialerPool = await getNamedPool("dialer");
  const sinceDate = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);

  const [procRows] = await db.execute<Ref[]>(
    `SELECT id FROM process_master WHERE process_name = 'Bla Bli Blu' AND active_status = 1 LIMIT 1`,
  );
  const processId = procRows[0]?.id;
  if (!processId) {
    return { rowsUpserted: 0, error: `No active "Bla Bli Blu" process found` };
  }

  try {
    const [rows] = await dialerPool.query<DailyRow[]>(buildDailySql(), [sinceDate]);

    let rowsUpserted = 0;
    for (const row of rows) {
      const reportDate = formatReportDate(row.report_date);
      await db.execute(
        `INSERT INTO bla_bli_blu_cdr_daily_actual
           (id, process_id, report_date, total_calls, unique_customers, connected_calls,
            unique_agents, talk_seconds, data_source, synced_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'dialer_db_live_sync', NOW(), ?)
         ON DUPLICATE KEY UPDATE
            total_calls = VALUES(total_calls),
            unique_customers = VALUES(unique_customers),
            connected_calls = VALUES(connected_calls),
            unique_agents = VALUES(unique_agents),
            talk_seconds = VALUES(talk_seconds),
            synced_at = NOW()`,
        [
          randomUUID(), processId, reportDate, row.total_calls, row.unique_customers,
          row.connected_calls, row.unique_agents, row.talk_seconds,
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
