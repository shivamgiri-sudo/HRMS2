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
 * Terminal/inactive states (revoked, withdrawn, rejected, closed...) are never touched. Only
 * genuine resignations are automated: HR-raised absconding / termination cases carry a decision
 * HR has not made (deactivating someone is not a formality), so they are never moved here.
 */
export interface AutoProgressResult {
  toManagerReview: number;
  toAccepted: number;
  toNotice: number;
  lwdConfirmed: number;
  toExited: number;
  failed: number;
  skipped?: string;
}

/**
 * A last working day earlier than the day the resignation was filed is a BACKDATED entry: the
 * person has already stopped working and HR is recording it after the fact. The date drives
 * payroll proration and the F&F, so it is HR's to confirm, not a formality. On 2026-10-01 the
 * first run took three such exits (dates 2-16 days in the past) through accepted -> notice ->
 * exited in a single pass and deactivated them; the other 13 pending exits were all backdated.
 * Backdated exits are therefore never moved past manager_review automatically.
 */
const NOT_BACKDATED =
  `(COALESCE(last_working_day_confirmed, last_working_day_proposed) IS NULL
    OR COALESCE(last_working_day_confirmed, last_working_day_proposed) >= DATE(COALESCE(submitted_at, created_at)))`;

async function move(
  id: string,
  from: string,
  to: string,
  remarks: string,
  notice?: { lastWorkingDayConfirmed?: string | null; noticePeriodDays?: number | null },
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
  const res: AutoProgressResult = { toManagerReview: 0, toAccepted: 0, toNotice: 0, lwdConfirmed: 0, toExited: 0, failed: 0 };
  if (!(await isExitAutoEnabled())) return { ...res, skipped: "disabled by policy exit/auto/enabled" };

  // 1. submitted -> manager_review
  const [submitted] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM exit_request WHERE status = 'submitted' AND exit_type = 'voluntary' AND COALESCE(exit_sub_type, 'resignation') = 'resignation'`,
  );
  for (const r of submitted) {
    (await move(String(r.id), "submitted", "manager_review", "Auto: routed to the reporting manager for review"))
      ? res.toManagerReview++ : res.failed++;
  }

  // 4. notice_serving -> exited once the last working day has passed. Runs BEFORE the steps that
  // create notice_serving rows, so an exit can never go accepted -> notice -> exited in one pass:
  // a person always gets at least one cycle between buckets.
  if (await isAutoExitAtLwd()) {
    const [due] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM exit_request
        WHERE status = 'notice_serving' AND last_working_day_confirmed < CURDATE()
          AND exit_type = 'voluntary' AND COALESCE(exit_sub_type, 'resignation') = 'resignation'
          AND ${NOT_BACKDATED}`,
    );
    for (const r of due) {
      (await move(String(r.id), "notice_serving", "exited", "Auto: last working day passed"))
        ? res.toExited++ : res.failed++;
    }
  }

  // 2. manager_review -> accepted after the SLA
  const hours = await autoAcceptAfterHours();
  const [review] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM exit_request
      WHERE status = 'manager_review' AND exit_type = 'voluntary' AND COALESCE(exit_sub_type, 'resignation') = 'resignation'
        AND updated_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)
        AND ${NOT_BACKDATED}`,
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
              notice_period_days,
              DATE_FORMAT(last_working_day_proposed, '%Y-%m-%d') AS proposed
         FROM exit_request WHERE status = 'accepted' AND exit_type = 'voluntary' AND COALESCE(exit_sub_type, 'resignation') = 'resignation'
           AND ${NOT_BACKDATED}`,
    );
    for (const r of accepted) {
      if (!r.has_confirmed && !r.proposed) { res.failed++; continue; }
      // Passing the notice period (unchanged, so no override alert fires) is what makes the status
      // code write notice_start_date / notice_end_date; without it a notice_serving exit had
      // those NULL and every "days remaining" reader had nothing to compute from.
      const days = Number(r.notice_period_days) > 0 ? Number(r.notice_period_days) : null;
      const notice = {
        ...(r.has_confirmed ? {} : { lastWorkingDayConfirmed: String(r.proposed) }),
        ...(days ? { noticePeriodDays: days } : {}),
      };
      (await move(String(r.id), "accepted", "notice_serving", "Auto: notice period started", notice))
        ? res.toNotice++ : res.failed++;
    }
  }

  // 3b. notice_serving with no confirmed last working day (stuck: nothing would ever exit it).
  // Confirm the employee's proposed date, else submission + notice period.
  if (await isAutoStartNotice()) {
    const [noLwd] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM exit_request
        WHERE status = 'notice_serving' AND last_working_day_confirmed IS NULL
          AND exit_type = 'voluntary' AND COALESCE(exit_sub_type, 'resignation') = 'resignation'
          AND (last_working_day_proposed IS NOT NULL OR (submitted_at IS NOT NULL AND notice_period_days > 0))
          AND ${NOT_BACKDATED}`,
    );
    for (const r of noLwd) {
      try {
        const [u] = await db.execute<any>(
          `UPDATE exit_request
              SET last_working_day_confirmed = COALESCE(last_working_day_proposed, DATE_ADD(DATE(submitted_at), INTERVAL notice_period_days DAY)),
                  notice_start_date = COALESCE(notice_start_date, DATE(submitted_at), DATE(created_at)),
                  notice_end_date = COALESCE(notice_end_date, last_working_day_proposed, DATE_ADD(DATE(submitted_at), INTERVAL notice_period_days DAY)),
                  updated_at = NOW()
            WHERE id = ? AND status = 'notice_serving' AND last_working_day_confirmed IS NULL`,
          [r.id],
        );
        if (u.affectedRows === 1) {
          await db.execute(
            `INSERT INTO exit_approval_log (id, exit_request_id, stage, action, action_by, discussion_remarks)
             VALUES (UUID(), ?, 'notice_serving', 'auto_confirm_lwd', ?, ?)`,
            [r.id, AUTO_ACTOR, "Auto: last working day confirmed from the proposed date (none was set)"],
          );
          res.lwdConfirmed++;
        }
      } catch (err) {
        logger.error({ err, exitRequestId: r.id }, "[exit-auto] confirming last working day failed");
        res.failed++;
      }
    }
  }

  return res;
}
