/**
 * Employee Master snapshot refresh — scheduled job.
 *
 * Keeps employee_master_snapshot (migration 1615) in sync by re-running
 * refreshEmployeeMasterSnapshot() on a fixed interval. Same self-rescheduling setTimeout
 * pattern as cron/business-action-sync.cron.ts — see that file for the convention this
 * follows.
 *
 * Interval: every 30 minutes. db_bill (the slower of the two sources this pulls from) only
 * changes on manual HR edits, not in real time, so half-hourly is comfortably fresh without
 * adding meaningful load — the underlying query already runs in well under a minute for the
 * full ~59k-employee population.
 */
import { db } from "../db/mysql.js";
import { refreshEmployeeMasterSnapshot } from "../modules/reporting/employee-master-snapshot.service.js";
import type { RowDataPacket } from "mysql2";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let scheduler: NodeJS.Timeout | undefined;
let refreshInFlight = false;

function scheduleNext(delayMs: number): void {
  scheduler = setTimeout(runRefresh, delayMs);
  scheduler.unref();
}

async function runRefresh(): Promise<void> {
  // Guards against a slow run overlapping its own next tick — shouldn't happen at 30-minute
  // spacing given the job normally finishes in well under a minute, but a stalled db_bill
  // connection could in principle make one run long enough to collide with the next.
  if (refreshInFlight) {
    console.warn("[CRON] employee-master-snapshot refresh already in flight, skipping this tick");
    scheduleNext(REFRESH_INTERVAL_MS);
    return;
  }

  refreshInFlight = true;
  console.log("[CRON] Running employee-master-snapshot refresh...");
  try {
    const result = await refreshEmployeeMasterSnapshot();
    console.log(
      `[CRON] employee-master-snapshot refresh complete: ${result.rowsWritten}/${result.rowsFetched} rows written in ${result.durationMs}ms`
    );
  } catch (error) {
    console.error("[CRON] employee-master-snapshot refresh error:", error);
  } finally {
    refreshInFlight = false;
    scheduler = undefined;
    scheduleNext(REFRESH_INTERVAL_MS);
  }
}

export async function startEmployeeMasterSnapshotScheduler(): Promise<void> {
  if (scheduler) return;
  console.log("[CRON] Employee-master-snapshot scheduler starting (every 30 minutes)");

  // Every deploy restarts hrms2-workers (ensure_backend_pm2_processes in deploy.yml does a
  // fresh pm2 delete+start), and this scheduler's in-memory refreshInFlight guard resets to
  // false on every restart — it has no memory of a refresh that just completed one minute
  // before the process was recycled. A flat "always fire 60s after boot" turns every deploy
  // into a forced full-table refresh, no matter how fresh the snapshot already is.
  //
  // 2026-09-12: this is exactly what took production down. Several deploy attempts in quick
  // succession each restarted the workers process, each one re-firing this same ~59k-row,
  // now-heavier (this session added employee_address + employee_bank_detail joins) export
  // query 60 seconds after boot — independently of the 30-minute cadence this comment
  // originally promised. The pile-up of concurrent copies of that query held metadata locks
  // that blocked routine startup DDL (CREATE TABLE IF NOT EXISTS, an in-flight ALTER
  // DATABASE) on an unrelated deploy, which is what actually produced the 502s.
  //
  // Fix: read the snapshot's own last-refreshed timestamp from the database itself (not
  // in-memory state, which a restart just destroyed) and schedule the first run for
  // whatever's left of the normal 30-minute window, not immediately. Only fires early when
  // the snapshot is genuinely missing, empty, or older than the interval already allows for.
  let firstRunDelayMs = 60_000;
  try {
    const [rows] = await db.execute<(RowDataPacket & { latest: string | null; cnt: number })[]>(
      "SELECT MAX(snapshot_refreshed_at) AS latest, COUNT(*) AS cnt FROM employee_master_snapshot"
    );
    const latest = rows[0]?.latest;
    const cnt = Number(rows[0]?.cnt ?? 0);
    if (latest && cnt > 0) {
      const ageMs = Date.now() - new Date(latest).getTime();
      const remainingMs = REFRESH_INTERVAL_MS - ageMs;
      if (remainingMs > 60_000) {
        firstRunDelayMs = remainingMs;
        console.log(
          `[CRON] employee-master-snapshot last refreshed ${Math.round(ageMs / 1000)}s ago — ` +
          `deferring first run ${Math.round(firstRunDelayMs / 1000)}s instead of refreshing again on this restart`
        );
      }
    }
  } catch (error) {
    // Table missing/unreachable at boot is exactly the case that should still run soon —
    // fall through to the 60s default rather than let this check itself block startup.
    console.warn("[CRON] employee-master-snapshot freshness check failed, using default 60s delay:", error);
  }

  scheduleNext(firstRunDelayMs);
}

export function stopEmployeeMasterSnapshotScheduler(): void {
  if (scheduler) clearTimeout(scheduler);
  scheduler = undefined;
  console.log("[CRON] Employee-master-snapshot scheduler stopped");
}
