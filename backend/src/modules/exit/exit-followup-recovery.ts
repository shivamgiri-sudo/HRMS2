/**
 * Turn a failed POST-COMMIT exit step into visible, retryable work.
 *
 * WHY
 *   exit.service.ts finalises an exit inside a transaction, then performs a series of
 *   follow-up actions AFTER that transaction commits — F&F record creation, direct-report
 *   re-parenting, LMS/leave/asset deprovisioning, IT deprovisioning dispatch. Doing them
 *   outside the transaction is correct and deliberate: holding a DB transaction open across
 *   external services is exactly what must not happen.
 *
 *   But every one of them handled failure by logging. `.catch(logger.warn)` on the F&F insert
 *   and the direct-report update, a collected `failures[]` array that only reached
 *   `logger.error`, and a fire-and-forget dispatch for IT. The exit itself then reported
 *   success. So the observable outcome of a failed follow-up was a log line on a server nobody
 *   reads, and:
 *
 *     - no F&F draft, so payroll is never alerted to settle
 *     - direct reports left pointing at an exited manager
 *     - LMS access persisting after exit (the reason ~60 leavers were still active learners)
 *     - IT deprovisioning never dispatched
 *
 *   §17 requires that a post-commit failure create visible retryable work. That is what this
 *   does, and it is deliberately the ONLY thing it does — the core exit transaction is closed
 *   and is not reopened, and no follow-up is moved back inside it.
 *
 * IDEMPOTENCY
 *   work_item carries no unique key beyond its primary key — verified against the live schema
 *   — so ON DUPLICATE KEY UPDATE cannot fire on it and would silently append a row per attempt.
 *   Existence is therefore checked in application logic, keyed on (item_type, entity_id) with
 *   the item still open, using the existing idx_entity index. Re-running an exit, or retrying
 *   a step, updates the open item rather than stacking duplicates.
 *
 * NON-THROWING
 *   This records a failure; it must never become one. If the work_item write itself fails the
 *   error is logged and swallowed — raising here would convert "one follow-up step failed"
 *   into "the exit call failed", after the exit has already committed, which is strictly worse
 *   for the caller and changes nothing about the underlying step.
 */
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../lib/logger.js";

/** One item_type per step, so the Work Inbox shows what actually needs doing. */
export type ExitFollowUpStep =
  | "FF_DRAFT_CREATION"
  | "DIRECT_REPORT_REPARENT"
  | "ACCESS_DEPROVISION"
  | "IT_DEPROVISION_DISPATCH";

const STEP_META: Record<ExitFollowUpStep, { title: string; role: string; priority: string }> = {
  FF_DRAFT_CREATION: {
    title: "Full & final draft was not created for an exited employee",
    role: "payroll",
    priority: "critical",
  },
  DIRECT_REPORT_REPARENT: {
    title: "Direct reports still point at an exited manager",
    role: "hr",
    priority: "high",
  },
  ACCESS_DEPROVISION: {
    title: "Access deprovisioning failed for an exited employee",
    role: "it",
    priority: "critical",
  },
  IT_DEPROVISION_DISPATCH: {
    title: "IT exit provisioning tasks were not dispatched",
    role: "it",
    priority: "critical",
  },
};

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (Array.isArray(err)) return err.map((e) => String(e)).join("; ");
  return String(err);
}

export async function recordExitFollowUpFailure(
  step: ExitFollowUpStep,
  exitRequestId: string,
  employeeId: string,
  err: unknown,
): Promise<void> {
  const meta = STEP_META[step];
  const itemType = `EXIT_FOLLOWUP_${step}`;
  const description =
    `Exit ${exitRequestId} (employee ${employeeId}) committed, but the '${step}' follow-up did ` +
    `not complete: ${reasonOf(err)}. The exit itself is recorded; this step must be completed ` +
    `or retried by hand.`;

  try {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM work_item
        WHERE item_type = ? AND entity_type = 'exit_request' AND entity_id = ?
          AND status NOT IN ('completed', 'cancelled')
        LIMIT 1`,
      [itemType, exitRequestId],
    );

    if (existing[0]) {
      await db.execute<ResultSetHeader>(
        `UPDATE work_item SET description = ?, updated_at = NOW() WHERE id = ?`,
        [description, String((existing[0] as { id: unknown }).id)],
      );
      return;
    }

    await db.execute<ResultSetHeader>(
      `INSERT INTO work_item
         (id, item_type, title, description, module_code, entity_type, entity_id,
          assigned_to_role, priority, status, created_at)
       VALUES (UUID(), ?, ?, ?, 'exit', 'exit_request', ?, ?, ?, 'pending', NOW())`,
      [itemType, meta.title, description, exitRequestId, meta.role, meta.priority],
    );
  } catch (writeErr) {
    // Deliberately swallowed — see NON-THROWING above.
    logger.error(
      { err: writeErr, step, exitRequestId, employeeId },
      "[exit] could not record a follow-up failure as work — the underlying step is still unresolved",
    );
  }
}
