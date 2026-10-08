/**
 * Manager decisions on a rejected week-off (wfm_roster_assignment in pending_manager_action):
 * realign, force-approve, escalate, reject-request.
 *
 * Extracted verbatim from the four POST /api/wfm/manager/weekoff-review/:assignmentId/* handlers
 * in wfm.routes.ts so the Roster Requests hub (roster-requests.decide.ts) can apply the same
 * decision through the same code. The route handlers are now thin wrappers: every refusal is
 * thrown as a WeekoffReviewError carrying the exact status code and JSON body the handler used to
 * send, and the handler replays it unchanged.
 *
 * Idempotency note: like the original handlers, these functions do NOT check that the assignment
 * is still in pending_manager_action — a repeat call re-applies the decision. That is existing
 * behaviour and is preserved here; the hub's decide path performs its own status pre-check.
 */
import type { RowDataPacket } from "mysql2";
import type { Request } from "express";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { checkAssignmentDateNotLocked } from "../roster/roster-lock-guard.js";
import { notifyWeekoffDecision } from "../roster-requests/roster-requests.notify.js";

export type TxExec = { execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]> };

export interface WeekoffReviewError extends Error {
  statusCode: number;
  body: Record<string, unknown>;
}

function fail(statusCode: number, body: Record<string, unknown>): WeekoffReviewError {
  return Object.assign(new Error(String(body.error ?? body.message ?? "Request failed")), { statusCode, body });
}

export function isWeekoffReviewError(err: unknown): err is WeekoffReviewError {
  return !!err && typeof err === "object" && typeof (err as any).statusCode === "number" && !!(err as any).body;
}

export interface WeekoffReviewParams {
  assignmentId: string;
  userId: string;
  body: { reason?: unknown; new_roster_date?: unknown; new_shift_template_id?: unknown };
  req?: Request;
  /**
   * Optional extra writes run INSIDE the decision transaction, after the state change and audit
   * row (used by the roster-requests hub to write its decision log atomically with the decision).
   */
  onTx?: (tx: TxExec) => Promise<void>;
  /**
   * Set ONLY by the roster-requests auto-approve path (decide with actor.auto): the decision is taken
   * by a configured process rule, not a person, so there is no manager whose scope to verify. The
   * reason requirement and the attendance/payroll lock check still apply. No HTTP handler sets it.
   */
  systemActor?: true;
}

export interface WeekoffReviewResult {
  message: string;
  finalRosterStatus: string;
}

/**
 * Run a manager decision's state change and its audit row as ONE transaction.
 *
 * The four manager-review actions each perform two writes: an UPDATE that records the decision on
 * the assignment, and an INSERT into roster_decision_audit that records who made it and why. They
 * ran unwrapped, so a failure between them committed the first and lost the second — observed for
 * real on 2026-08-20, when the audit INSERT died on a foreign key and left an assignment at
 * 'force_approved_by_manager' with no audit row at all. A decision existing with no record of who
 * took it is exactly what CLAUDE.md rule 8 forbids.
 *
 * The publish route already does this correctly; these four were the outliers.
 *
 * The pool is shared by ~45 workers and a single unreleased connection has previously starved all
 * of them for 16 days, so release() is in a finally and runs on every path. rollback() is
 * additionally guarded: if the connection died mid-transaction the rollback itself can throw, and
 * that must not replace the original error, which is the one worth reporting.
 */
export async function inManagerDecisionTx<T>(fn: (tx: TxExec) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn as never);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Advance a cycle from 'published' to 'acknowledged' once nobody is left to answer.
 *
 * VALID_TRANSITIONS (roster.governance.service.ts) allows published -> acknowledged, and
 * acknowledged -> active is the gateway to the rest of the lifecycle — active, attendance_locked,
 * payroll_input_ready. Nothing ever performed this transition, so a fully acknowledged week sat at
 * 'published' forever and the lifecycle stalled one step after publish. Verified end to end
 * against production 2026-08-20: all seven assignments reached 'acknowledged' and the cycle was
 * still 'published'.
 *
 * The NOT EXISTS covers every state that is still waiting on a human, not just employee
 * acknowledgement: a rejection moves an assignment to 'pending_manager_action' (and possibly on to
 * 'escalated_to_hr'), and a week with an unresolved rejection is not acknowledged. So one holdout
 * correctly keeps the whole cycle open rather than letting it advance around them.
 *
 * Guarded on status = 'published' so this can only ever perform that one legal transition — it
 * cannot regress a cycle that has already moved on, which is the failure the publish route's own
 * POST_PUBLISH_STATUSES check exists to prevent.
 */
