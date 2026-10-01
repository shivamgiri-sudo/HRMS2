import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../lib/logger.js";
import { exitService } from "./exit.service.js";
import {
  AUTO_ACTOR,
  autoAcceptAfterHours,
  isAutoExitAtLwd,
  isAutoStartNotice,
  isExitAutoEnabled,
} from "./exit-auto-config.js";

/**
 * Moves exits through the buckets with no human step (owner ruling 2026-10-01).
 *
 *   submitted      -> manager_review  at once (also done inline when the resignation is filed;
 *                                      this sweep catches anything that missed it)
 *   manager_review -> accepted        after exit/auto/accept_after_hours (default 48h) with no
 *                                      manager action. A manager cannot refuse a resignation
 *                                      (ruling 2026-09-12), so acceptance is a formality, and the
 *                                      manager can still accept earlier or record an objection.
 *   accepted       -> notice_serving  at once. If HR confirmed no last working day, the employee's
 *                                      proposed one is confirmed - payroll reads that date.
 *   notice_serving -> exited          the day after the confirmed last working day.
 *
 * Every move goes through exitService.updateExitStatus, so the audit log row, the row lock and
 * the expected-status check are the same as a person's click; the actor is 'system'. Each
 * transition is its own call: one failing exit never stops the rest, and the next run retries it.
 * Terminal/inactive states (revoked, withdrawn, rejected, closed...) are never touched.
 */
export interface AutoProgressResult {
  toManagerReview: number;
  toAccepted: number;
  toNotice: number;
  toExited: number;
  failed: number;
  skipped?: string;
}

async function move(
  id: string,
  from: string,
  to: string,
  remarks: string,
  notice?: { lastWorkingDayConfirmed?: string | null },
): Promise<boolean> {
  try {
    await exitService.updateExitStatus(id, to, remarks, AUTO_ACTOR, from, notice);
    return true;
  } catch (err) {
    logger.error({ err, exitRequestId: id, from, to }, "[exit-auto] transition failed");
    return false;
  }
}

export async function runExitAutoProgress(): Promise<AutoProgressResult> {
  const res: AutoProgressResult = { toManagerReview: 0, toAccepted: 0, toNotice: 0, toExited: 0, failed: 0 };
  if (!(await isExitAutoEnabled())) return { ...res, skipped: "disabled by policy exit/auto/enabled" };

  // 1. submitted -> manager_review
  const [submitted] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM exit_request WHERE status = 'submitted' AND exit_type = 'voluntary'`,
  );
  for (const r of submitted) {
    (await move(String(r.id), "submitted", "manager_review", "Auto: routed to the reporting manager for review"))
      ? res.toManagerReview++ : res.failed++;
  }

  // 2. manager_review -> accepted after the SLA
  const hours = await autoAcceptAfterHours();
  const [review] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM exit_request
      WHERE status = 'manager_review' AND exit_type = 'voluntary'
        AND updated_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
    [hours],
  );
  for (const r of review) {
    (await move(String(r.id), "manager_review", "accepted", `Auto: accepted - no manager action within ${hours}h`))
      ? res.toAccepted++ : res.failed++;
  }

  // 3. accepted -> notice_serving
  if (await isAutoStartNotice()) {
    const [accepted] = await db.execute<RowDataPacket[]>(
      `SELECT id,
              last_working_day_confirmed IS NOT NULL AS has_confirmed,
              DATE_FORMAT(last_working_day_proposed, '%Y-%m-%d') AS proposed
         FROM exit_request WHERE status = 'accepted' AND exit_type = 'voluntary'`,
    );
    for (const r of accepted) {
      if (!r.has_confirmed && !r.proposed) { res.failed++; continue; }
      const notice = r.has_confirmed ? undefined : { lastWorkingDayConfirmed: String(r.proposed) };
      (await move(String(r.id), "accepted", "notice_serving", "Auto: notice period started", notice))
        ? res.toNotice++ : res.failed++;
    }
  }

  // 4. notice_serving -> exited once the last working day has passed
  if (await isAutoExitAtLwd()) {
    const [due] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM exit_request
        WHERE status = 'notice_serving' AND last_working_day_confirmed < CURDATE()`,
    );
    for (const r of due) {
      (await move(String(r.id), "notice_serving", "exited", "Auto: last working day passed"))
        ? res.toExited++ : res.failed++;
    }
  }
  return res;
}
