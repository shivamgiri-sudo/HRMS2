/**
 * Runs the lock watchdog (db/lock-watchdog.ts) every DB_LOCK_WATCHDOG_INTERVAL_S seconds (default 15), and prunes
 * db_lock_incident once a day. A MySQL named lock makes it a single runner even if two processes start it, so one
 * stuck connection is never "killed" and recorded twice.
 */
import { db } from "../db/mysql.js";
import { logger } from "../logger.js";
import { loadWatchdogConfig, pruneIncidents, sweepOnce } from "../db/lock-watchdog.js";

const LOCK_NAME = "hrms:db-lock-watchdog";
const PRUNE_EVERY_MS = 24 * 60 * 60_000;

let timer: NodeJS.Timeout | undefined;
let lastPrune = 0;
let loggedNoAccess = false;

// db (not the raw pool) is what mysql.ts exposes; the watchdog only needs query/execute/getConnection.
const pool = db as unknown as Parameters<typeof sweepOnce>[0];

async function tick(): Promise<void> {
  const cfg = loadWatchdogConfig();
  if (cfg.mode === "off") return;
  const conn = await db.getConnection();
  try {
    const [[lock]] = await conn.query<Array<{ got: number }> & import("mysql2").RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [LOCK_NAME]);
    if (!lock || Number(lock.got) !== 1) return; // another process is the runner
    try {
      const { actions, error } = await sweepOnce(pool, cfg);
      if (error && !loggedNoAccess) {
        loggedNoAccess = true;
        logger.warn({ err: error }, "[db-lock-watchdog] cannot read lock waits (needs SELECT on performance_schema and PROCESS); watchdog is idle");
      }
      for (const a of actions) {
        const fields = { thread: a.thread, user: a.user, age_s: a.ageS, waiters: a.waiters, max_wait_s: a.maxWaitS, query: a.query?.slice(0, 160) };
        if (a.action === "killed") logger.warn(fields, `[db-lock-watchdog] KILLED stuck lock holder: ${a.reason}`);
        else logger.warn(fields, `[db-lock-watchdog] ALERT: ${a.reason}`);
      }
      if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
        lastPrune = Date.now();
        const removed = await pruneIncidents(pool);
        if (removed > 0) logger.info({ removed }, "[db-lock-watchdog] pruned old incident rows");
      }
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]).catch(() => undefined);
    }
  } catch (err) {
    logger.error({ err }, "[db-lock-watchdog] sweep error");
  } finally {
    conn.release();
  }
}

export function startDbLockWatchdogCron(): void {
  const cfg = loadWatchdogConfig();
  if (cfg.mode === "off") { logger.info("[db-lock-watchdog] DB_LOCK_WATCHDOG_MODE=off: not started"); return; }
  const intervalMs = Math.max(5, Number(process.env.DB_LOCK_WATCHDOG_INTERVAL_S) || 15) * 1000;
  const schedule = (): void => {
    timer = setTimeout(async () => { await tick(); schedule(); }, intervalMs);
    timer.unref();
  };
  schedule();
  logger.info(`[db-lock-watchdog] ${cfg.mode} mode, every ${intervalMs / 1000}s: kills idle lock holders blocking others for >= ${cfg.idleBlockerS}s`);
}

export function stopDbLockWatchdogCron(): void {
  if (timer) { clearTimeout(timer); timer = undefined; }
}
