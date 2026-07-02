import { syncAprMetrics, syncAttendanceMetrics, syncQualityMetrics } from '../modules/kpi/kpi-data-connector.service.js';

// ── Configuration ─────────────────────────────────────────────────────────────

const DAILY_INTERVAL_MS  = 24 * 60 * 60 * 1000; // Run nightly
const DAILY_HOUR         = 1;  // 01:00 AM
const QUALITY_DAY        = 2;  // 2nd of each month triggers quality sync for prev month

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function msUntilHour(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

// ── Worker Logic ──────────────────────────────────────────────────────────────

async function runDailySync(): Promise<void> {
  const date = yesterday();
  console.log(`[KpiDailySyncWorker] Starting daily sync for ${date}`);

  try {
    const aprResult = await syncAprMetrics(date);
    console.log(`[KpiDailySyncWorker] APR sync: ${aprResult.synced} synced, ${aprResult.skipped} skipped`);
  } catch (err: any) {
    console.error(`[KpiDailySyncWorker] APR sync failed:`, err.message);
  }

  try {
    const attResult = await syncAttendanceMetrics(date);
    console.log(`[KpiDailySyncWorker] Attendance sync: ${attResult.synced} synced`);
  } catch (err: any) {
    console.error(`[KpiDailySyncWorker] Attendance sync failed:`, err.message);
  }

  // On the 2nd of each month: also sync quality for previous month
  const today = new Date();
  if (today.getDate() === QUALITY_DAY) {
    const ym = lastMonth();
    try {
      const qResult = await syncQualityMetrics(ym);
      console.log(`[KpiDailySyncWorker] Quality sync (${ym}): ${qResult.synced} synced`);
    } catch (err: any) {
      console.error(`[KpiDailySyncWorker] Quality sync failed:`, err.message);
    }
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

async function startWorker(): Promise<void> {
  console.log(`[KpiDailySyncWorker] Starting — will run daily at ${DAILY_HOUR}:00 AM`);

  // Schedule first run at 01:00 AM
  const delay = msUntilHour(DAILY_HOUR);
  console.log(`[KpiDailySyncWorker] First run in ${Math.round(delay / 60000)} minutes`);

  setTimeout(async () => {
    await runDailySync();
    // Then repeat every 24 hours
    setInterval(runDailySync, DAILY_INTERVAL_MS);
  }, delay);
}

// ── Entry Point ───────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch(err => {
    console.error('[KpiDailySyncWorker] Fatal error:', err);
    process.exit(1);
  });
}

export { startWorker as startKpiDailySyncWorker, runDailySync };
