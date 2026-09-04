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
 * The order the self-healing sweep visits days — yesterday first, then oldest to newest.
 *
 * WHY THE ORDER IS LOAD-BEARING
 *
 * The sweep used to walk strictly oldest-first (`for (i = backfillDays; i >= 0; i--)`),
 * which put yesterday second-to-last, behind ~7 days of work. Each day costs 8-20 minutes,
 * so reaching yesterday took one to two hours — and this process restarts every 9-14
 * minutes under the deploy cadence, with the sweep bailing early whenever the 5-minute fast
 * path claims the lock. Yesterday was therefore the day the sweep almost never got to.
 *
 * That is the one day that most needs it. A punch group assessed while its day is still
 * open is assessed in `live` mode, where an odd punch count means "employee is still
 * inside" and applies 0 minutes (cosec-punch-interpretation.service.ts). That verdict is
 * correct at the time and wrong the moment the day closes — assessmentModeForPunchDate()
 * switches to `historical` and uses the span instead. Nothing re-derives it except this
 * sweep, so a day that never gets re-swept keeps its mid-shift verdict permanently.
 *
 * Measured on production 2026-08-14: 1,085 attendance_daily_record rows across 222
 * employees since 2026-07-01 sit at attendance_status='absent' while biometric_status is
 * 'present' with real minutes, each stamped `COSEC live review: odd_punch_count` on a date
 * long closed — several with a 09:14→19:18 clock pair and ~600 biometric minutes in the
 * same row. Absent pays zero.
 *
 * Yesterday first fixes that without starving the rest: the remaining days keep their
 * oldest-first order behind it, and every write is an idempotent upsert, so a sweep cut
 * short by a restart simply resumes next hour.
 */
