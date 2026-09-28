/**
 * Exit Auto-Advance — Scheduled Job
 *
 * Automatically advances exit requests from notice_active/terminated → exited
 * when the last working day has passed AND all clearance tasks are cleared.
 *
 * Runs daily at 00:30 IST. Same self-rescheduling setTimeout pattern as
 * cron/business-action-sync.cron.ts.
 *
 * Rationale: An employee whose LWD is 2026-09-20 and whose clearance is complete
 * should not remain stuck in notice_active on 2026-09-21 waiting for manual HR action.
 * This cron moves them to exited automatically.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { transitionExitStatus } from "../modules/exit/exit.service.js";

let scheduler: NodeJS.Timeout | undefined;
let runInFlight = false;

function millisecondsUntilNextRun(hour: number, minute: number, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleNext(): void {
  if (scheduler) return;
  scheduler = setTimeout(runExitAutoAdvance, millisecondsUntilNextRun(0, 30));
  scheduler.unref();
}

async function runExitAutoAdvance(): Promise<void> {
  if (runInFlight) {
    console.warn("[CRON] Exit auto-advance already in flight, skipping this tick");
    scheduler = undefined;
    scheduleNext();
    return;
  }

  runInFlight = true;
  console.log("[CRON] Running exit auto-advance...");

  try {
    const result = await executeAutoAdvance();
    console.log(
      `[CRON] Exit auto-advance complete: ${result.advanced} exits advanced to exited, ${result.errors} errors`
    );
  } catch (error) {
    console.error("[CRON] Exit auto-advance error:", error);
  } finally {
    runInFlight = false;
    scheduler = undefined;
    scheduleNext();
  }
}

export async function executeAutoAdvance(): Promise<{ advanced: number; errors: number }> {
  // Find exits eligible for auto-advance:
  // 1. Status is notice_active OR terminated
  // 2. LWD confirmed is today or earlier
  // 3. All clearance tasks are cleared, waived, or not_applicable
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.id, er.employee_id, er.status
       FROM exit_request er
      WHERE er.status IN ('notice_active', 'terminated')
        AND er.last_working_day_confirmed <= CURDATE()
        AND NOT EXISTS (
          SELECT 1 FROM exit_clearance_task ect
           WHERE ect.exit_request_id = er.id
             AND ect.status NOT IN ('cleared', 'waived', 'not_applicable')
        )`
  );

  const actor = { userId: "system", userRole: "system", name: "Auto-Advance Cron" };
  let advanced = 0;
  let errors = 0;

  for (const row of rows as any[]) {
    try {
      await transitionExitStatus(row.id, "exited", actor);
      console.log(`[CRON] Auto-advanced exit ${row.id} (employee ${row.employee_id}) to exited`);
      advanced++;
    } catch (err: any) {
      console.error(
        `[CRON] Failed to auto-advance exit ${row.id} (employee ${row.employee_id}):`,
        err.message
      );
      errors++;
    }
  }

  return { advanced, errors };
}

export function startExitAutoAdvanceScheduler(): void {
  if (scheduler) return;
  console.log("[CRON] Exit auto-advance scheduler starting (daily at 00:30 IST)");
  scheduleNext();
}

export function stopExitAutoAdvanceScheduler(): void {
  if (scheduler) clearTimeout(scheduler);
  scheduler = undefined;
  console.log("[CRON] Exit auto-advance scheduler stopped");
}
