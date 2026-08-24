import { writeEmployeePerformanceSnapshots } from "./performance-scorecard-snapshot.service.js";
import { getIstDateString } from "../../utils/dateUtils.js";

let _timer: ReturnType<typeof setInterval> | null = null;
let _lastRunDate: string | null = null;
let _running = false;

const RUN_AT_HOUR_IST = 3; // 03:00 IST, after the dashboard snapshot (02:00) and attendance reconciliation.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function istHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
  );
}

async function runPerformanceScorecardSnapshot(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    const date = getIstDateString();
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = yesterday.toISOString().slice(0, 10);
    const { written, errors } = await writeEmployeePerformanceSnapshots(targetDate);
    console.log(`[performance-scorecard-cron] wrote ${written} snapshot rows for ${targetDate}`);
    if (errors.length > 0) {
      console.error(
        `[performance-scorecard-cron] ${errors.length} employee(s) failed for ${targetDate}:`,
        errors.slice(0, 10),
      );
    }
  } catch (err) {
    console.error("[performance-scorecard-cron] snapshot run failed", err);
  } finally {
    _running = false;
  }
}

export function startPerformanceScorecardSnapshotScheduler(): void {
  if (_timer) return;
  const tick = () => {
    const today = getIstDateString();
    if (_lastRunDate === today) return;
    if (istHour() !== RUN_AT_HOUR_IST) return;
    _lastRunDate = today;
    void runPerformanceScorecardSnapshot();
  };
  _timer = setInterval(tick, CHECK_INTERVAL_MS);
  console.log(`[performance-scorecard-cron] scheduler started (daily at ${RUN_AT_HOUR_IST}:00 IST)`);
}

export function stopPerformanceScorecardSnapshotScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
