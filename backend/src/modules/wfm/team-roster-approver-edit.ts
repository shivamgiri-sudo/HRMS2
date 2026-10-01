/**
 * Team Roster - an approver re-assigns one cell of a pending submission while reviewing it.
 *
 * Allowed at the step the caller may decide (manager step: the named manager or admin; WFM step: a WFM
 * role whose scope covers the employee) and never for the submitter. The date must sit inside the
 * submission window so its span never changes. Picking what the roster already says removes the
 * approver's line again (the cell is released). Every edit is audited on the submission timeline.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { evaluateGuards } from "./team-roster-guards.js";
import { loadCurrentCells } from "./team-roster-draft.js";
import { loadShiftOptions, resolveShiftChoice, type ShiftOption } from "./team-roster-shifts.js";
import { recordAudit } from "./team-roster-audit.js";
import { resolveCallerEmployee, resolveTeamTree } from "./team-roster-tree.js";
import { isDuplicateKey, withTransaction } from "./team-roster-tx.js";
import {
  assertWfmScopeCoversEmployee, lockSubmission, refuseSelfApproval,
} from "./team-roster-workflow.js";
import {
  MAX_LINES_PER_SUBMISSION, MIN_REASON_LENGTH, NEW_ASSIGNMENT_TYPES, SUBMISSION_STATUS, TeamRosterError, cellKey, formatDmy,
  isGlobalApprover, isValidYmd, isWfmApprover, rowsOf, todayIst, type Actor, type LineKind, type NewAssignmentType,
} from "./team-roster-types.js";

export interface ApproverEditInput {
  employeeId: string; date: string; type: NewAssignmentType;
  shiftStart?: string | null; shiftEnd?: string | null; reason?: string | null;
}

export async function editSubmissionLine(actor: Actor, id: number, input: ApproverEditInput) {
  if (!isValidYmd(input.date)) throw new TeamRosterError(400, "Invalid date.", "BAD_DATE");
  if (!(NEW_ASSIGNMENT_TYPES as readonly string[]).includes(input.type)) throw new TeamRosterError(400, "Choose Shift, Week off, Training or Unscheduled.", "BAD_TYPE");
  const head = rowsOf<RowDataPacket>(await db.execute(
    `SELECT s.*, DATE_FORMAT(s.from_date, '%Y-%m-%d') AS from_d, DATE_FORMAT(s.to_date, '%Y-%m-%d') AS to_d FROM roster_team_submission s WHERE s.id = ? LIMIT 1`, [id],
  ))[0];
  if (!head) throw new TeamRosterError(404, "Submission not found.", "NOT_FOUND");
  const status = String(head.status);
  if (status !== SUBMISSION_STATUS.PENDING_MANAGER && status !== SUBMISSION_STATUS.PENDING_WFM) {
    throw new TeamRosterError(409, "Only a submission awaiting approval can be edited.", "WRONG_STATE");
  }
  const caller = await refuseSelfApproval(actor, head);
  if (status === SUBMISSION_STATUS.PENDING_MANAGER) {
    if (!(caller && String(head.manager_approver_employee_id) === caller.id) && !isGlobalApprover(actor)) {
      throw new TeamRosterError(403, "Only the submitter's reporting manager can edit at this step.", "NOT_APPROVER");
    }
  } else {
    if (!isWfmApprover(actor)) throw new TeamRosterError(403, "Only WFM can edit at this step.", "NOT_WFM");
    await assertWfmScopeCoversEmployee(actor, input.employeeId);
  }
  if (input.date < todayIst()) throw new TeamRosterError(400, "Past dates cannot be changed.", "PAST_DATE");
  if (input.date < head.from_d || input.date > head.to_d) throw new TeamRosterError(400, `Edit within the submission window (${formatDmy(head.from_d)} to ${formatDmy(head.to_d)}).`, "OUT_OF_WINDOW");

  const inLines = rowsOf<RowDataPacket>(await db.execute(
    `SELECT id FROM roster_team_submission_line WHERE submission_id = ? AND employee_id = ? AND roster_date = ?`, [id, input.employeeId, input.date],
  ))[0];
  if (!inLines) {
    const tree = await resolveTeamTree(String(head.submitter_employee_id));
    if (!tree.ids.includes(input.employeeId)) throw new TeamRosterError(403, "Employee is not in the submitter's team.", "NOT_IN_TEAM");
  }
  const emp = rowsOf<RowDataPacket>(await db.execute(`SELECT process_id FROM employees WHERE id = ? LIMIT 1`, [input.employeeId]))[0];
  if (!emp) throw new TeamRosterError(404, "Employee not found.", "NOT_FOUND");
  let option: ShiftOption | null = null;
  if (input.type === "SHIFT") {
    const opts = await loadShiftOptions(emp.process_id ? [String(emp.process_id)] : [], todayIst());
    option = resolveShiftChoice({ shiftStart: input.shiftStart, shiftEnd: input.shiftEnd }, opts.get(String(emp.process_id)) ?? [], input.date);
  }
  const current = (await loadCurrentCells([input.employeeId], input.date, input.date)).get(cellKey(input.employeeId, input.date)) ?? null;
  const same = Boolean(current && current.assignmentType === input.type && (input.type !== "SHIFT" || (current.shiftStartTime === option?.start && current.shiftEndTime === option?.end)));
  const reason = String(input.reason ?? "").trim() || "Adjusted by approver";
  if (!same && current && reason.length < MIN_REASON_LENGTH) throw new TeamRosterError(400, `A reason of at least ${MIN_REASON_LENGTH} characters is required.`, "REASON_REQUIRED");

  const verdict = same ? null : (await evaluateGuards([{
    employeeId: input.employeeId, date: input.date, newType: input.type, shiftStart: option?.start ?? null, shiftEnd: option?.end ?? null, oldAssignmentId: current?.assignmentId ?? null,
  }])).get(cellKey(input.employeeId, input.date)) ?? { warnings: [], block: null };
  if (verdict?.block) throw new TeamRosterError(422, verdict.block, "GUARD_BLOCK");

  return withTransaction(async (conn) => {
    await lockSubmission(conn, id, status);
    if (same) {
      if (!inLines) throw new TeamRosterError(400, "This is already what the roster says; nothing to change.", "NO_CHANGE");
      await conn.execute(`DELETE FROM roster_team_submission_line WHERE id = ?`, [inLines.id]);
      await conn.execute(`DELETE FROM roster_team_pending_cell WHERE submission_id = ? AND employee_id = ? AND roster_date = ?`, [id, input.employeeId, input.date]);
      await recordAudit(conn, id, "line_edited", actor, null, { employeeId: input.employeeId, date: input.date, reverted: true });
      return { edited: true, removed: true };
    }
    const warnings = verdict?.warnings.length ? JSON.stringify(verdict.warnings) : null;
    if (inLines) {
      await conn.execute(
        `UPDATE roster_team_submission_line SET new_assignment_type = ?, new_shift_template_id = ?, new_shift_start_time = ?, new_shift_end_time = ?,
                new_shift_id = ?, reason = ?, warnings_json = ?, line_status = 'pending', skip_reason = NULL WHERE id = ?`,
        [input.type, option?.templateId ?? null, option?.start ?? null, option?.end ?? null, option?.shiftMasterId ?? null, reason, warnings, inLines.id],
      );
    } else {
      const n = Number(rowsOf<RowDataPacket>(await conn.execute(`SELECT COUNT(*) AS c FROM roster_team_submission_line WHERE submission_id = ?`, [id]))[0]?.c ?? 0);
      if (n >= MAX_LINES_PER_SUBMISSION) throw new TeamRosterError(400, `A submission can hold at most ${MAX_LINES_PER_SUBMISSION} cells.`, "TOO_MANY_LINES");
      try {
        await conn.execute(`INSERT INTO roster_team_pending_cell (employee_id, roster_date, submission_id) VALUES (?, ?, ?)`, [input.employeeId, input.date, id]);
      } catch (err) {
        if (isDuplicateKey(err)) throw new TeamRosterError(409, "This date is pending in another submission.", "CELL_LOCKED");
        throw err;
      }
      const o = current;
      const kind: LineKind = o ? "CHANGE" : "FILL_BLANK";
      await conn.execute(
        `INSERT INTO roster_team_submission_line
           (submission_id, employee_id, roster_date, kind, old_assignment_id, old_assignment_type, old_is_week_off,
            old_shift_template_id, old_shift_start_time, old_shift_end_time, new_assignment_type, new_shift_template_id,
            new_shift_start_time, new_shift_end_time, new_shift_id, reason, warnings_json, line_status, skip_reason, applied_assignment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)`,
        [id, input.employeeId, input.date, kind, o?.assignmentId ?? null, o?.assignmentType ?? null, o ? (o.isWeekOff ? 1 : 0) : null,
          o?.shiftTemplateId ?? null, o?.shiftStartTime ?? null, o?.shiftEndTime ?? null, input.type, option?.templateId ?? null,
          option?.start ?? null, option?.end ?? null, option?.shiftMasterId ?? null, reason, warnings],
      );
    }
    await recordAudit(conn, id, "line_edited", actor, reason, {
      employeeId: input.employeeId, date: input.date, type: input.type, shift: option ? `${option.start}-${option.end}` : null, added: !inLines,
    });
    return { edited: true, removed: false };
  });
}