export async function advanceCycleIfFullyAcknowledged(
  dbConn: { execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]> },
  assignmentId: string
): Promise<void> {
  try {
    await dbConn.execute(
      `UPDATE weekly_roster_cycle c
          SET c.status = 'acknowledged', c.updated_at = NOW()
        WHERE c.id = (SELECT a.cycle_id FROM wfm_roster_assignment a WHERE a.id = ?)
          AND c.status = 'published'
          AND NOT EXISTS (
              SELECT 1 FROM wfm_roster_assignment p
               WHERE p.cycle_id = c.id
                 AND p.final_roster_status IN
                     ('pending_employee_ack', 'pending_manager_action', 'escalated_to_hr'))`,
      [assignmentId]
    );
  } catch (err) {
    // Non-fatal for the same reason closeRosterAckInboxItem is: the employee's answer is already
    // committed, and refusing it because the cycle header did not move would be worse. Logged
    // rather than swallowed, so a cycle stuck at 'published' is diagnosable instead of silent.
    console.error("[roster] failed to advance cycle to acknowledged", { assignmentId, err });
  }
}

/**
 * Shared preamble of all four actions: reason required, manager scope verified before mutation,
 * and the attendance/payroll lock (Part A.3) checked. Order and responses are unchanged.
 */
async function preflight(p: WeekoffReviewParams): Promise<string> {
  const reason = p.body.reason;
  if (!reason) throw fail(400, { error: "reason is required" });

  // Verify manager scope before mutation
  const isPrivileged = p.systemActor === true || (await hasRole(p.userId, "admin", "hr", "wfm"));
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(p.userId);
    if (!emp) throw fail(403, { error: "No employee record" });
    const [scopeCheck] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM wfm_roster_assignment wra
        JOIN employees e ON e.id = wra.employee_id
        -- LEFT, not INNER: 333,762 of 413,386 roster rows carry process_name NULL, so an
        -- inner join discards the row before the OR below is ever evaluated and the
        -- reporting-manager branch can never match — a manager was refused on their own
        -- direct report. pm.id is then NULL, and ups.process_id = pm.id cannot match a
        -- NULL, so the scope branch is unchanged: this restores the manager path only.
        LEFT JOIN process_master pm ON pm.process_name = wra.process_name
       WHERE wra.id = ? AND (e.reporting_manager_id = ? OR EXISTS (
         SELECT 1 FROM user_assignment_scope ups
          WHERE ups.user_id = ? AND ups.process_id = pm.id AND ups.active_status = 1
       )) LIMIT 1`,
      [p.assignmentId, emp.id, p.userId]
    );
    if (!(scopeCheck as RowDataPacket[])[0]) {
      throw fail(403, { error: "Not authorized to act on this employee" });
    }
  }

  // Blocks the override once attendance for the assignment's date has been locked for payroll
  // (payroll-governance freezeAttendance). See roster-lock-guard.ts.
  const lockCheck = await checkAssignmentDateNotLocked(db, p.assignmentId);
  if (lockCheck.blocked) throw fail(409, { error: lockCheck.error });

  return reason as string;
}

/** POST /manager/weekoff-review/:assignmentId/realign */
export async function realignWeekoff(p: WeekoffReviewParams): Promise<WeekoffReviewResult> {
  const reason = await preflight(p);
  const { assignmentId, userId } = p;
  const { new_roster_date, new_shift_template_id } = p.body as { new_roster_date?: any; new_shift_template_id?: any };

  // Round 2 (2026-08-13) minimum-rest audit finding: realign can move an
  // employee onto a different shift_template_id, which can violate minimum
  // rest against their neighboring shifts just as surely as any other
  // roster write — but unlike manual assignment/bulk-upload, this endpoint
  // never called into rest-policy.service.ts at all. Only checked when a
  // new shift is actually being set (a pure date move with no shift change
  // carries the assignment's already-validated times, unchanged). Blocking-
  // only, no override support here yet — matches bulk-upload's posture,
  // the more conservative of the two existing behaviors in this codebase.
  if (new_shift_template_id) {
    // process_id/branch_id joined in here too (not just employee_id) — without
    // it, a process- or branch-scoped rest policy could never resolve on this
    // endpoint, silently falling back to organization-only.
    const [assignRows] = await db.execute<RowDataPacket[]>(
      `SELECT wra.employee_id, wra.roster_date, e.process_id, e.branch_id
         FROM wfm_roster_assignment wra
         JOIN employees e ON e.id = wra.employee_id
        WHERE wra.id = ? LIMIT 1`,
      [assignmentId]
    );
    const assignRow = (assignRows as RowDataPacket[])[0];
    if (assignRow) {
      const [shiftRows] = await db.execute<RowDataPacket[]>(
        `SELECT start_time, end_time FROM wfm_shift_template WHERE id = ? LIMIT 1`,
        [new_shift_template_id]
      );
      const shift = (shiftRows as RowDataPacket[])[0];
      if (shift?.start_time && shift?.end_time) {
        const effectiveDate = new_roster_date ? String(new_roster_date).slice(0, 10) : String(assignRow.roster_date).slice(0, 10);
        const { validateMinimumRest, isRestPolicyFeatureActive } = await import("./rest-policy.service.js");
        if (await isRestPolicyFeatureActive(db)) {
          const restResult = await validateMinimumRest(
            { employeeId: String(assignRow.employee_id), processId: assignRow.process_id ?? null, branchId: assignRow.branch_id ?? null, forDate: effectiveDate },
            { startTime: String(shift.start_time).slice(0, 5), endTime: String(shift.end_time).slice(0, 5) },
            assignmentId,
            db
          );
          if (!restResult.ok) {
            throw fail(409, {
              error: restResult.reason === "REST_POLICY_MISSING"
                ? "No minimum-rest policy is configured for this employee/process/branch/organization — cannot verify this realignment is safe."
                : `Realigning to this shift leaves only ${restResult.actualRestMinutes} minute(s) of rest against the ${restResult.against} shift (minimum required: ${restResult.requiredRestMinutes}).`,
              reason: restResult.reason,
            });
          }
        }
      }
    }
  }

  const updates: string[] = [
    "final_roster_status = 'realigned_by_manager'",
    "manager_action_status = 'realigned'",
    "manager_action_by = ?",
    "manager_action_at = NOW()",
    "manager_action_reason = ?",
  ];
  const vals: unknown[] = [userId, reason];

  if (new_roster_date) { updates.push("roster_date = ?"); vals.push(new_roster_date); }
  if (new_shift_template_id) { updates.push("shift_template_id = ?"); vals.push(new_shift_template_id); }
  vals.push(assignmentId);

  // State change and audit row are one transaction: a failure between them would otherwise commit
  // the realignment and lose the record of who made it. See inManagerDecisionTx.
  await inManagerDecisionTx(async (tx) => {
    await tx.execute(`UPDATE wfm_roster_assignment SET ${updates.join(", ")} WHERE id = ?`, vals);

    // Write audit row
    await tx.execute(
      `INSERT INTO roster_decision_audit
         (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
          override_by, override_reason, override_at, acted_by_role, old_value_json, new_value_json)
       SELECT UUID(), generation_run_id, COALESCE(cycle_id,''), employee_id, roster_date,
              'manager_realigned', 'manager_realign_action', ?, ?, NOW(), 'manager',
              JSON_OBJECT('status','pending_manager_action'),
              JSON_OBJECT('status','realigned_by_manager','new_roster_date',?,'new_shift_template_id',?)
         FROM wfm_roster_assignment WHERE id = ?`,
      [userId, reason, new_roster_date ?? null, new_shift_template_id ?? null, assignmentId]
    );
    if (p.onTx) await p.onTx(tx);
  });

  // A manager resolution can clear the LAST thing a cycle was waiting on, so the same
  // published -> acknowledged check the employee path runs must happen here too. Without
  // it a week whose final holdout was settled by a manager, rather than by the employee
  // acknowledging, would sit at 'published' forever. Escalation deliberately does NOT call
  // this: 'escalated_to_hr' is still awaiting a human.
  await advanceCycleIfFullyAcknowledged(db, assignmentId);
  await notifyWeekoffDecision(db, assignmentId, "Week-off request adjusted", (date) => `Your week-off request for ${date} was adjusted by your manager${new_roster_date ? ` (new date: ${String(new_roster_date).slice(0, 10)})` : ""}.`);
  return { message: "Assignment realigned", finalRosterStatus: "realigned_by_manager" };
}

/** POST /manager/weekoff-review/:assignmentId/force-approve */
export async function forceApproveWeekoff(p: WeekoffReviewParams): Promise<WeekoffReviewResult> {
  const reason = await preflight(p);
  const { assignmentId, userId } = p;

  // State change and audit row are one transaction — see inManagerDecisionTx.
  await inManagerDecisionTx(async (tx) => {
    await tx.execute(
      `UPDATE wfm_roster_assignment
          SET final_roster_status = 'force_approved_by_manager',
              manager_action_status = 'force_approved',
              manager_action_by = ?, manager_action_at = NOW(), manager_action_reason = ?
        WHERE id = ?`,
      [userId, reason, assignmentId]
    );

    await tx.execute(
      `INSERT INTO roster_decision_audit
         (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
          override_by, override_reason, override_at, acted_by_role)
       SELECT UUID(), generation_run_id, COALESCE(cycle_id,''), employee_id, roster_date,
              'force_approved', 'manager_force_approve', ?, ?, NOW(), 'manager'
         FROM wfm_roster_assignment WHERE id = ?`,
      [userId, reason, assignmentId]
    );
    if (p.onTx) await p.onTx(tx);
  });

  // See realignWeekoff: a manager resolution can clear the cycle's last holdout.
  await advanceCycleIfFullyAcknowledged(db, assignmentId);
  await notifyWeekoffDecision(db, assignmentId, "Week-off request approved", (date) => `Your week-off request for ${date} was approved.`);
  return { message: "Assignment force-approved", finalRosterStatus: "force_approved_by_manager" };
}

/** POST /manager/weekoff-review/:assignmentId/escalate — does not advance the cycle or notify. */
export async function escalateWeekoff(p: WeekoffReviewParams): Promise<WeekoffReviewResult> {
  const reason = await preflight(p);
  const { assignmentId, userId } = p;

  // State change and audit row are one transaction — see inManagerDecisionTx.
  await inManagerDecisionTx(async (tx) => {
    await tx.execute(
      `UPDATE wfm_roster_assignment
          SET final_roster_status = 'escalated_to_hr',
              manager_action_status = 'escalated',
              manager_action_by = ?, manager_action_at = NOW(), manager_action_reason = ?
        WHERE id = ?`,
      [userId, reason, assignmentId]
    );

    await tx.execute(
      `INSERT INTO roster_decision_audit
         (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
          override_by, override_reason, override_at, acted_by_role)
       SELECT UUID(), generation_run_id, COALESCE(cycle_id,''), employee_id, roster_date,
              'escalated_to_hr', 'manager_escalate', ?, ?, NOW(), 'manager'
         FROM wfm_roster_assignment WHERE id = ?`,
      [userId, reason, assignmentId]
    );
    if (p.onTx) await p.onTx(tx);
  });

  return { message: "Escalated to HR/WFM", finalRosterStatus: "escalated_to_hr" };
}

/** POST /manager/weekoff-review/:assignmentId/reject-request */
export async function rejectWeekoffRequest(p: WeekoffReviewParams): Promise<WeekoffReviewResult> {
  const reason = await preflight(p);
  const { assignmentId, userId } = p;

  // State change and audit row are one transaction — see inManagerDecisionTx.
  await inManagerDecisionTx(async (tx) => {
    await tx.execute(
      `UPDATE wfm_roster_assignment
          SET final_roster_status = 'manager_rejected_employee_request',
              manager_action_status = 'rejected_request',
              manager_action_by = ?, manager_action_at = NOW(), manager_action_reason = ?
        WHERE id = ?`,
      [userId, reason, assignmentId]
    );

    await tx.execute(
      `INSERT INTO roster_decision_audit
         (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
          override_by, override_reason, override_at, acted_by_role)
       SELECT UUID(), generation_run_id, COALESCE(cycle_id,''), employee_id, roster_date,
              'manager_rejected_request', 'manager_reject_employee_request', ?, ?, NOW(), 'manager'
         FROM wfm_roster_assignment WHERE id = ?`,
      [userId, reason, assignmentId]
    );
    if (p.onTx) await p.onTx(tx);
  });

  // See realignWeekoff: a manager resolution can clear the cycle's last holdout.
  await advanceCycleIfFullyAcknowledged(db, assignmentId);
  await notifyWeekoffDecision(db, assignmentId, "Week-off request declined", (date) => `Your week-off request for ${date} was declined; your original assignment is retained.`);
  return { message: "Employee request rejected — original assignment retained", finalRosterStatus: "manager_rejected_employee_request" };
}
