/**
 * Team Roster - the FINAL step: write an approved submission into wfm_roster_assignment.
 *
 * One transaction per employee, inside withEmployeeRosterLock (the same named lock roster import,
 * manual assign and swap take), so this cannot interleave with another roster write for that person.
 * Every line is re-checked at apply time, because days may have passed since it was proposed:
 *   - attendance locked for payroll            -> line skipped
 *   - approved full leave + working shift      -> line skipped
 *   - FILL_BLANK and the cell is now filled    -> line skipped ("date already rostered")
 *   - CHANGE and the row differs from the manager's snapshot -> line skipped ("changed since proposed")
 *   - minimum-rest BLOCK / policy missing      -> line skipped (WARN mode is recorded, exactly as roster import)
 * A skipped line never fails the submission; the status becomes partially_applied and each line keeps
 * its own applied/skipped/failed state and reason. Only lines still 'pending' are processed, so calling
 * this again after a crash resumes rather than duplicating.
 *
 * Column semantics mirror roster-import.service.ts commitImportBatch: assignment_type, is_week_off
 * (the flag 112 call sites read), shift_start_time/end_time, lifecycle_state 'DRAFT'; the row then
 * enters the same employee-acknowledgement pipeline as an imported row (final_roster_status
 * 'pending_employee_ack' + a ROSTER_ACK_PENDING inbox item). process_id / lob_id are stamped through
 * roster-offday-apply.ts stampRows; manager_employee_id is filled from the employee's reporting manager.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { logRosterChange } from "../roster/roster-change-log.js";
import { checkEmployeeDateNotLocked } from "../roster/roster-lock-guard.js";
import { checkLeaveConflict, loadApprovedLeave } from "./roster-leave-guard.service.js";
import { stampRows } from "./roster-offday-apply.js";
import { applyRestDecision, isRestPolicyFeatureActive, validateMinimumRest, withEmployeeRosterLock } from "./rest-policy.service.js";
import { computeScheduledMinutes, rosterAssignmentColumns } from "./shift-scheduling.util.js";
import { loadEmployeeGuardInfo, type EmployeeGuardInfo } from "./team-roster-guards.js";
import { loadSubmissionLines, type SubmitLine } from "./team-roster-submit.js";
import { isDuplicateKey } from "./team-roster-tx.js";
import { snapshotMatches, snapshotOf, rowsOf, type Actor, type SqlExecutor } from "./team-roster-types.js";

export interface ApplyResult { applied: number; skipped: number; failed: number; total: number; appliedEmployeeIds: string[] }

type LineOutcome = { status: "applied" | "skipped"; reason?: string; assignmentId?: string };

interface ApplyContext {
  submissionId: number;
  actor: Actor;
  info: Map<string, EmployeeGuardInfo>;
  managerOf: Map<string, string | null>;
  leave: Awaited<ReturnType<typeof loadApprovedLeave>>;
  restActive: boolean;
  hasScheduledMinutes: boolean;
  audit: Array<Parameters<typeof writeAuditLog>[0]>;
}

const txOf = (conn: SqlExecutor) => conn as unknown as { beginTransaction(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void> };
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
const skip = (reason: string): LineOutcome => ({ status: "skipped", reason });

/**
 * The stored-column values for a proposed cell. Mirrors an imported time-only shift row
 * (roster-import.service.ts commit): assignment_type, is_week_off, shift_start_time / shift_end_time as
 * 'HH:MM' (the columns are VARCHAR(5)); only SHIFT carries times. shift_template_id / shift_id are
 * written only when the chosen option has one.
 */
function columnsFor(line: SubmitLine) {
  const isShift = line.newType === "SHIFT";
  return {
    assignmentType: line.newType,
    isWeekOff: line.newType === "WEEK_OFF" ? 1 : 0,
    start: isShift ? hhmm(line.newStart) : null,
    end: isShift ? hhmm(line.newEnd) : null,
    templateId: isShift ? line.templateId : null,
    shiftId: isShift ? line.newShiftId : null,
  };
}

