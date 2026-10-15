/**
 * DB health monitor — runs every 5 minutes.
 *
 * Kills sleeping connections that have been idle longer than IDLE_KILL_THRESHOLD_S
 * (default 300s). Without this, connections with uncommitted transactions hold InnoDB
 * row locks for up to 8 hours (the server wait_timeout), blocking other writers.
 *
 * Also logs when Threads_running is high so spikes are visible in the PM2 log without
 * needing DB admin access to the server.
 *
 * SESSION wait_timeout is already set to 300s per new connection in mysql.ts, so this
 * cron is a safety net for connections created before that change and for background
 * BGV-check-style loops that leave transactions open without rollback.
 *
 * shivam_user has PROCESS privilege (can see all threads) and can KILL connections it
 * owns or that are in mas_hrms. It cannot KILL connections owned by root or other users
 * unless it has SUPER — so we only issue KILL on rows where User matches our own user.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { logger } from "../logger.js";

const INTERVAL_MS = 5 * 60 * 1000;
const IDLE_KILL_THRESHOLD_S = 300;
const THREADS_RUNNING_WARN = 20;

let _timer: NodeJS.Timeout | undefined;

interface ProcessRow extends RowDataPacket {
  Id: number;
  User: string;
  db: string | null;
  Command: string;
  Time: number;
  State: string | null;
  Info: string | null;
}

interface StatusRow extends RowDataPacket {
  Variable_name: string;
  Value: string;
}

async function runDbHealthCheck(): Promise<void> {
  try {
    const [statusRows] = await db.query<StatusRow[]>(
      "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_running','Threads_connected')",
    );
    const stats: Record<string, number> = {};
    for (const r of statusRows) stats[r.Variable_name] = Number(r.Value);

    if ((stats.Threads_running ?? 0) >= THREADS_RUNNING_WARN) {
      logger.warn(
        { threads_running: stats.Threads_running, threads_connected: stats.Threads_connected },
        "[db-health] high Threads_running — DB under pressure",
      );
    }

    const [procs] = await db.query<ProcessRow[]>(
      `SELECT Id, User, db, Command, Time, State, LEFT(Info, 100) AS Info
         FROM information_schema.PROCESSLIST
        WHERE Command = 'Sleep'
          AND Time >= ?
          AND db = ?
          AND User = ?`,
      [IDLE_KILL_THRESHOLD_S, process.env.DB_NAME ?? "mas_hrms", process.env.DB_USER ?? "shivam_user"],
    );

    for (const proc of procs) {
      try {
        await db.query(`KILL CONNECTION ${proc.Id}`);
        logger.info(
          { id: proc.Id, user: proc.User, idle_s: proc.Time },
          "[db-health] killed stale sleeping connection",
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Connection may have already closed on its own — not an error
        if (!msg.includes("Unknown thread id")) {
          logger.warn({ id: proc.Id, err: msg }, "[db-health] KILL CONNECTION failed");
        }
      }
    }

    if (procs.length > 0) {
      logger.info(
        { killed: procs.length, threads_running: stats.Threads_running },
        "[db-health] stale connection sweep done",
      );
    }
  } catch (err: unknown) {
    logger.error({ err }, "[db-health] health check error");
  }
}

export function startDbHealthCron(): void {
  function schedule(): void {
    _timer = setTimeout(async () => {
      await runDbHealthCheck();
      schedule();
    }, INTERVAL_MS);
    _timer.unref();
  }
  schedule();
  logger.info("[db-health] scheduled every 5 min — kills idle connections >= 300s");
}

export function stopDbHealthCron(): void {
  if (_timer) {
    clearTimeout(_timer);
    _timer = undefined;
  }
}
