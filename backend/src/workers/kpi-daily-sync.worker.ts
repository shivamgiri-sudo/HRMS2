import { syncAprMetrics, syncAttendanceMetrics, syncConversionMetrics, syncSalesBrandMisMetrics, syncSalesOrderMetrics, syncQualityMetrics } from '../modules/kpi/kpi-data-connector.service.js';

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAILY_HOUR = 1;
const QUALITY_DAY = 2;

let initialTimeoutRef: ReturnType<typeof setTimeout> | undefined;
let intervalRef: ReturnType<typeof setInterval> | undefined;

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

async function runDailySync(): Promise<void> {
  const date = yesterday();
  console.log(`[KpiDailySyncWorker] Starting daily sync for ${date}`);

  try {
    const aprResult = await syncAprMetrics(date);
    console.log(`[KpiDailySyncWorker] APR sync: ${aprResult.synced} synced, ${aprResult.skipped} skipped, ${aprResult.errors.length} errors`);
  } catch (err: any) {
    console.error(`[KpiDailySyncWorker] APR sync failed:`, err.message);
  }

  try {
    const attResult = await syncAttendanceMetrics(date);
    console.log(`[KpiDailySyncWorker] Attendance sync: ${attResult.synced} synced, ${attResult.skipped} skipped, ${attResult.errors.length} errors`);
  } catch (err: any) {
    console.error(`[KpiDailySyncWorker] Attendance sync failed:`, err.message);
  }

  try {
    const conversionResult = await syncConversionMetrics(date);
    console.log(`[KpiDailySyncWorker] Conversion sync: ${conversionResult.synced} synced, ${conversionResult.skipped} skipped, ${conversionResult.errors.length} errors`);
  } catch (err: any) {
    console.error(`[KpiDailySyncWorker] Conversion sync failed:`, err.message);
  }

  try {
    const salesBrandResult = await syncSalesBrandMisMetrics(date);
    console.log(`[KpiDailySyncWorker] Sales brand MIS sync: ${salesBrandResult.synced} synced, ${salesBrandResult.skipped} skipped, ${salesBrandResult.errors.length} errors`);
  } catch (err: any) {
    console.error(`[KpiDailySyncWorker] Sales brand MIS sync failed:`, err.message);
  }

  try {
    const salesOrderResult = await syncSalesOrderMetrics(date);
    console.log(`[KpiDailySyncWorker] Sales order sync: ${salesOrderResult.synced} synced, ${salesOrderResult.skipped} skipped, ${salesOrderResult.errors.length} errors`);
  } catch (err: any) {
    console.error(`[KpiDailySyncWorker] Sales order sync failed:`, err.message);
  }

  const today = new Date();
  if (today.getDate() === QUALITY_DAY) {
    const ym = lastMonth();
    try {
      const qResult = await syncQualityMetrics(ym);
      console.log(`[KpiDailySyncWorker] Quality sync (${ym}): ${qResult.synced} synced, ${qResult.skipped} skipped, ${qResult.errors.length} errors`);
    } catch (err: any) {
      console.error(`[KpiDailySyncWorker] Quality sync failed:`, err.message);
    }
  }
}

async function startWorker(): Promise<void> {
  console.log(`[KpiDailySyncWorker] Starting - will run daily at ${DAILY_HOUR}:00 AM`);

  const delay = msUntilHour(DAILY_HOUR);
  console.log(`[KpiDailySyncWorker] First run in ${Math.round(delay / 60000)} minutes`);

  initialTimeoutRef = setTimeout(async () => {
    await runDailySync();
    intervalRef = setInterval(runDailySync, DAILY_INTERVAL_MS);
  }, delay);
}

function stopWorker(): void {
  if (initialTimeoutRef) {
    clearTimeout(initialTimeoutRef);
    initialTimeoutRef = undefined;
  }
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  console.log("[KpiDailySyncWorker] Stopped");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch(err => {
    console.error('[KpiDailySyncWorker] Fatal error:', err);
    process.exit(1);
  });
}

export { startWorker as startKpiDailySyncWorker, stopWorker as stopKpiDailySyncWorker, runDailySync };
