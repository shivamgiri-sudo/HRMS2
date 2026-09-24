/**
 * Branch Health Report — daily scheduler.
 *
 * Off by default. Three independent gates:
 *   BRANCH_HEALTH_REPORT_ENABLED=true            start the scheduler at all
 *   BRANCH_HEALTH_REPORT_DRY_RUN=false           actually send (default: dry-run)
 *   BRANCH_HEALTH_REPORT_REDIRECT_TO=a@x,b@y    optional: redirect all emails for testing
 *
 * Runs daily at 21:00 IST. Host timezone does not matter — offset is applied explicitly.
 * Registered in BOTH server.ts and workers/all-workers.ts (same pattern as branch-activity-report
 * to guarantee it runs whether WORKERS_PROCESS=external or inline).
 * Idempotent per branch per date via alert_cooldown.
 */
import { getCurrentDateIST } from "../../shared/istDate.js";
import { markAlerted, shouldAlert } from "../../shared/alert-cooldown.js";
import { sendBranchHealthReports } from "./index.js";

const WORKER_NAME = "branch-health-report";
const RUN_HOUR_IST = 21;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SENT_COOLDOWN_MS = 20 * 60 * 60 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Milliseconds until next RUN_HOUR_IST o'clock in IST. */
export function msUntilNextRun(now: number = Date.now()): number {
  const ist = new Date(now + IST_OFFSET_MS);
  const target = Date.UTC(
    ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(),
    RUN_HOUR_IST, 0, 0, 0,
  );
  const istNow = now + IST_OFFSET_MS;
  return (target > istNow ? target : target + 24 * 60 * 60 * 1000) - istNow;
}

const csv = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((e) => e.trim()).filter(Boolean);

async function runOnce(): Promise<void> {
  const dryRun = process.env.BRANCH_HEALTH_REPORT_DRY_RUN !== "false";
  const redirectTo = csv(process.env.BRANCH_HEALTH_REPORT_REDIRECT_TO);
  const results = await sendBranchHealthReports({
    reportDate: getCurrentDateIST(),
    dryRun,
    redirectTo: redirectTo.length ? redirectTo : undefined,
    shouldSend: redirectTo.length ? undefined : (branch, date) => shouldAlert(WORKER_NAME, `${branch}:${date}`, SENT_COOLDOWN_MS),
    onSent: redirectTo.length ? undefined : (branch, date) => markAlerted(WORKER_NAME, `${branch}:${date}`),
  });
  for (const r of results) {
    console.log(`[${WORKER_NAME}] ${r.branch}: ${r.status}${r.reason ? ` (${r.reason})` : ""} to=${r.to.length} cc=${r.cc.length}${dryRun ? " [dry-run]" : ""}`);
  }
}

function scheduleNext(): void {
  timer = setTimeout(() => {
    runOnce()
      .catch((e: unknown) => console.error(`[${WORKER_NAME}] run failed:`, e instanceof Error ? e.message : e))
      .finally(() => { if (started) scheduleNext(); });
  }, msUntilNextRun());
}

/** No-op unless BRANCH_HEALTH_REPORT_ENABLED=true. */
export function startBranchHealthReportScheduler(): void {
  if (started || process.env.BRANCH_HEALTH_REPORT_ENABLED !== "true") return;
  started = true;
  scheduleNext();
  const mode = process.env.BRANCH_HEALTH_REPORT_DRY_RUN !== "false" ? "DRY-RUN" : "LIVE";
  console.log(`[${WORKER_NAME}] scheduled daily at ${RUN_HOUR_IST}:00 IST (${mode})`);
}

export function stopBranchHealthReportScheduler(): void {
  started = false;
  if (timer) { clearTimeout(timer); timer = null; }
  console.log(`[${WORKER_NAME}] stopped`);
}