async function restRefusal(conn: SqlExecutor, ctx: ApplyContext, line: SubmitLine): Promise<string | null> {
  // Uses the line's own times; a shift that ends before it starts crosses midnight and validateMinimumRest measures it that way.
  if (line.newType !== "SHIFT" || !ctx.restActive || !line.newStart || !line.newEnd) return null;
  const emp = ctx.info.get(line.employeeId);
  const rest = await validateMinimumRest(
    { employeeId: line.employeeId, processId: emp?.processId ?? null, branchId: emp?.branchId ?? null, forDate: line.date },
    { startTime: line.newStart, endTime: line.newEnd }, line.old.assignmentId, conn as any,
  );
  if (rest.ok) return null;
  const decision = await applyRestDecision(rest, { employeeId: line.employeeId, rosterDate: line.date, assignmentId: line.old.assignmentId }, conn as any);
  if (decision.allowed) return null;
  return rest.reason === "REST_POLICY_MISSING"
    ? "No minimum-rest policy is configured for this process/branch."
    : `Minimum rest not met (${rest.actualRestMinutes ?? "?"} of ${rest.requiredRestMinutes ?? "?"} minutes).`;
}

async function writeLine(conn: SqlExecutor, ctx: ApplyContext, line: SubmitLine): Promise<LineOutcome> {
  const cols = columnsFor(line);
  const minutes = ctx.hasScheduledMinutes && cols.start && cols.end ? computeScheduledMinutes(hhmm(cols.start)!, hhmm(cols.end)!) : null;
  const ackReset = `final_roster_status = 'pending_employee_ack', employee_ack_status = 'pending', employee_ack_at = NULL, employee_rejection_reason = NULL`;
  const current = rowsOf<RowDataPacket>(await conn.execute(
    `SELECT id, cycle_id, assignment_type, is_week_off, shift_template_id, shift_start_time, shift_end_time
       FROM wfm_roster_assignment WHERE employee_id = ? AND roster_date = ? LIMIT 1 FOR UPDATE`, [line.employeeId, line.date],
  ))[0];

  if (line.kind === "FILL_BLANK") {
    if (current) return skip("date already rostered");
    const id = randomUUID();
    try {
      await conn.execute(
        `INSERT INTO wfm_roster_assignment
           (id, employee_id, roster_date, assignment_type, is_week_off, shift_start_time, shift_end_time, shift_template_id,
            ${cols.shiftId ? "shift_id," : ""} ${ctx.hasScheduledMinutes ? "scheduled_minutes," : ""} lifecycle_state, manager_employee_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${cols.shiftId ? "?," : ""} ${ctx.hasScheduledMinutes ? "?," : ""} 'DRAFT', ?, NOW())`,
        [id, line.employeeId, line.date, cols.assignmentType, cols.isWeekOff, cols.start, cols.end, cols.templateId,
          ...(cols.shiftId ? [cols.shiftId] : []), ...(ctx.hasScheduledMinutes ? [minutes] : []), ctx.managerOf.get(line.employeeId) ?? null],
      );
    } catch (err) {
      if (isDuplicateKey(err)) return skip("date already rostered");
      throw err;
    }
    await conn.execute(`UPDATE wfm_roster_assignment SET ${ackReset} WHERE id = ? AND final_roster_status = 'generated'`, [id]);
    await stampRows("wra.id = ?", [id], null, conn);
    ctx.audit.push(auditEntry(ctx, id, line, "FILL_BLANK", null));
    return { status: "applied", assignmentId: id };
  }

  if (!current || !snapshotMatches(snapshotOf(current), line.old)) return skip("changed since proposed");
  const id = String(current.id);
  await conn.execute(
    `UPDATE wfm_roster_assignment
        SET assignment_type = ?, is_week_off = ?, shift_start_time = ?, shift_end_time = ?, shift_template_id = ?, shift_id = ?,
            ${ctx.hasScheduledMinutes ? "scheduled_minutes = ?," : ""} lifecycle_state = 'DRAFT',
            manager_employee_id = COALESCE(manager_employee_id, ?)
      WHERE id = ?`,
    [cols.assignmentType, cols.isWeekOff, cols.start, cols.end, cols.templateId, cols.shiftId, ...(ctx.hasScheduledMinutes ? [minutes] : []),
      ctx.managerOf.get(line.employeeId) ?? null, id],
  );
  await conn.execute(
    `UPDATE wfm_roster_assignment SET ${ackReset}
      WHERE id = ? AND final_roster_status IN ('generated', 'acknowledged', 'pending_employee_ack', 'rejected_by_employee')`, [id],
  );
  await stampRows("wra.id = ?", [id], null, conn);
  await logRosterChange(conn as any, {
    entityType: "wfm_roster_assignment", entityId: id, changedBy: ctx.actor.id, reason: line.reason ?? "Team roster change",
    cycleId: current.cycle_id ? String(current.cycle_id) : null,
    oldValue: { shift_template_id: line.old.shiftTemplateId, is_week_off: line.old.isWeekOff },
    newValue: { shift_template_id: cols.templateId, is_week_off: cols.isWeekOff === 1 },
  });
  ctx.audit.push(auditEntry(ctx, id, line, "CHANGE", line.reason));
  return { status: "applied", assignmentId: id };
}

