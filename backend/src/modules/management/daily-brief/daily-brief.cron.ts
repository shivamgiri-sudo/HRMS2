/**
 * D-1 Daily Manager Intelligence Briefing Engine — scheduler.
 *
 * Self-rearming setTimeout anchored to an IST hour, mirroring the established D-1
 * scheduling pattern in modules/wfm/attendance-engine.cron.ts (not node-cron: same
 * "compute ms until the next HH:mm, setTimeout, unref, reschedule in the finally"
 * shape).
 *
 * DEPENDENCY-TIMING EVIDENCE (read from the live scheduler registrations this pass
 * found, not assumed):
 *   - modules/wfm/attendance-engine.cron.ts: startAttendanceEngineScheduler,
 *     RUN_HOUR = 23. Fires at 23:00 host-local time and finalizes attendance for
 *     "yesterday" (its own D-1 boundary) — i.e. a business date's attendance is not
 *     finalized until 23:00 on the day AFTER it, giving ~23h for late punches/syncs.
 *   - modules/wfm/attendance-reconciliation.worker.ts:
 *     startAttendanceReconciliationWorker, hour = env.NCOSEC_RECONCILIATION_HOUR,
 *     default 2 (config/env.ts) -> 02:00.
 *   - cron/business-action-sync.cron.ts (business_action_queue signal sync):
 *     scheduleAttendanceGaps -> 06:00, schedulePayrollReadiness -> 07:00,
 *     scheduleRosterShortages -> 09:00.
 *   Ordered same-day chain after the attendance sweep: 02:00 -> 06:00 -> 07:00 ->
 *   09:00. The latest is 09:00 (roster-shortages sync), so this scheduler's default
 *   run time is 09:30 — 30 minutes after the last dependency, same calendar day,
 *   genuinely after all of them rather than an arbitrary "morning" guess.
 *
 * THREE INDEPENDENT ENV GATES — read directly from process.env (matching the
 * ATS_REMINDERS_ENABLED convention already used in server.ts for exactly this kind
 * of "stays off until an explicit owner decision" feature) rather than added to
 * config/env.ts's zod schema, so no schema change anywhere else is needed for this
 * feature to stay inert by default:
 *
 *   - MANAGER_DAILY_BRIEF_ENABLED: must be exactly "true" or startManagerDailyBrief
 *     Scheduler() is a no-op — it never registers a timer. Defaults OFF.
 *   - MANAGER_DAILY_BRIEF_TIME: "HH:mm" in IST/host-local time (see attendance-
 *     engine.cron.ts's own host-local assumption, mirrored here), defaults to
 *     "09:30" per the evidence above. An unparseable value silently falls back to
 *     the default rather than crashing the scheduler.
 *   - MANAGER_DAILY_BRIEF_DRY_RUN: must be exactly "false" for a real send. Any
 *     other value (unset, "true", garbage) means dry-run. This is checked INSIDE
 *     runManagerDailyBrief() itself (isDryRun()), not passed in and trusted from a
 *     caller — a hard safety gate even if this module is ever invoked from
 *     somewhere other than the scheduler (e.g. an ops script or a future manual-
 *     trigger route).
 */
import { recordWorkerRun } from "../../../workers/worker-utils.js";
import { getBusinessDateIST } from "../../../shared/istDate.js";
import { getDispatchBlock } from "../../../shared/notification-dispatch-block.js";
import { resolveAllEligibleRecipients } from "./daily-brief-recipient.resolver.js";
import { dispatchDailyBrief } from "./daily-brief-dispatch.service.js";

export const WORKER_NAME = "manager-daily-brief";
const DEFAULT_TIME = "09:30";
/** Small worker pool — mirrors attendanceEngineService.processDateBatch's own
 * chunk-then-Promise.allSettled pattern rather than adding a new dependency
 * (no p-limit or custom semaphore exists elsewhere in this repo — checked). */
const RECIPIENT_BATCH_SIZE = 5;

