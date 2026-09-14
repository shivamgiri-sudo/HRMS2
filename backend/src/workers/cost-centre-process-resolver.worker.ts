import { logger } from "../logger.js";
import { registerTimer, unregisterTimer, withWorkerLock } from "./worker-utils.js";
import { resolveCostCentreProcesses } from "../modules/process-pnl/cost-centre-process-resolver.service.js";
import { bpoPnlService } from "../modules/process-pnl/bpo-pnl.service.js";
import { processPnlService } from "../modules/process-pnl/process-pnl.service.js";

/**
 * Keeps cost_centre_master.process_id self-populating.
 *
 * See cost-centre-process-resolver.service.ts for the full design and the DialDesk exclusion
 * this depends on. This worker is what makes the fix "permanent" in the user's sense: a brand
 * new cost centre added tomorrow with real invoice revenue and a client name matching an
 * existing process gets process_id filled in automatically here, on the next run, with no
 * human running a script. Runs after db-bill-finance-sync (that worker syncs new cost centres
 * and invoice rows in from db_bill; this one attributes the process once the data has landed),
 * on the same once-a-day cadence — cost centre attribution is not the kind of thing that needs
 * to be current within the hour.
 *
 * Cache invalidation mirrors canonical-pnl.service.ts's recalculate(): a process_id write here
 * changes what bpo-pnl.service.ts's next getSummary()/getProcessDetail() call should return, so
 * both caches are invalidated the same way a manual recalculate would.
 */

const WORKER_NAME = "cost-centre-process-resolver";
const INTERVAL_MS = 24 * 60 * 60 * 1000;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

async function cycle(): Promise<void> {
  await withWorkerLock(WORKER_NAME, async () => {
    try {
      const { resolved, unresolved, excludedCount } = await resolveCostCentreProcesses({ apply: true });
      if (resolved.length > 0) {
        processPnlService.invalidateCaches();
        bpoPnlService.invalidateCaches();
      }
      logger.info(
        { worker: WORKER_NAME, resolved: resolved.length, unresolved: unresolved.length, excludedCount },
        `[cost-centre-process-resolver] resolved ${resolved.length}, left ${unresolved.length} unresolved (no confident process match), excluded ${excludedCount} out-of-scope`,
      );
    } catch (error) {
      // Never throws: same reasoning as db-bill-finance-sync — a failed run must not take the
      // worker process down, and the next scheduled run recovers on its own.
      logger.error({ worker: WORKER_NAME, err: error }, "[cost-centre-process-resolver] FAILED");
    }
  });
}

export function startCostCentreProcessResolverWorker(): void {
  if (process.env.COST_CENTRE_PROCESS_RESOLVER_ENABLED === "false") {
    logger.info({ worker: WORKER_NAME }, "[cost-centre-process-resolver] disabled");
    return;
  }
  // 10 minutes in, after db-bill-finance-sync's 5-minute startup delay has had time to land any
  // newly-synced cost centres for this run to pick up.
  startupTimer = setTimeout(() => { void cycle(); }, 10 * 60 * 1000);
  registerTimer(`${WORKER_NAME}:startup`, startupTimer);

  intervalTimer = setInterval(() => { void cycle(); }, INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalTimer);
  logger.info({ worker: WORKER_NAME, intervalMs: INTERVAL_MS }, "[cost-centre-process-resolver] scheduled");
}

export function stopCostCentreProcessResolverWorker(): void {
  if (startupTimer) { clearTimeout(startupTimer); unregisterTimer(`${WORKER_NAME}:startup`); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); unregisterTimer(WORKER_NAME); intervalTimer = null; }
}
