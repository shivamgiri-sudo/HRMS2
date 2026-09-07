import { computeStudioKpis } from '../modules/kpi/kpi-studio.compute.js';
import { getStudioCapability } from '../modules/kpi/kpi-studio.service.js';

/**
 * Nightly KPI Studio computation.
 *
 * Studio could only ever be computed by somebody clicking Compute, so a KPI
 * built in the Studio produced nothing until a human remembered it. This runs
 * yesterday's figures once a night, the same shape and hour as
 * kpi-daily-sync.worker.ts, which already fills kpi_daily_actual from the fixed
 * connectors.
 *
 * ── Off by default, deliberately ────────────────────────────────────────────
 * Computation WRITES: employee-grain results land in kpi_daily_actual, the
 * table every KPI surface reads, and process-grain results in
 * process_metric_actual. A scheduled writer that nobody asked for is how a
 * half-configured definition quietly rewrites everybody's scores overnight, so
 * this stays behind KPI_STUDIO_COMPUTE_ENABLED and does nothing until an
 * operator turns it on — after they have run a day by hand and trusted it.
 *
 * The manager-brief worker in this repo carries the same switch for the same
 * reason; it is the house pattern for a job with side effects.
 *
 * ── Runs one day, not a backfill ────────────────────────────────────────────
 * Yesterday only. A worker that walks a range would, on its first enabled
 * night, rewrite months of history from whatever definitions happen to exist
 * now — which is not the same as what was true then. Backfilling is a decision
 * somebody makes explicitly through the API.
 */

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 02:00, an hour after kpi-daily-sync, so the connectors it depends on have landed. */
const DAILY_HOUR = 2;

let initialTimeoutRef: ReturnType<typeof setTimeout> | undefined;
let intervalRef: ReturnType<typeof setInterval> | undefined;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local date, not toISOString: this host runs in IST and UTC would shift the day back. */
function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function msUntilHour(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function isStudioComputeEnabled(): boolean {
  return process.env.KPI_STUDIO_COMPUTE_ENABLED === 'true';
}

/** True unless explicitly set to "false", so the first enabled night reports without writing. */
export function isStudioComputeDryRun(): boolean {
  return process.env.KPI_STUDIO_COMPUTE_DRY_RUN !== 'false';
}

export async function runStudioCompute(): Promise<void> {
  const date = yesterday();
  const dryRun = isStudioComputeDryRun();

  // Asking first keeps a database without the Studio schema from logging a
  // stack trace every night for a feature it does not have.
  const capability = await getStudioCapability();
  if (!capability.tables) {
    console.log('[KpiStudioComputeWorker] Studio schema not installed; nothing to compute');
    return;
  }

  console.log(`[KpiStudioComputeWorker] Computing ${date}${dryRun ? ' (dry run — nothing will be written)' : ''}`);
  try {
    const outcome = await computeStudioKpis({ date, dryRun });
    console.log(
      `[KpiStudioComputeWorker] ${date}: ${outcome.definitions_considered} definition(s), ` +
        `${outcome.written} written, ${outcome.no_data} no-data, ${outcome.errors} error(s)`,
    );
    // Source failures are reported individually: "3 errors" does not tell an
    // operator that a client's database was unreachable all night.
    for (const failure of outcome.source_failures) {
      console.error(`[KpiStudioComputeWorker] source ${failure.source_code}: ${failure.error}`);
    }
  } catch (err) {
    console.error('[KpiStudioComputeWorker] Compute failed:', (err as Error).message);
  }
}

function startWorker(): void {
  if (!isStudioComputeEnabled()) {
    console.log('[KpiStudioComputeWorker] Disabled (set KPI_STUDIO_COMPUTE_ENABLED=true to enable)');
    return;
  }
  const delay = msUntilHour(DAILY_HOUR);
  console.log(`[KpiStudioComputeWorker] First run in ${Math.round(delay / 60000)} minutes`);

  initialTimeoutRef = setTimeout(() => {
    void runStudioCompute().then(() => {
      intervalRef = setInterval(() => void runStudioCompute(), DAILY_INTERVAL_MS);
    });
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
  console.log('[KpiStudioComputeWorker] Stopped');
}

export { startWorker as startKpiStudioComputeWorker, stopWorker as stopKpiStudioComputeWorker };