function auditEntry(ctx: ApplyContext, assignmentId: string, line: SubmitLine, kind: string, reason: string | null | undefined) {
  return {
    actor_user_id: ctx.actor.id, action_type: "TEAM_ROSTER_LINE_APPLIED", module_key: "wfm_team_roster",
    entity_type: "wfm_roster_assignment", entity_id: assignmentId, reason: reason ?? undefined,
    change_summary: { submission_id: ctx.submissionId, employee_id: line.employeeId, roster_date: line.date, kind, new_type: line.newType, shift_template_id: line.templateId, shift_start: line.newStart, shift_end: line.newEnd },
  };
}

async function applyLine(conn: SqlExecutor, ctx: ApplyContext, line: SubmitLine): Promise<LineOutcome> {
  const state = rowsOf<RowDataPacket>(await conn.execute(`SELECT line_status FROM roster_team_submission_line WHERE id = ? FOR UPDATE`, [line.id]))[0];
  if (!state || state.line_status !== "pending") return skip("already processed");
  const lock = await checkEmployeeDateNotLocked(conn as any, line.employeeId, line.date);
  if (lock.blocked) return skip("attendance locked for payroll");
  const leave = checkLeaveConflict(ctx.leave, line.employeeId, line.date, {
    isNightShift: Boolean(line.newStart && line.newEnd && line.newEnd < line.newStart), assignmentType: line.newType === "SHIFT" || line.newType === "TRAINING" ? "SHIFT" : "UNASSIGNED",
  });
  if (leave.blocked) return skip("approved leave on this date");
  const refusal = await restRefusal(conn, ctx, line);
  if (refusal) return skip(refusal);
  return writeLine(conn, ctx, line);
}

async function markLine(conn: SqlExecutor, line: SubmitLine, out: LineOutcome) {
  await conn.execute(
    `UPDATE roster_team_submission_line SET line_status = ?, skip_reason = ?, applied_assignment_id = ? WHERE id = ?`,
    [out.status, out.reason ? out.reason.slice(0, 255) : null, out.assignmentId ?? null, line.id],
  );
}

