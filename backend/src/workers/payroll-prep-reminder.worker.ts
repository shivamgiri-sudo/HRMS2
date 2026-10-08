/**
 * Payroll Prep Reminder Worker
 *
 * Fires on the 1st of each month (IST) for the PREVIOUS month.
 * For every WFM / process_manager user whose assigned process is not yet
 * signed off, creates a Work Inbox item as a reminder.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { payrollBranchReadinessService } from "../modules/payroll/payroll-branch-readiness.service.js";
import { createWorkItemIfNotExists } from "../modules/work-inbox/work-inbox.service.js";
import { registerTimer, unregisterTimer } from "./worker-utils.js";

const WORKER_NAME = "payroll-prep-reminder";

let scheduledTimer: NodeJS.Timeout | null = null;

/** Returns YYYY-MM for the previous calendar month in IST. */
function previousMonthIST(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // IST offset
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed, so this IS the previous month number
  if (m === 0) {
    return `${y - 1}-12`;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** ms until next 1st of month at 08:00 IST (02:30 UTC). Capped at 24 days so
 *  Node's setTimeout 32-bit limit (~24.8 days) is never exceeded; the scheduler
 *  re-evaluates on each wake and skips months it isn't due. */
function msUntilNext1st(): number {
  const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000 * 24; // 24 days in ms
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const nextFirst = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 1, 2, 30, 0, 0)
  );
  // If we're already past this month's 1st 02:30 UTC, target next month
  if (nextFirst.getTime() <= now.getTime()) {
    nextFirst.setUTCMonth(nextFirst.getUTCMonth() + 1);
  }
  const ms = nextFirst.getTime() - now.getTime();
  // If the target is more than 24 days away, sleep 24 days then re-evaluate
  return Math.min(ms, MAX_TIMEOUT_MS);
}

/** Returns true only when today (IST) is the 1st of the month. */
function isTodayThe1st(): boolean {
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return istNow.getUTCDate() === 1;
}

async function runReminders(): Promise<void> {
  const month = previousMonthIST();
  console.log(`[${WORKER_NAME}] Sending payroll prep reminders for ${month}...`);

  // Find all WFM / process_manager user → process assignments
  const [scopeRows] = await db.execute<RowDataPacket[]>(
    `SELECT uas.user_id, uas.branch_id, uas.process_id
       FROM user_assignment_scope uas
      WHERE uas.active_status = 1
        AND uas.process_id IS NOT NULL
        AND uas.scope_type IN ('process', 'branch_process')
        AND uas.role_key IN ('wfm', 'process_manager', 'branch_head', 'payroll_branch')`
  );

  const scopes = scopeRows as Array<{ user_id: string; branch_id: string; process_id: string }>;

  let sent = 0;
  for (const scope of scopes) {
    try {
      const rec = await payrollBranchReadinessService.getOrRefresh(
        month,
        scope.branch_id,
        scope.process_id
      );

      // Only remind if not signed off and not ready
      if (rec.process_manager_signoff === 1 || rec.readiness_status === "ready") {
        continue;
      }

      const priority = rec.readiness_status === "blocked" ? "high" : "medium";
      const pendingItems = [
        !rec.attendance_data_ready && "Attendance not declared",
        !rec.attendance_frozen && "Attendance not frozen",
        !rec.custom_deductions_uploaded && "Custom deductions pending",
        !rec.overtime_entered && "Overtime not entered",
      ]
        .filter(Boolean)
        .join("; ");

      await createWorkItemIfNotExists({
        itemType: "PAYROLL_PREP_REMINDER",
        title: `Payroll Prep: ${rec.process_name} — ${month} sign-off pending`,
        description: pendingItems
          ? `${rec.branch_name} · Score: ${rec.readiness_score}% · Pending: ${pendingItems}`
          : `${rec.branch_name} · Score: ${rec.readiness_score}% · Please review and sign off.`,
        moduleCode: "payroll",
        entityType: "process",
        entityId: scope.process_id,
        assignedToUserId: scope.user_id,
        branchId: scope.branch_id,
        processId: scope.process_id,
        priority,
        // Action URL deep-links into the process readiness drawer
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });

      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${WORKER_NAME}] Failed for user ${scope.user_id} / process ${scope.process_id}: ${msg}`);
    }
  }

  console.log(`[${WORKER_NAME}] Sent ${sent} reminder(s) for ${month}.`);
}

export async function startPayrollPrepReminderWorker(): Promise<void> {
  const delay = msUntilNext1st();
  console.log(
    `[${WORKER_NAME}] Next run on 1st of month — in ${Math.round(delay / 3600000)}h`
  );

  scheduledTimer = setTimeout(async () => {
    // Guard: only run on the actual 1st — wakeup may be an intermediate
    // 24-day sleep rather than the real target date.
    if (isTodayThe1st()) {
      try {
        await runReminders();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${WORKER_NAME}] Error:`, msg);
      }
    }
    // Reschedule — re-evaluates next target after each wakeup
    await startPayrollPrepReminderWorker();
  }, delay);

  registerTimer(`${WORKER_NAME}-scheduled`, scheduledTimer);
}

export function stopPayrollPrepReminderWorker(): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    unregisterTimer(`${WORKER_NAME}-scheduled`);
    scheduledTimer = null;
  }
}