export function backfillDayOrder(today: Date, backfillDays: number): string[] {
  const dayAt = (offset: number) => {
    const d = new Date(today);
    d.setDate(today.getDate() - offset);
    return dateOnly(d);
  };
  const yesterday = dayAt(1);
  const rest: string[] = [];
  for (let i = backfillDays; i >= 0; i--) {
    const day = dayAt(i);
    if (day !== yesterday) rest.push(day);
  }
  // backfillDays=0 means "today only" — there is no yesterday in the window to prioritise.
  return backfillDays >= 1 ? [yesterday, ...rest] : rest;
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
/** Warn below this share of the trailing median. 0.8 catches 2026-08-07 (68%) without firing on normal variance. */
const INCOMPLETE_DAY_RATIO = Number(process.env.NCOSEC_INCOMPLETE_DAY_RATIO ?? 0.8);
/** Unmapped users are punches thrown away. 171 active employees were unenrolled on 2026-08-11. */
const UNMAPPED_ALERT = Number(process.env.NCOSEC_UNMAPPED_ALERT ?? 25);

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


/**
 * Completeness, as opposed to freshness.
 *
 * warnIfFeedStale above only asks whether the newest record is recent. That cannot see a
 * day which synced, wrote some rows, and stopped — the feed still looks current because
 * later days landed fine. On 2026-08-07 exactly that happened: 905 distinct users punched
 * at the device and only 472 reached biometric_attendance_log, 52% against a steady
 * 76-81%. Nothing noticed. It was found four days later by hand, by which point 139 days
 * carrying a complete biometric in-and-out were sitting in payroll as missing_punch,
 * which pays zero.
 *
 * Compares the last completed day against the median of the trailing window rather than a
 * fixed floor, because volume varies with headcount and weekday. Sundays are skipped —
 * they run roughly half a weekday and would warn every week.
 */
async function warnIfDayIncomplete(): Promise<void> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT punch_date AS d, COUNT(*) AS n
         FROM biometric_attendance_log
        WHERE punch_date >= DATE_SUB(CURDATE(), INTERVAL 21 DAY)
          AND punch_date <  CURDATE()
        GROUP BY punch_date
        ORDER BY punch_date`,
    );
    if (rows.length < 7) return; // not enough history to judge

    const latest = rows[rows.length - 1] as any;
    const day = new Date(String(latest.d) + "T00:00:00+05:30");
    if (day.getUTCDay() === 0) return; // Sunday

    const counts = rows.map((r: any) => Number(r.n)).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)];
    if (!median) return;

    const ratio = Number(latest.n) / median;
    if (ratio < INCOMPLETE_DAY_RATIO) {
      console.error(
        `[cosec-sync] INCOMPLETE: ${latest.d} ingested ${latest.n} punch-days against a `
        + `trailing median of ${median} (${Math.round(ratio * 100)}%). Punches exist upstream `
        + `that never reached HRMS; unresolved days pay zero. Re-run `
        + `scripts/cosec-sync-backfill.ts ${latest.d} ${latest.d} and check the cause.`,
      );
    }
  } catch (error) {
    // Never let a probe take the sync down.
    console.warn("[cosec-sync] completeness check failed", error instanceof Error ? error.message : String(error));
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
      console.log(`[cosec-sync] migrated=${result.migratedDays} unchanged=${result.skippedUnchanged} pulled=${result.pulledEvents} unmapped=${result.unmappedUsers.length} failed=${result.failed.length}`);
      // An unmapped user is a person whose punches were discarded outright. Logged at
      // info level this reads as routine; it is how 171 active employees came to have no
      // attendance at all while the sync reported success every five minutes.
      if (result.unmappedUsers.length > UNMAPPED_ALERT) {
        console.error(
          `[cosec-sync] UNMAPPED: ${result.unmappedUsers.length} COSEC users have no employee mapping; `
          + `their punches are being discarded. Any that are active employees have no attendance `
          + `and therefore nothing to be paid on — see scripts/enrol-unenrolled-punchers.ts.`,
        );
      }
    } catch (error) {
      console.error("[cosec-sync] error", error instanceof Error ? error.message : String(error));
    }
    await warnIfFeedStale(staleHours);
    await warnIfDayIncomplete();
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

  // The sweep runs one day at a time, not one wide call across the whole window.
  //
  // A single sync() spanning the window does not finish here. Measured 2026-08-12: an
  // 11-day call sat 70+ minutes in ep_poll with 31s of CPU, no active query and zero rows
  // written, while the same range run as separate single-day calls completed every day
  // (8-20 min each, failed=0). Worse, this process restarts every 9-14 minutes under the
  // deploy cadence, so a multi-hour call is killed long before it commits anything and the
  // sweep never repairs the gap it exists for - which is how 2026-08-07 stayed at 52%
  // ingested for four days with zero completed cycles.
  //
  // Chunked, each day commits on its own. A restart costs at most the day in flight, and
  // the next sweep redoes it because every write is an idempotent upsert. One day failing
  // no longer abandons the rest of the window.
  const backfill = async () => {
    if (cosecSyncService.isRunning()) return;
    const today = new Date();
    let migrated = 0, failedDays = 0, doneDays = 0;
    // Yesterday first — see backfillDayOrder(). It is the day whose live-mode verdicts
    // have just gone stale, and the day the old oldest-first order almost never reached.
    const days = backfillDayOrder(today, backfillDays);
    for (const day of days) {
      // Re-check each iteration: the 5-minute fast path may claim the lock mid-sweep.
      if (cosecSyncService.isRunning()) break;
      try {
        const result = await cosecSyncService.sync({ from: day, to: day });
        migrated += result.migratedDays;
        doneDays += 1;
      } catch (error) {
        failedDays += 1;
        console.error(`[cosec-sync] backfill ${day} failed`, error instanceof Error ? error.message : String(error));
      }
    }
    console.log(`[cosec-sync] backfill ${backfillDays}d days=${doneDays}/${backfillDays + 1} migrated=${migrated} failedDays=${failedDays}`);
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
