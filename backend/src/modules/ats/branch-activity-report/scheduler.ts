/**
 * Branch Recruitment Activity Report — daily scheduler.
 *
 * Off by default. Three independent gates, so enabling the job is never the same act as mailing people:
 *   ATS_BRANCH_ACTIVITY_REPORT_ENABLED=true          start the scheduler at all
 *   ATS_BRANCH_ACTIVITY_REPORT_DRY_RUN=false         actually send (otherwise: build reports + resolve recipients, log only)
 *   ATS_BRANCH_ACTIVITY_REPORT_REDIRECT_TO=a@x,b@y   optional: deliver every branch email to these addresses instead
 *
 * Runs daily at 20:00 IST (the IST offset is applied explicitly, so the host timezone does not matter).
 * Registered in BOTH server.ts and workers/all-workers.ts — registering in only one is how
 * ats-reminders.cron.ts came to never run in production. Sends are idempotent per branch per date via
 * alert_cooldown, so a pm2 restart or the two registrations both being live cannot mail a branch twice.
 */
import { getCurrentDateIST } from "../../../shared/istDate.js";
import { markAlerted, shouldAlert } from "../../../shared/alert-cooldown.js";
import { sendBranchActivityReports } from "./index.js";

const WORKER_NAME = "ats-branch-activity-report";
const RUN_HOUR_IST = 20;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SENT_COOLDOWN_MS = 20 * 60 * 60 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Milliseconds until the next RUN_HOUR_IST o'clock, computed on the IST wall clock. */
export function msUntilNextRun(now: number = Date.now(), hour: number = RUN_HOUR_IST): number {
  const ist = new Date(now + IST_OFFSET_MS);
  const target = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour, 0, 0, 0);
  const istNow = now + IST_OFFSET_MS;
  return (target > istNow ? target : target + 24 * 60 * 60 * 1000) - istNow;
}

const csv = (v: string | undefined): string[] => (v ?? "").split(",").map((e) => e.trim()).filter(Boolean);

async function runOnce(): Promise<void> {
  const dryRun = process.env.ATS_BRANCH_ACTIVITY_REPORT_DRY_RUN !== "false";
  const redirectTo = csv(process.env.ATS_BRANCH_ACTIVITY_REPORT_REDIRECT_TO);
  const results = await sendBranchActivityReports({
    reportDate: getCurrentDateIST(),
    dashboardUrl: process.env.ATS_BRANCH_ACTIVITY_REPORT_DASHBOARD_URL || undefined,
    dryRun,
    redirectTo: redirectTo.length ? redirectTo : undefined,
    // A redirected test send must not consume the real send's slot for the day.
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

/** No-op unless ATS_BRANCH_ACTIVITY_REPORT_ENABLED=true. */
export function startBranchActivityReportScheduler(): void {
  if (started || process.env.ATS_BRANCH_ACTIVITY_REPORT_ENABLED !== "true") return;
  started = true;
  scheduleNext();
  const mode = process.env.ATS_BRANCH_ACTIVITY_REPORT_DRY_RUN !== "false" ? "DRY-RUN" : "LIVE";
  console.log(`[${WORKER_NAME}] scheduled daily at ${RUN_HOUR_IST}:00 IST (${mode})`);
}

export function stopBranchActivityReportScheduler(): void {
  started = false;
  if (timer) { clearTimeout(timer); timer = null; }
  console.log(`[${WORKER_NAME}] stopped`);
}
