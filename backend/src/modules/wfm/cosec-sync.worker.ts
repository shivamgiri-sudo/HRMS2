import { cosecSyncService } from "./cosec-sync.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

let intervalHandle: NodeJS.Timeout | null = null;
let backfillHandle: NodeJS.Timeout | null = null;

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function dateOnly(value: Date): string {
  // IST = UTC + 5:30 — must use IST date so the sync window aligns with the
  // calendar day on the COSEC server (which stores wall-clock IST times).
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Shout when the biometric feed has gone quiet.
 *
 * This feed is the source every non-Operations employee's payroll attendance is built
 * from, and it fails silently: nothing errors, the ADR simply stops gaining rows and
 * the days quietly resolve to absent/missing_punch. cosec_punch_sync sat frozen from
 * 2026-06-18 for seven weeks without a single complaint in the logs, and the Aug 1-5
 * decay (621/222/431/371/22 users against a steady upstream ~800) went unnoticed until
 * someone opened the calendar and found yesterday blank.
 *
 * A stale feed is therefore logged at error level every cycle, so the failure is loud
 * from the first hour instead of being discovered a payroll run later.
 */
async function warnIfFeedStale(staleHours: number): Promise<void> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(GREATEST(COALESCE(last_punch, '1970-01-01'),
                           COALESCE(updated_at,  '1970-01-01'))) AS newest
         FROM integration_biometric_daily`,
    );
    const newest = (rows[0] as any)?.newest;
    if (!newest) {
      console.error("[cosec-sync] STALE: integration_biometric_daily is empty — payroll attendance has no biometric source");
      return;
    }
    const ageHours = (Date.now() - new Date(String(newest).replace(" ", "T")).getTime()) / 3_600_000;
    if (ageHours > staleHours) {
      console.error(
        `[cosec-sync] STALE: newest biometric record is ${ageHours.toFixed(1)}h old `
        + `(threshold ${staleHours}h, newest=${newest}). Payroll attendance for every `
        + `non-Operations employee is being built from stale data — check the NCOSEC link.`,
      );
    }
  } catch (error) {
    // Never let the freshness probe take the sync down with it.
    console.warn("[cosec-sync] freshness check failed", error instanceof Error ? error.message : String(error));
  }
}

export function startCosecSyncWorker() {
  if (intervalHandle) return;
  const explicitlyDisabled = process.env.NCOSEC_SYNC_ENABLED === "false";
  const configured = Boolean(
    process.env.NCOSEC_DB_HOST
    && process.env.NCOSEC_DB_USER
    && process.env.NCOSEC_DB_PASSWORD
  );
  if (explicitlyDisabled || !configured) {
    // error, not log: on the API host this is the difference between "COSEC is
    // deliberately off here" and "payroll attendance silently has no source", and
    // the quiet console.log meant nobody could tell which had happened.
    console.error(
      `[cosec-sync] NOT RUNNING — ${explicitlyDisabled ? "NCOSEC_SYNC_ENABLED=false" : "NCOSEC_DB_HOST/USER/PASSWORD not configured"}. `
      + `Biometric payroll attendance will not update in this process.`,
    );
    return;
  }

  const intervalMs = positiveNumber("NCOSEC_SYNC_INTERVAL_MS", 300000);
  const lookbackDays = positiveNumber("NCOSEC_SYNC_LOOKBACK_DAYS", 1);
  const staleHours = positiveNumber("NCOSEC_STALE_ALERT_HOURS", 6);

  const execute = async () => {
    if (cosecSyncService.isRunning()) return;
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - lookbackDays);

    try {
      const result = await cosecSyncService.sync({
        from: dateOnly(from),
        to: dateOnly(to),
      });
      console.log(`[cosec-sync] migrated=${result.migratedDays} pulled=${result.pulledEvents} unmapped=${result.unmappedUsers.length} failed=${result.failed.length}`);
    } catch (error) {
      console.error("[cosec-sync] error", error instanceof Error ? error.message : String(error));
    }
    await warnIfFeedStale(staleHours);
  };

  // Self-healing backfill.
  //
  // The 5-minute cycle above only ever looks back `lookbackDays` (default 1). That
  // makes a missed day unrecoverable: once it falls out of the window nothing ever
  // asks NCOSEC for it again, so an outage becomes a permanent hole in payroll
  // attendance rather than a delay. That is what turned a stalled worker into
  // Aug 1-5 landing 621/222/431/371/22 users against a steady upstream ~800.
  //
  // A wider window on the 5-minute cycle would be far too heavy — each punch group
  // costs a processEmployee + upsert, so ~1,700 groups/day of migration work. Instead
  // the wide sweep runs on its own slow timer and re-upserts idempotently, healing
  // whatever the fast path missed. Both paths share cosecSyncService's own lock, so
  // they serialise rather than collide.
  const backfillMs = positiveNumber("NCOSEC_BACKFILL_INTERVAL_MS", 3_600_000); // hourly
  const backfillDays = positiveNumber("NCOSEC_BACKFILL_DAYS", 7);

  const backfill = async () => {
    if (cosecSyncService.isRunning()) return;
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - backfillDays);
    try {
      const result = await cosecSyncService.sync({ from: dateOnly(from), to: dateOnly(to) });
      console.log(`[cosec-sync] backfill ${backfillDays}d migrated=${result.migratedDays} pulled=${result.pulledEvents} unmapped=${result.unmappedUsers.length} failed=${result.failed.length}`);
    } catch (error) {
      console.error("[cosec-sync] backfill error", error instanceof Error ? error.message : String(error));
    }
  };

  intervalHandle = setInterval(execute, intervalMs);
  backfillHandle = setInterval(() => { void backfill(); }, backfillMs);
  void execute();
  console.log(`[cosec-sync] started intervalMs=${intervalMs} lookbackDays=${lookbackDays} backfillMs=${backfillMs} backfillDays=${backfillDays}`);
}

export function stopCosecSyncWorker() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  if (backfillHandle) clearInterval(backfillHandle);
  backfillHandle = null;
}
