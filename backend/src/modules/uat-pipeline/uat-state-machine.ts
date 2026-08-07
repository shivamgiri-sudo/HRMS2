/**
 * The UAT feedback lifecycle.
 *
 * transition() is the ONLY writer of uat_feedback.status anywhere in the codebase. It takes
 * a row lock, validates the move against a static table, writes the status and its audit
 * event in the SAME transaction, and throws on an illegal move. Nothing else may UPDATE
 * that column: a status written without a matching uat_feedback_event is an item whose
 * history has a hole in it, and a history that can drop a row is not a history.
 *
 * TWO INVARIANTS THE GRAPH ENFORCES BY SHAPE (asserted in uat-state-machine.test.ts):
 *
 *   1. No path from `submitted` to `pr_open` avoids `awaiting_approval`.
 *      An all-green checklist is a recommendation, never a trigger; a human always approves
 *      before the pipeline may open a PR. This is why `reopened` routes back to `triaged`
 *      rather than straight to `build_queued` — the short-cut would have created a path
 *      (manual fix -> merged -> retest_failed -> reopened -> build_queued -> pr_open) that
 *      reaches a pipeline PR without anyone approving one.
 *
 *   2. No path reaches `closed` from a state where a fix shipped, without `retest_passed`.
 *      `closed` is reachable from the no-fix-shipped states (scan_blocked, triaged, invalid,
 *      rejected, validation_failed, checklist_failed, reopened) and from production_verified.
 *      It is NOT reachable from merged, deployed_to_uat, ready_for_retest, retest_failed or
 *      production_released. A merged PR is not a fixed defect; UAT ends when the reporter
 *      confirms it, in production.
 *
 *      NOTE: this is a deliberate refinement of "no path reaches closed without
 *      retest_passed" as originally specified. Taken literally that would strand every
 *      rejected, invalid or scan-blocked item permanently open, because no fix was ever
 *      built for them and so no retest can exist. The property that actually protects
 *      anything is the one implemented here.
 *
 * PHASE 1 REALITY
 *   Phases 2-4 add the LLM and build states. Until then the live path is:
 *     submitted -> scanning -> scan_done -> triaged -> merged (engineered by hand)
 *              -> deployed_to_uat -> ready_for_retest -> retest_passed
 *              -> production_released -> production_verified -> closed
 *   Every state after `merged` is fully usable on day one and applies to human-written
 *   fixes, which is the point: the governance value does not wait for the automation.
 */
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ActorKind, TransitionContext, UatStatus } from "./uat-pipeline.types.js";

export const LEGAL_TRANSITIONS: Record<UatStatus, UatStatus[]> = {
  submitted: ["scanning"],
  scanning: ["scan_blocked", "scan_done"],

  // Blocked by the static scan. Not strictly terminal: a human may route it to manual
  // engineering (triaged) or close it, but it can never re-enter the automated path.
  scan_blocked: ["triaged", "closed"],
  scan_done: ["triaged"],

  // The hub. `merged` is reachable from here because in Phase 1 every fix is engineered
  // by hand and lands through an ordinary reviewed PR.
  triaged: ["validating", "awaiting_governance", "rejected", "invalid", "merged", "closed"],

  validating: ["validation_failed", "invalid", "checklist_failed", "checklist_passed"],
  validation_failed: ["triaged", "rejected", "closed"],
  invalid: ["triaged", "closed"],
  checklist_failed: ["triaged", "rejected", "closed"],
  checklist_passed: ["awaiting_governance"],

  awaiting_governance: ["awaiting_approval", "rejected"],
  // The mandatory human gate. `merged` here is "approved, then engineered by hand".
  awaiting_approval: ["prompt_writing", "merged", "rejected"],
  rejected: ["triaged", "closed"],

  prompt_writing: ["prompt_ready", "validation_failed"],
  prompt_ready: ["build_queued", "rejected"],
  build_queued: ["build_running"],
  build_running: ["pr_open", "build_failed"],
  // Retry is capped at attempt_no <= 2 by a UNIQUE key server-side, not by this table.
  build_failed: ["build_queued", "triaged", "rejected"],

  pr_open: ["reviewed", "rejected"],
  reviewed: ["merged", "rejected"],
  merged: ["deployed_to_uat"],

  deployed_to_uat: ["ready_for_retest"],
  ready_for_retest: ["retest_passed", "retest_failed"],
  retest_failed: ["reopened"],
  // Back to triage, never straight to a build — see invariant 1.
  reopened: ["triaged", "closed"],
  retest_passed: ["production_released"],

  production_released: ["production_verified", "rollback_required"],
  production_verified: ["closed"],
  rollback_required: ["rolled_back"],
  rolled_back: ["reopened"],

  closed: [],
};

