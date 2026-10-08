/**
 * quality-gap-detector.worker.ts
 *
 * Sweeps recent call-quality assessments against active qa_trigger_rule rows and creates
 * training_assignment (+ task_tat_instance) records for genuine new skill gaps.
 *
 * This worker does NOT send any notification itself. TAT/escalation for the
 * 'quality_coaching_required' task_type it produces is driven entirely by the EXISTING
 * tat-escalation.worker.ts (seeded in backend/sql/1820_quality_learning_governance.sql) —
 * see that worker's own header for the backfill-floor / kill-switch / dedupe guards that
 * protect it. Duplicating any of that machinery here would be a second place for the same
 * class of incident (43,943 duplicate alerts) to happen again.
 *
 * Guards specific to THIS worker:
 *   1. worker kill switch — worker_config.enabled via isWorkerEnabled(). Unmanaged (no row)
 *      defaults to enabled, matching every other worker's convention.
 *   2. advisory lock — withWorkerLock, so only one instance sweeps at a time.
 *   3. bounded sweep window — only dialer users with a call in the last N days are
 *      considered per run (see LOOKBACK_DAYS), not the full historical User set.
 *   4. per-(employee, skill) dedupe — enforced in quality-gap.service.ts's
 *      hasPendingAssignment(), not here: a gap already assigned and pending is annotated,
 *      never re-assigned, regardless of how many times this worker polls.
 *
 * Registered in BOTH all-workers.ts and server.ts (inside the !WORKERS_EXTERNAL guard) —
 * a worker registered in only one silently never runs under WORKERS_PROCESS=external,
 * which is the documented failure mode for ats-reminders.cron.ts in this codebase.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import {
  listActiveTriggerRules,
  listRecentDialerUsers,
  evaluateRuleForDialerUser,
} from "../modules/quality-learning/quality-gap.service.js";
import { requestDialerHold } from "../modules/quality-learning/dialer-hold.service.js";
import { isWorkerEnabled, markWorkerRun } from "../shared/worker-config.js";
import { withWorkerLock, registerTimer, unregisterTimer, recordWorkerRun } from "./worker-utils.js";

const WORKER_NAME = "quality-gap-detector";
// FR2.5: gap detection must run within 15 minutes of QA score submission.
const POLL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 90_000; // let the API settle before the first sweep
const LOOKBACK_DAYS = 30; // candidate pool: dialer users with any call in this window
const MAX_USERS_PER_RUN = 500; // bounds one sweep's work; a full run resumes next poll

export interface QualityGapSweepStats {
  rulesEvaluated: number;
  usersScanned: number;
  gapsTriggered: number;
  assignmentsCreated: number;
  contentMissingAlerts: number;
  duplicatesAnnotated: number;
  unmappedDialerUsers: number;
  dialerHoldsRequested: number;
}

export async function runQualityGapSweep(): Promise<QualityGapSweepStats> {
  const stats: QualityGapSweepStats = {
    rulesEvaluated: 0,
    usersScanned: 0,
    gapsTriggered: 0,
    assignmentsCreated: 0,
    contentMissingAlerts: 0,
    duplicatesAnnotated: 0,
    unmappedDialerUsers: 0,
    dialerHoldsRequested: 0,
  };

  const rules = await listActiveTriggerRules();
  if (!rules.length) return stats;

  const dialerUsers = (await listRecentDialerUsers(LOOKBACK_DAYS)).slice(0, MAX_USERS_PER_RUN);
  stats.usersScanned = dialerUsers.length;
  stats.rulesEvaluated = rules.length;

  for (const rule of rules) {
    for (const dialerUser of dialerUsers) {
      try {
        const result = await evaluateRuleForDialerUser(rule, dialerUser);
        if (!result.triggered) continue;

        stats.gapsTriggered++;
        if (result.employeeId === null) {
          stats.unmappedDialerUsers++;
        } else if (result.assignmentCreated) {
          stats.assignmentsCreated++;
        } else if (result.contentMissing) {
          stats.contentMissingAlerts++;
        } else {
          stats.duplicatesAnnotated++;
        }
      } catch (err) {
        // One bad (rule, user) pair must not abort the sweep — same principle as
        // tat-escalation.worker.ts's per-instance try/catch.
        console.error(
          `[${WORKER_NAME}] rule ${rule.id} / user ${dialerUser}:`,
          (err as Error).message
        );
      }
    }
  }

  stats.dialerHoldsRequested = await sweepDialerHoldCandidates();

  return stats;
}

/**
 * Requests a manual dialer hold (see dialer-hold.service.ts) for any assignment whose
 * qa_trigger_rule was configured with block_dialer = 1 and whose task_tat_instance has
 * genuinely breached — i.e. AFTER the same SLA logic tat-escalation.worker.ts uses
 * (status IN sla_breached/open/in_progress AND due_at < NOW()), not on assignment.
 * requestDialerHold is itself idempotent per assignment (uq_tdh_assignment), so re-running
 * this on every poll is safe — it only ever creates the first request for a given breach.
 */
