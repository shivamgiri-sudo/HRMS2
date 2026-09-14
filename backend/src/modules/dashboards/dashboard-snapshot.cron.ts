import { writeDashboardSnapshots } from "./dashboard-snapshot.service.js";
import { getIstDateString } from "../../utils/dateUtils.js";

let _timer: ReturnType<typeof setInterval> | null = null;
let _lastRunDate: string | null = null;
let _running = false;

/**
 * Daily snapshot of every dashboard metric, which is what trend arrows compare against.
 *
 * Without this the table stays empty, getMetricTrend returns previousValue: null, and no
 * tile can ever show a period-on-period change. One run gives a baseline; arrows appear
 * from the second day.
 *
 * Deliberately NOT run at startup, unlike the other schedulers in server.ts. A full pass is
 * 72 scopes x 19 metrics — around 1,370 metric executions and roughly six minutes of
 * queries. Firing that on every deploy or restart would put a heavy load on the database at
 * exactly the moment the app is least able to absorb it, and would rewrite the day's row
 * with a mid-reconciliation value. It runs on the schedule only.
 */
const RUN_AT_HOUR_IST = 2; // 02:00 IST, after the nightly attendance reconciliation.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function istHourOf(instant: Date): number {
  // getTime() is already a UTC epoch, so IST is a flat +5:30 from it. An earlier version
  // also added getTimezoneOffset(), which double-counted the shift and moved the window by
  // 5.5 hours on an IST host — the job would have run at 20:30 IST instead of 02:00, i.e.
  // during the working day and before the nightly reconciliation it is meant to follow.
  // Exported so the window is testable without waiting for a real 02:00.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(instant.getTime() + IST_OFFSET_MS).getUTCHours();
}

function istHour(): number {
  return istHourOf(new Date());
}

export async function runDashboardSnapshot(): Promise<void> {
  if (_running) {
    console.warn("[dashboard-snapshot-cron] previous run still in progress — skipping");
    return;
  }
  _running = true;
  const started = Date.now();
  try {
    const result = await writeDashboardSnapshots();
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(
      `[dashboard-snapshot-cron] ${result.snapshotDate}: ${result.written} written, ` +
        `${result.skippedNoValue} skipped, ${result.failed} failed, ${seconds}s`,
    );
    // Failures are logged individually by the service, but a summary line here is what a
    // cron log actually gets read for.
    for (const failure of result.failures.slice(0, 10)) {
      console.error(
        `[dashboard-snapshot-cron] FAILED ${failure.metricCode} @ ${failure.scope}: ${failure.reason}`,
      );
    }
  } catch (err) {
    console.error("[dashboard-snapshot-cron] run failed:", err);
  } finally {
    _running = false;
  }
}

export function startDashboardSnapshotScheduler(): void {
  if (_timer) return;

  // Polls rather than sleeping until the exact hour, so a restart at any time of day still
  // catches the window. _lastRunDate makes it idempotent within a day; the unique index
  // added in 603 makes it idempotent at the row level even if that guard is bypassed.
  const tick = () => {
    const today = getIstDateString();
    if (_lastRunDate === today) return;
    if (istHour() !== RUN_AT_HOUR_IST) return;
    _lastRunDate = today;
    void runDashboardSnapshot();
  };

  _timer = setInterval(tick, CHECK_INTERVAL_MS);
  console.log(
    `[dashboard-snapshot-cron] scheduler started (daily at ${RUN_AT_HOUR_IST}:00 IST)`,
  );
}

export function stopDashboardSnapshotScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
