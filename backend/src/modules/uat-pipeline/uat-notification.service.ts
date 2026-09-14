/**
 * Lifecycle notifications for UAT feedback.
 *
 * WHY EACH EVENT IS ITS OWN EXPORTED FUNCTION
 *   Notification call sites in this repository have repeatedly been deleted by unrelated
 *   commits, leaving an engine that works and events nobody receives. A named function per
 *   event gives uat-notification-sites.test.ts something concrete to assert is still called
 *   from the service that owns the transition. A generic notify(eventCode, ...) helper would
 *   be tidier and completely untestable for that failure.
 *
 * EVERY FUNCTION SWALLOWS ITS OWN ERRORS, DELIBERATELY
 *   A notification is a side effect of a lifecycle transition, never a precondition for it.
 *   If the mail provider is down, a retest result must still be recorded. The failure is
 *   written to the audit spine instead of thrown, so it is visible without being fatal —
 *   this is the one place in the module where swallowing is correct, and it is not silent.
 *
 * The gateway itself fails closed: an event with no row in notification_event_config sends
 * nothing. Migration 1100 registers all of these.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { notificationGateway } from "../communication/notification.gateway.js";
import { recordEvent } from "./uat-state-machine.js";

export const UAT_NOTIFICATION_EVENTS = [
  "uat_feedback_blocked",
  "uat_feedback_needs_info",
  "uat_feedback_assigned",
  "uat_approval_requested",
  "uat_approval_decided",
  "uat_build_failed",
  "uat_pr_ready",
  "uat_deployed_for_retest",
  "uat_retest_failed",
  "uat_released",
  "uat_rolled_back",
  "uat_closed",
] as const;

export type UatNotificationEvent = (typeof UAT_NOTIFICATION_EVENTS)[number];

interface NotifyContext {
  feedbackId: string;
  feedbackCode: string;
  employeeId: string;
  branchId?: string | null;
  processId?: string | null;
  /** Title only. Never the body: notification payloads are not a PII-controlled surface. */
  title: string;
  extra?: Record<string, unknown>;
}

async function send(eventCode: UatNotificationEvent, ctx: NotifyContext): Promise<boolean> {
  try {
    const outcome = await notificationGateway.notify({
      eventCode,
      dedupeKey: `uat_feedback:${ctx.feedbackId}:${eventCode}`,
      context: {
        employeeId: ctx.employeeId,
        branchId: ctx.branchId ?? null,
        processId: ctx.processId ?? null,
      },
      entityType: "uat_feedback",
      entityId: ctx.feedbackId,
      correlationId: `uat:${ctx.feedbackId}`,
      data: {
        feedback_code: ctx.feedbackCode,
        // Title only — a summary line a person wrote for a colleague. The body may contain
        // salary figures or names and is redacted elsewhere; it has no business in an email.
        title: ctx.title,
        ...(ctx.extra ?? {}),
      },
    });
    if (outcome.outcome !== "sent" && outcome.outcome !== "shadow") {
      await recordEvent(ctx.feedbackId, "notification", {
        actorKind: "system",
        message: `notification '${eventCode}' not delivered: ${outcome.outcome}`,
        detail: { eventCode, outcome: outcome.outcome, reason: outcome.reason ?? null },
      });
    }
    return outcome.outcome === "sent";
  } catch (err) {
    // Visible, not silent — but never fatal to the transition that triggered it.
    await recordEvent(ctx.feedbackId, "error", {
      actorKind: "system",
      message: `notification '${eventCode}' threw: ${(err as Error).message}`,
      detail: { eventCode },
    }).catch(() => {
      /* if even the audit write fails, the original transition still stands */
    });
    return false;
  }
}

interface ContextRow extends RowDataPacket {
  feedback_code: string;
  submitted_by_employee_id: string;
  branch_id: string | null;
  process_id: string | null;
  title: string;
}

/**
 * Load the notification context for an item.
 *
 * Selects the title but never body_raw or body_redacted: a notification payload leaves the
 * application through email and push, which are not PII-controlled surfaces. The title is a
 * one-line summary a person wrote for a colleague; the body may contain a salary figure.
 *
 * Returns null rather than throwing when the row is gone — a notification for a deleted item
 * is a no-op, not an error worth propagating into a caller's transaction.
 */
export async function loadNotifyContext(feedbackId: string): Promise<NotifyContext | null> {
  try {
    const [rows] = await db.execute<ContextRow[]>(
      `SELECT feedback_code, submitted_by_employee_id, branch_id, process_id, title
         FROM uat_feedback WHERE id = ?`,
      [feedbackId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      feedbackId,
      feedbackCode: r.feedback_code,
      employeeId: r.submitted_by_employee_id,
      branchId: r.branch_id,
      processId: r.process_id,
      title: r.title,
    };
  } catch {
    return null;
  }
}

export function notifyFeedbackBlocked(ctx: NotifyContext & { reason: string | null }) {
  return send("uat_feedback_blocked", { ...ctx, extra: { reason: ctx.reason } });
}

export function notifyFeedbackNeedsInfo(ctx: NotifyContext & { question: string }) {
  return send("uat_feedback_needs_info", { ...ctx, extra: { question: ctx.question } });
}

export function notifyFeedbackAssigned(ctx: NotifyContext & { assigneeEmployeeId: string | null }) {
  return send("uat_feedback_assigned", {
    ...ctx,
    extra: { assignee_employee_id: ctx.assigneeEmployeeId },
  });
}

export function notifyApprovalRequested(ctx: NotifyContext & { requiredRole: string }) {
  return send("uat_approval_requested", { ...ctx, extra: { required_role: ctx.requiredRole } });
}

export function notifyApprovalDecided(
  ctx: NotifyContext & { decision: string; requiredRole: string }
) {
  return send("uat_approval_decided", {
    ...ctx,
    extra: { decision: ctx.decision, required_role: ctx.requiredRole },
  });
}

export function notifyBuildFailed(ctx: NotifyContext & { gate: string }) {
  return send("uat_build_failed", { ...ctx, extra: { failed_gate: ctx.gate } });
}

export function notifyPrReady(ctx: NotifyContext & { prUrl: string }) {
  return send("uat_pr_ready", { ...ctx, extra: { pr_url: ctx.prUrl } });
}

export function notifyDeployedForRetest(ctx: NotifyContext & { environment: string }) {
  return send("uat_deployed_for_retest", { ...ctx, extra: { environment: ctx.environment } });
}

export function notifyRetestFailed(ctx: NotifyContext & { failureReason: string | null }) {
  return send("uat_retest_failed", { ...ctx, extra: { failure_reason: ctx.failureReason } });
}

export function notifyReleased(ctx: NotifyContext & { version: string }) {
  return send("uat_released", { ...ctx, extra: { version: ctx.version } });
}

export function notifyRolledBack(ctx: NotifyContext & { reason: string }) {
  return send("uat_rolled_back", { ...ctx, extra: { reason: ctx.reason } });
}

export function notifyClosed(ctx: NotifyContext) {
  return send("uat_closed", ctx);
}