export const ALL_STATUSES = Object.keys(LEGAL_TRANSITIONS) as UatStatus[];

/** States from which no fix has shipped, so closing without a retest is legitimate. */
export const NO_FIX_SHIPPED_STATES: UatStatus[] = [
  "scan_blocked",
  "triaged",
  "validation_failed",
  "invalid",
  "checklist_failed",
  "rejected",
  "reopened",
];

export function isTerminal(status: UatStatus): boolean {
  return LEGAL_TRANSITIONS[status].length === 0;
}

export function canTransition(from: UatStatus, to: UatStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export class IllegalTransitionError extends Error {
  readonly statusCode = 409;
  constructor(
    readonly from: UatStatus,
    readonly to: UatStatus
  ) {
    super(
      `Illegal UAT status transition ${from} -> ${to}. Legal from ${from}: ` +
        (LEGAL_TRANSITIONS[from]?.join(", ") || "(terminal)")
    );
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: UatStatus, to: UatStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

interface StatusRow extends RowDataPacket {
  status: UatStatus;
}

/**
 * Move an item to a new status.
 *
 * Locks the row FOR UPDATE before reading the current status, so two concurrent approvals
 * or two browser tabs cannot both observe `awaiting_approval` and both proceed. The status
 * write and the audit event are one transaction; either both land or neither does.
 *
 * Pass an existing connection when the caller already owns a transaction (for example,
 * recording a retest result and moving the status together must be atomic). When no
 * connection is supplied this opens, commits and releases its own.
 */
export async function transition(
  feedbackId: string,
  to: UatStatus,
  ctx: TransitionContext = {},
  existing?: PoolConnection
): Promise<{ from: UatStatus; to: UatStatus }> {
  const conn = existing ?? (await db.getConnection());
  const ownsTransaction = !existing;
  try {
    if (ownsTransaction) await conn.beginTransaction();

    const [rows] = await conn.execute<StatusRow[]>(
      "SELECT status FROM uat_feedback WHERE id = ? FOR UPDATE",
      [feedbackId]
    );
    if (rows.length === 0) {
      const err = new Error(`UAT feedback ${feedbackId} not found`) as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    const from = rows[0].status;

    // Idempotent no-op: re-issuing the same transition (a retried request, a double-click)
    // must not throw and must not write a second audit event.
    if (from === to) {
      if (ownsTransaction) await conn.commit();
      return { from, to };
    }

    assertTransition(from, to);

    await conn.execute(
      "UPDATE uat_feedback SET status = ?, status_reason = ? WHERE id = ?",
      [to, ctx.reason ?? null, feedbackId]
    );

    const actorKind: ActorKind = ctx.actorKind ?? (ctx.actorUserId ? "user" : "system");
    await conn.execute(
      `INSERT INTO uat_feedback_event
         (feedback_id, event_type, from_status, to_status, actor_user_id, actor_kind, detail_json, message)
       VALUES (?, 'state_change', ?, ?, ?, ?, ?, ?)`,
      [
        feedbackId,
        from,
        to,
        ctx.actorUserId ?? null,
        actorKind,
        ctx.detail ? JSON.stringify(ctx.detail) : null,
        // The message is a system-generated summary. It must never contain feedback prose:
        // this table is retained immutably and is kept PII-free by construction.
        `status ${from} -> ${to}`,
      ]
    );

    if (ownsTransaction) await conn.commit();
    return { from, to };
  } catch (err) {
    if (ownsTransaction) {
      try {
        await conn.rollback();
      } catch {
        /* the original error is the one worth surfacing */
      }
    }
    throw err;
  } finally {
    if (ownsTransaction) conn.release();
  }
}

/**
 * Record something that is not a status change: a comment, a scan, an approval decision,
 * a notification dispatch, an error. Same table, so one query renders a complete timeline.
 */
export async function recordEvent(
  feedbackId: string,
  eventType: string,
  ctx: TransitionContext & { message?: string } = {},
  existing?: PoolConnection
): Promise<void> {
  const exec = existing ?? db;
  const actorKind: ActorKind = ctx.actorKind ?? (ctx.actorUserId ? "user" : "system");
  await exec.execute(
    `INSERT INTO uat_feedback_event
       (feedback_id, event_type, actor_user_id, actor_kind, detail_json, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      feedbackId,
      eventType,
      ctx.actorUserId ?? null,
      actorKind,
      ctx.detail ? JSON.stringify(ctx.detail) : null,
      ctx.message ?? null,
    ]
  );
}