async function applyEmployee(ctx: ApplyContext, employeeId: string, lines: SubmitLine[], result: ApplyResult) {
  const auditMark = ctx.audit.length;
  try {
    const outcomes = await withEmployeeRosterLock(employeeId, async (conn) => {
      const tx = txOf(conn as SqlExecutor);
      await tx.beginTransaction();
      try {
        const done: Array<[SubmitLine, LineOutcome]> = [];
        for (const line of lines) {
          const out = await applyLine(conn as SqlExecutor, ctx, line);
          await markLine(conn as SqlExecutor, line, out);
          done.push([line, out]);
        }
        await tx.commit();
        return done;
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    });
    for (const [, out] of outcomes) {
      if (out.status === "applied") result.applied += 1; else result.skipped += 1;
    }
    if (outcomes.some(([, o]) => o.status === "applied")) result.appliedEmployeeIds.push(employeeId);
  } catch (err) {
    console.error("[team-roster] apply failed for employee", employeeId, (err as Error)?.message);
    ctx.audit.length = auditMark; // the employee's transaction rolled back: nothing was written, nothing to audit
    const reason = ((err as Error)?.message || "Apply failed").slice(0, 255);
    await db.execute(
      `UPDATE roster_team_submission_line SET line_status = 'failed', skip_reason = ? WHERE submission_id = ? AND employee_id = ? AND line_status = 'pending'`,
      [reason, ctx.submissionId, employeeId],
    );
    result.failed += lines.length;
  }
}

/** Best-effort: ask each employee whose roster changed to acknowledge it (same inbox item roster import creates). */
async function notifyAcknowledgement(submissionId: number, employeeIds: string[]) {
  try {
    for (const employeeId of employeeIds) {
      await db.execute(
        `INSERT INTO work_inbox_item (id, user_id, type, title, description, entity_type, entity_id, action_url, priority)
         SELECT UUID(), e.user_id, 'ROSTER_ACK_PENDING', 'Acknowledge your roster',
                'Your manager updated your roster. Please acknowledge or raise a concern.',
                'roster_team_submission', ?, '/my-roster', 'normal'
           FROM employees e JOIN auth_user au ON au.id = e.user_id
          WHERE e.id = ? AND NOT EXISTS (
                SELECT 1 FROM work_inbox_item w WHERE w.user_id = e.user_id AND w.type = 'ROSTER_ACK_PENDING'
                   AND w.entity_id = ? AND w.is_actioned = 0)`,
        [String(submissionId), employeeId, String(submissionId)],
      );
    }
  } catch (err) {
    console.error("[team-roster] acknowledgement notification failed (roster already applied):", (err as Error)?.message);
  }
}

export async function applySubmission(submissionId: number, actor: Actor): Promise<ApplyResult> {
  const all = await loadSubmissionLines(submissionId);
  const pending: SubmitLine[] = [];
  for (const l of all) {
    const st = rowsOf<RowDataPacket>(await db.execute(`SELECT line_status FROM roster_team_submission_line WHERE id = ?`, [l.id]))[0];
    if (st?.line_status === "pending") pending.push(l);
  }
  const result: ApplyResult = { applied: 0, skipped: 0, failed: 0, total: pending.length, appliedEmployeeIds: [] };
  if (!pending.length) return result;

  const ids = [...new Set(pending.map((l) => l.employeeId))];
  const dates = pending.map((l) => l.date).sort();
  const managerOf = new Map<string, string | null>();
  const mgr = rowsOf<RowDataPacket>(await db.execute(
    `SELECT id, reporting_manager_id, manager_id FROM employees WHERE id IN (${ids.map(() => "?").join(",")})`, ids,
  ));
  mgr.forEach((r) => managerOf.set(String(r.id), r.reporting_manager_id ? String(r.reporting_manager_id) : r.manager_id ? String(r.manager_id) : null));

  const ctx: ApplyContext = {
    submissionId, actor,
    info: await loadEmployeeGuardInfo(ids),
    managerOf,
    leave: await loadApprovedLeave(ids, dates[0], dates[dates.length - 1]),
    restActive: await isRestPolicyFeatureActive(),
    hasScheduledMinutes: (await rosterAssignmentColumns(db as any)).has("scheduled_minutes"),
    audit: [],
  };
  const byEmployee = new Map<string, SubmitLine[]>();
  for (const l of pending) byEmployee.set(l.employeeId, [...(byEmployee.get(l.employeeId) ?? []), l]);
  for (const [employeeId, lines] of byEmployee) await applyEmployee(ctx, employeeId, lines, result);

  await Promise.all(ctx.audit.map((entry) => writeAuditLog(entry)));
  await notifyAcknowledgement(submissionId, result.appliedEmployeeIds);
  return result;
}
