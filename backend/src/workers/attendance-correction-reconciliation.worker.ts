/**
 * Attendance CORRECTION reconciliation worker.
 *
 * Asks, on a timer, whether the attendance record still agrees with what was APPROVED. The write
 * paths refuse a locked day now, so this should find nothing — which is exactly why it runs. The
 * failure it exists for is invisible by construction: a locked write succeeds and changes nothing,
 * so a caller that forgets to check reports success while the change evaporates. That went
 * unnoticed for weeks and cost 514.5 days of pay across 879 approved changes.
 *
 * A guard protects the writers we know about. This notices when something we do NOT know about
 * gets it wrong — an import, a screen added later, a path nobody thought of.
 *
 * NOT to be confused with wfm/attendance-reconciliation.worker.ts ("ncosec-attendance-
 * reconciliation"), which reconciles biometric punches against the graded day. That asks whether
 * the day was graded correctly from the machine; this asks whether an approved human decision
 * ever reached the record at all. Different question, different failure, deliberately separate.
 *
 * Read-only: it reports, never corrects. Repair is a deliberate act with an audit trail
 * (scripts/recover-silent-noop-attendance.cjs), not something a timer should do unattended while
 * nobody is looking at pay.
 */

import { reconcileAttendanceCorrections } from "../modules/wfm/attendance-correction-reconciliation.service.js";
import { recordWorkerRun, withWorkerLock } from "./worker-utils.js";

const WORKER_NAME = "attendance-correction-reconciliation";

/** Daily. The condition is measured in weeks, not minutes, and each sweep is three wide reads. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Let the API warm up before the first sweep touches the DB. */
const STARTUP_DELAY_MS = 5 * 60 * 1000;
/** Matches the recovery script's default, so what is reported is what can be repaired. */
const WINDOW_DAYS = 90;

let startupRef: ReturnType<typeof setTimeout> | undefined;
let intervalRef: ReturnType<typeof setInterval> | undefined;

async function audit(): Promise<void> {
  const r = await reconcileAttendanceCorrections(WINDOW_DAYS);
  const summary = {
    windowDays: r.windowDays,
    confirmed: r.confirmed.length,
    regraded: r.regraded.length,
    unexplained: r.unexplained.length,
  };

  if (r.confirmed.length === 0) {
    console.log(
      `[${WORKER_NAME}] clean over ${r.windowDays}d — ` +
        `regraded=${r.regraded.length} unexplained=${r.unexplained.length}`,
    );
    await recordWorkerRun(WORKER_NAME, "completed", summary);
    return;
  }

  // Loud, and specific about what it means. "N divergences" reads as a data-quality nit; these are
  // people who were told their correction went through and whose pay is wrong.
  const bySource: Record<string, number> = {};
  for (const d of r.confirmed) bySource[d.source] = (bySource[d.source] ?? 0) + 1;
  const detail = Object.entries(bySource).map(([k, n]) => `${k}=${n}`).join(" ");
  const employees = new Set(r.confirmed.map((d) => d.employeeId)).size;

  console.error(
    `[${WORKER_NAME}] ${r.confirmed.length} APPROVED CHANGE(S) SILENTLY DISCARDED across ` +
      `${employees} employee(s) in the last ${r.windowDays}d (${detail}). Each is a person told ` +
      `their change was applied. Attendance status IS the pay here. Investigate before payroll ` +
      `runs: node scripts/verify-attendance-corrections-applied.cjs`,
  );
  for (const d of r.confirmed.slice(0, 10)) {
    console.error(
      `[${WORKER_NAME}]   ${d.date} employee=${d.employeeId} wanted=${d.wanted} got=${d.got} (${d.source})`,
    );
  }
  if (r.confirmed.length > 10) {
    console.error(`[${WORKER_NAME}]   … and ${r.confirmed.length - 10} more`);
  }

  await recordWorkerRun(WORKER_NAME, "completed", { ...summary, bySource, employees });
}

async function sweep(): Promise<void> {
  try {
    // The lock is what keeps a sweep from overlapping itself or a second process — 45 workers
    // share one pool here, so three wide reads running twice over is not free.
    await withWorkerLock(WORKER_NAME, audit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${WORKER_NAME}] sweep failed:`, message);
    await recordWorkerRun(WORKER_NAME, "failed", { error: message });
  }
}

export function startAttendanceCorrectionReconciliationWorker(): void {
  if (intervalRef) return;
  console.log(
    `[${WORKER_NAME}] Starting — interval: ${CHECK_INTERVAL_MS / 3600000}h, window: ${WINDOW_DAYS}d`,
  );
  startupRef = setTimeout(() => { void sweep(); }, STARTUP_DELAY_MS);
  intervalRef = setInterval(() => { void sweep(); }, CHECK_INTERVAL_MS);
}

export function stopAttendanceCorrectionReconciliationWorker(): void {
  if (startupRef) {
    clearTimeout(startupRef);
    startupRef = undefined;
  }
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  console.log(`[${WORKER_NAME}] Stopped`);
}

export { sweep as runAttendanceCorrectionReconciliationSweep };
