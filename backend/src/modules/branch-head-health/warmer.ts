import { getCurrentDateIST } from "../../shared/istDate.js";
import { logger } from "../../logger.js";
import { registerTimer } from "../../workers/worker-utils.js";
import { listAllMasBranches } from "./scope.js";
import { listBranchProcesses } from "./processes.js";
import { monthStart } from "./ops.js";
import { getReportCached, getPnlCached, getOpsCached } from "./loaders.js";

const FIRST_WARM_MS = 45_000;
const WARM_EVERY_MS = 4 * 60_000;
const enabled = () => process.env.BRANCH_HEAD_HEALTH_ENABLED === "true";

let running = false;
let timers: NodeJS.Timeout[] = [];

async function step(label: string, branchId: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error({ err, branchId }, `[branch-head-health] warm ${label} failed`);
  }
}

/** Fill the shared caches for every MAS branch, one branch at a time. Overlapping calls return immediately. */
export async function warmOnce(now: Date = new Date()): Promise<{ branches: number; ms: number }> {
  if (running) return { branches: 0, ms: 0 };
  running = true;
  const started = Date.now();
  try {
    const date = getCurrentDateIST(now);
    const range = { startDate: monthStart(date), endDate: date };
    const branches = await listAllMasBranches();
    for (const branch of branches) {
      await step("report", branch.branchId, () => getReportCached(branch, date));
      await step("p&l", branch.branchId, () => getPnlCached(branch, date, { noTimeout: true }));
      await step("ops", branch.branchId, async () => {
        const groups = await listBranchProcesses([branch.branchId]);
        const mine = groups.active.filter((p) => !p.billingMirror && p.branchIds.includes(branch.branchId));
        await getOpsCached(branch, mine, range, date);
      });
    }
    return { branches: branches.length, ms: Date.now() - started };
  } finally {
    running = false;
  }
}

async function tick(): Promise<void> {
  if (!enabled()) return;
  try {
    const r = await warmOnce();
    if (r.branches > 0) logger.info(`[branch-head-health] warmed ${r.branches} branches in ${r.ms}ms`);
  } catch (err) {
    logger.error({ err }, "[branch-head-health] warm failed");
  }
}

/** Runs inside the API process because the caches are in-process. No-op unless the flag is "true" at start. */
export function startBranchHealthWarmer(): void {
  if (!enabled() || timers.length > 0) return;
  const first = setTimeout(() => { void tick(); }, FIRST_WARM_MS);
  const every = setInterval(() => { void tick(); }, WARM_EVERY_MS);
  first.unref();
  every.unref();
  registerTimer("branch-head-health-warmer-startup", first);
  registerTimer("branch-head-health-warmer-interval", every);
  timers = [first, every];
}

export function stopBranchHealthWarmerForTests(): void {
  for (const t of timers) { clearTimeout(t); clearInterval(t); }
  timers = [];
  running = false;
}