let nextRun: NodeJS.Timeout | undefined;

function isEnabled(): boolean {
  return process.env.MANAGER_DAILY_BRIEF_ENABLED === "true";
}

/** Hard safety gate — see file header. Defaults to dry-run for any value other than
 * the literal string "false". */
export function isDryRun(): boolean {
  return process.env.MANAGER_DAILY_BRIEF_DRY_RUN !== "false";
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseRunTime(value: string | undefined): { hour: number; minute: number } {
  const raw = value && TIME_PATTERN.test(value) ? value : DEFAULT_TIME;
  const [hourStr, minuteStr] = raw.split(":");
  return { hour: Number(hourStr), minute: Number(minuteStr) };
}

export function millisecondsUntilNextManagerDailyBriefRun(now = new Date()): number {
  const { hour, minute } = parseRunTime(process.env.MANAGER_DAILY_BRIEF_TIME);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export interface ManagerDailyBriefRunSummary {
  businessDate: string;
  dryRun: boolean;
  recipientsResolved: number;
  recipientsUnresolved: number;
  sent: number;
  dryRunOnly: number;
  skippedAlreadySent: number;
  skippedBlocked: number;
  failed: number;
  blockedGlobally: boolean;
}

/**
 * One full run: resolve every eligible recipient across all 25 roles, build +
 * dispatch (or dry-run) a brief for each, bounded concurrency, one recipient's
 * failure never aborts the rest. Logs run-start/run-end summary lines and writes
 * both to worker_job_run (existing table, reused — see file header / report: no new
 * table needed). Per-recipient outcomes (sent/skipped/failed/dry-run) are already
 * captured in dispatch_log by dispatchDailyBrief/dispatchService for real sends;
 * resolver-level facts that never reach dispatch_log at all (unresolvable scope,
 * ineligible role, blocked login) are logged here instead, per recipient.
 */
export async function runManagerDailyBrief(
  businessDate: string = getBusinessDateIST(),
): Promise<ManagerDailyBriefRunSummary> {
  const dryRun = isDryRun();
  const startedAt = Date.now();
  console.log(`[${WORKER_NAME}] run start businessDate=${businessDate} dryRun=${dryRun}`);
  await recordWorkerRun(WORKER_NAME, "started", { businessDate, dryRun });

  const summary: ManagerDailyBriefRunSummary = {
    businessDate,
    dryRun,
    recipientsResolved: 0,
    recipientsUnresolved: 0,
    sent: 0,
    dryRunOnly: 0,
    skippedAlreadySent: 0,
    skippedBlocked: 0,
    failed: 0,
    blockedGlobally: false,
  };

  try {
    // Fail fast on a global outbound block before doing any (costly) resolution or
    // brief-building work. dispatchDailyBrief still re-checks its own event-scoped
    // block per recipient below (cheap, TTL-cached) — this is only the early exit
    // for the common "an operator hit the kill switch" case.
    const globalBlock = await getDispatchBlock();
    if (globalBlock.blocked && globalBlock.scope === "global") {
      summary.blockedGlobally = true;
      console.warn(
        `[${WORKER_NAME}] outbound dispatch is globally blocked` +
          (globalBlock.reason ? `: ${globalBlock.reason}` : " (no reason recorded)") +
          " — skipping this run entirely",
      );
      await recordWorkerRun(WORKER_NAME, "completed", { ...summary, elapsedMs: Date.now() - startedAt });
      return summary;
    }

    const { resolved, unresolved } = await resolveAllEligibleRecipients();
    summary.recipientsResolved = resolved.length;
    summary.recipientsUnresolved = unresolved.length;

    for (const u of unresolved) {
      // Resolver-level fact — e.g. "no scope-resolution bucket for this role", "not
      // an eligible role", "login blocked". These recipients never reach
      // dispatchDailyBrief/dispatch_log at all, so this line is the only record of
      // why they got nothing (spec §38's "unresolvable-scope recipients" question).
      console.warn(
        `[${WORKER_NAME}] unresolved recipient employeeId=${u.employeeId} role=${u.role} reason=${u.reason}`,
      );
    }

    for (let i = 0; i < resolved.length; i += RECIPIENT_BATCH_SIZE) {
      const chunk = resolved.slice(i, i + RECIPIENT_BATCH_SIZE);
      const results = await Promise.allSettled(
        chunk.map((recipient) => dispatchDailyBrief(recipient.employeeId, { businessDate, dryRun })),
      );

      results.forEach((result, idx) => {
        const recipient = chunk[idx]!;
        if (result.status === "rejected") {
          // One recipient's failure (a thrown error somewhere in build/render/
          // dispatch) is caught here and logged — it never aborts the batch or the
          // run; the loop continues to the next chunk regardless.
          summary.failed += 1;
          console.error(
            `[${WORKER_NAME}] recipient employeeId=${recipient.employeeId} threw:`,
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
          return;
        }

        const outcome = result.value;
        switch (outcome.status) {
          case "dispatched":
            summary.sent += 1;
            break;
          case "dry_run":
            summary.dryRunOnly += 1;
            break;
          case "skipped_already_sent":
            summary.skippedAlreadySent += 1;
            break;
          case "skipped_blocked":
            summary.skippedBlocked += 1;
            console.warn(
              `[${WORKER_NAME}] recipient employeeId=${recipient.employeeId} skipped ` +
                `(blocked: ${outcome.reason ?? "no reason recorded"})`,
            );
            break;
          case "unresolved":
            // Defensive only: this recipient came from resolveAllEligibleRecipients,
            // which already resolved it. A race (e.g. deactivated between resolve
            // and dispatch) could still land here — logged rather than silently
            // dropped, and folded into the unresolved count for the summary.
            summary.recipientsUnresolved += 1;
            console.warn(
              `[${WORKER_NAME}] recipient employeeId=${recipient.employeeId} became unresolved mid-run: ` +
                outcome.unresolved.reason,
            );
            break;
        }
      });
    }
  } catch (error) {
    console.error(`[${WORKER_NAME}] run failed`, error instanceof Error ? error.message : String(error));
    await recordWorkerRun(WORKER_NAME, "failed", {
      ...summary,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[${WORKER_NAME}] run end businessDate=${businessDate} elapsedMs=${elapsedMs} ` +
      `resolved=${summary.recipientsResolved} unresolved=${summary.recipientsUnresolved} ` +
      `sent=${summary.sent} dryRun=${summary.dryRunOnly} ` +
      `skippedAlreadySent=${summary.skippedAlreadySent} skippedBlocked=${summary.skippedBlocked} ` +
      `failed=${summary.failed}`,
  );
  await recordWorkerRun(WORKER_NAME, "completed", { ...summary, elapsedMs });
  return summary;
}

export function startManagerDailyBriefScheduler(): void {
  if (!isEnabled()) {
    console.log(`[${WORKER_NAME}] disabled (set MANAGER_DAILY_BRIEF_ENABLED=true to enable)`);
    return;
  }
  if (nextRun) return;

  const scheduleNext = () => {
    nextRun = setTimeout(async () => {
      try {
        await runManagerDailyBrief();
      } catch (error) {
        console.error(`[${WORKER_NAME}] scheduled run failed`, error instanceof Error ? error.message : String(error));
      } finally {
        nextRun = undefined;
        scheduleNext();
      }
    }, millisecondsUntilNextManagerDailyBriefRun());
    nextRun.unref();
  };

  scheduleNext();
  const { hour, minute } = parseRunTime(process.env.MANAGER_DAILY_BRIEF_TIME);
  console.log(
    `[${WORKER_NAME}] scheduled daily at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ` +
      `dryRun=${isDryRun()}`,
  );
}

export function stopManagerDailyBriefScheduler(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