async function sweepDialerHoldCandidates(): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ta.id AS assignment_id, ta.employee_id, ta.severity,
            sc.category_name, t.due_at, e.branch_id
       FROM training_assignment ta
       JOIN qa_trigger_rule qtr ON qtr.id = ta.trigger_rule_id
       JOIN skill_category sc ON sc.id = ta.skill_category_id
       JOIN task_tat_instance t ON t.id = ta.tat_instance_id
       JOIN employees e ON e.id = ta.employee_id
      WHERE qtr.block_dialer = 1
        AND t.due_at < NOW()
        AND t.status IN ('open', 'in_progress', 'sla_breached')
        AND NOT EXISTS (
              SELECT 1 FROM training_dialer_hold h WHERE h.training_assignment_id = ta.id
            )
      LIMIT 100`
  );

  let requested = 0;
  for (const row of rows as RowDataPacket[]) {
    try {
      const holdId = await requestDialerHold({
        employeeId: row.employee_id,
        trainingAssignmentId: row.assignment_id,
        reason:
          `${row.category_name} training (${row.severity}) breached its TAT on ${row.due_at}. ` +
          `The configured trigger rule requires a dialer hold until this is completed.`,
        branchId: row.branch_id ?? undefined,
      });
      if (holdId) requested++;
    } catch (err) {
      // One bad candidate must not abort the sweep, same principle as the rule/user loop above.
      console.error(`[${WORKER_NAME}] dialer-hold request for assignment ${row.assignment_id}:`, (err as Error).message);
    }
  }
  return requested;
}

async function tick(): Promise<void> {
  if (!(await isWorkerEnabled(WORKER_NAME))) return;

  await withWorkerLock(WORKER_NAME, async () => {
    const started = Date.now();
    const stats = await runQualityGapSweep();
    await markWorkerRun(WORKER_NAME);
    await recordWorkerRun(WORKER_NAME, "completed", {
      ...stats,
      duration_ms: Date.now() - started,
    });
    if (stats.assignmentsCreated > 0 || stats.contentMissingAlerts > 0) {
      console.log(
        `[${WORKER_NAME}] ${stats.assignmentsCreated} assignment(s) created, ` +
          `${stats.contentMissingAlerts} content-missing alert(s), ` +
          `${stats.duplicatesAnnotated} duplicate(s) annotated`
      );
    }
  });
}

let startupTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

export function startQualityGapDetectorWorker(): void {
  startupTimer = setTimeout(() => {
    void tick();
    intervalTimer = setInterval(() => void tick(), POLL_MS);
    registerTimer(`${WORKER_NAME}-interval`, intervalTimer);
  }, STARTUP_DELAY_MS);
  registerTimer(`${WORKER_NAME}-startup`, startupTimer);
  console.log(`[${WORKER_NAME}] scheduled — every ${POLL_MS / 60000}m`);
}

export function stopQualityGapDetectorWorker(): void {
  if (startupTimer) { clearTimeout(startupTimer); unregisterTimer(`${WORKER_NAME}-startup`); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); unregisterTimer(`${WORKER_NAME}-interval`); intervalTimer = null; }
  console.log(`[${WORKER_NAME}] stopped`);
}
