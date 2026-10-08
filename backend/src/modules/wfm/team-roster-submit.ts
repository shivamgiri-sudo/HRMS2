/**
 * Team Roster - Submit, Cancel and "copy back into a draft".
 *
 * Submit is the only step that locks cells: inside one transaction it inserts a roster_team_pending_cell
 * row per line (PRIMARY KEY (employee_id, roster_date)); a duplicate key means another submission
 * already holds the cell and the whole submit is refused with the conflicting cells listed. Nothing
 * here writes wfm_roster_assignment - that happens only at WFM approval (team-roster-apply.ts).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  evaluateGuards, loadEmployeeGuardInfo, type GuardLine,
} from "./team-roster-guards.js";
import { loadCurrentCells, upsertDraftLines } from "./team-roster-draft.js";
import { loadShiftOptions, shiftProblem } from "./team-roster-shifts.js";
import { INBOX_TYPE_APPROVAL, closeApprovalItems, notifyUsers, recordAudit, userIdOfEmployee, wfmRecipientUserIds } from "./team-roster-audit.js";
import { requireCaller, requireTeam } from "./team-roster.service.js";
import type { CallerEmployee } from "./team-roster-tree.js";
import { isDuplicateKey, withTransaction } from "./team-roster-tx.js";
import {
  MAX_LINES_PER_SUBMISSION, MAX_NOTE_LENGTH, MAX_RANGE_DAYS, MIN_REASON_LENGTH, PENDING_STATUSES, SUBMISSION_STATUS, TeamRosterError,
  cellKey, formatDmy, isValidYmd, placeholders, rowsOf, spanDays, todayIst,
  type Actor, type LineKind, type NewAssignmentType, type OldCellSnapshot, type SqlExecutor,
} from "./team-roster-types.js";

export interface SubmitLine {
  id: number;
  employeeId: string;
  date: string;
  kind: LineKind;
  old: OldCellSnapshot;
  newType: NewAssignmentType;
  templateId: string | null;
  /** The shift as stored times ('HH:MM'); the source of truth for apply. */
  newStart: string | null;
  newEnd: string | null;
  newShiftId: string | null;
  reason: string | null;
}

const NAME_EXPR = `COALESCE(NULLIF(e.full_name, ''), TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))))`;

function toSubmitLine(r: RowDataPacket): SubmitLine {
  return {
    id: Number(r.id), employeeId: String(r.employee_id), date: String(r.d), kind: String(r.kind) as LineKind,
    old: {
      assignmentId: r.old_assignment_id ? String(r.old_assignment_id) : null,
      assignmentType: r.old_assignment_type ? String(r.old_assignment_type) : null,
      isWeekOff: Number(r.old_is_week_off) === 1,
      shiftTemplateId: r.old_shift_template_id ? String(r.old_shift_template_id) : null,
      shiftStartTime: r.old_shift_start_time ? String(r.old_shift_start_time) : null,
      shiftEndTime: r.old_shift_end_time ? String(r.old_shift_end_time) : null,
    },
    newType: String(r.new_assignment_type) as NewAssignmentType,
    templateId: r.new_shift_template_id ? String(r.new_shift_template_id) : null,
    newStart: r.new_shift_start_time ? String(r.new_shift_start_time).slice(0, 5) : null,
    newEnd: r.new_shift_end_time ? String(r.new_shift_end_time).slice(0, 5) : null,
    newShiftId: r.new_shift_id ? String(r.new_shift_id) : null,
    reason: r.reason ? String(r.reason) : null,
  };
}

export async function loadSubmissionLines(submissionId: number, exec: SqlExecutor = db): Promise<SubmitLine[]> {
  return rowsOf<RowDataPacket>(await exec.execute(
    `SELECT id, employee_id, DATE_FORMAT(roster_date, '%Y-%m-%d') AS d, kind, old_assignment_id, old_assignment_type,
            old_is_week_off, old_shift_template_id, old_shift_start_time, old_shift_end_time,
            new_assignment_type, new_shift_template_id, new_shift_start_time, new_shift_end_time, new_shift_id, reason
       FROM roster_team_submission_line WHERE submission_id = ? ORDER BY roster_date, employee_id`,
    [submissionId],
  )).map(toSubmitLine);
}

/** The reporting manager who must approve first; null (step skipped) when there is no usable one. */
export async function resolveManagerApprover(caller: CallerEmployee, exec: SqlExecutor = db): Promise<{ employeeId: string; userId: string | null } | null> {
  if (!caller.reportingManagerId || caller.reportingManagerId === caller.id) return null;
  const row = rowsOf<RowDataPacket>(await exec.execute(
    `SELECT id, user_id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1`, [caller.reportingManagerId],
  ))[0];
  return row ? { employeeId: String(row.id), userId: row.user_id ? String(row.user_id) : null } : null;
}

export interface SubmitProblem { employeeId: string; date: string; message: string }

/** Everything Submit checks before locking: returns problems (empty = submittable) and the guard verdicts. */
export async function validateLinesForSubmit(lines: SubmitLine[], teamIds: string[], exec: SqlExecutor = db) {
  const problems: SubmitProblem[] = [];
  const bad = (l: SubmitLine, message: string) => problems.push({ employeeId: l.employeeId, date: l.date, message });
  if (!lines.length) throw new TeamRosterError(400, "Your draft has no changes to submit.", "EMPTY_DRAFT");
  if (lines.length > MAX_LINES_PER_SUBMISSION) throw new TeamRosterError(400, `A submission can hold at most ${MAX_LINES_PER_SUBMISSION} cells.`, "TOO_MANY_LINES");
  const dates = lines.map((l) => l.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  if (!isValidYmd(from) || !isValidYmd(to)) throw new TeamRosterError(400, "Invalid date in draft.", "BAD_DATE");
  if (spanDays(from, to) > MAX_RANGE_DAYS) throw new TeamRosterError(400, `One submission can span at most ${MAX_RANGE_DAYS} days.`, "RANGE_TOO_LONG");

  const team = new Set(teamIds);
  const today = todayIst();
  const ids = [...new Set(lines.map((l) => l.employeeId))];
  const info = await loadEmployeeGuardInfo(ids, exec);
  const processIds = [...new Set([...info.values()].map((i) => i.processId).filter((p): p is string => !!p))];
  const shiftOptions = lines.some((l) => l.newType === "SHIFT") ? await loadShiftOptions(processIds, today, exec) : new Map();
  const current = await loadCurrentCells(ids, from, to, exec);

  for (const l of lines) {
    if (l.date < today) { bad(l, "Past dates cannot be changed."); continue; }
    if (!team.has(l.employeeId)) { bad(l, "Employee is not in your reporting team."); continue; }
    if (l.newType === "SHIFT") {
      // Recomputed server-side from the employee's process: stored times are never trusted on their own.
      const tp = shiftProblem({ shiftStart: l.newStart, shiftEnd: l.newEnd }, shiftOptions.get(info.get(l.employeeId)?.processId ?? "") ?? [], l.date);
      if (tp) { bad(l, tp); continue; }
    }
    const now = current.get(cellKey(l.employeeId, l.date)) ?? null;
    if (l.kind === "FILL_BLANK" && now) { bad(l, "This date has since been rostered; remove it or propose a change instead."); continue; }
    if (l.kind === "CHANGE") {
      if (String(l.reason ?? "").trim().length < MIN_REASON_LENGTH) { bad(l, `A reason of at least ${MIN_REASON_LENGTH} characters is required to change a rostered date.`); continue; }
      if (!now || now.assignmentId !== l.old.assignmentId || now.assignmentType !== l.old.assignmentType || now.isWeekOff !== l.old.isWeekOff ||
          now.shiftTemplateId !== l.old.shiftTemplateId || now.shiftStartTime !== l.old.shiftStartTime || now.shiftEndTime !== l.old.shiftEndTime) {
        bad(l, "This date changed since you proposed the change; refresh and propose it again.");
      }
    }
  }
  const guardLines: GuardLine[] = lines.map((l) => ({ employeeId: l.employeeId, date: l.date, newType: l.newType, shiftStart: l.newStart, shiftEnd: l.newEnd, oldAssignmentId: l.old.assignmentId }));
  const verdicts = await evaluateGuards(guardLines, exec);
  for (const l of lines) {
    const block = verdicts.get(cellKey(l.employeeId, l.date))?.block;
    if (block) bad(l, block);
  }
  return { problems, verdicts, from, to, info };
}

async function pendingConflicts(cells: Array<{ employeeId: string; date: string }>, exec: SqlExecutor) {
  const ids = [...new Set(cells.map((c) => c.employeeId))];
  const wanted = new Set(cells.map((c) => cellKey(c.employeeId, c.date)));
  const out: Array<{ employeeId: string; employeeName: string; date: string; message: string }> = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = rowsOf<RowDataPacket>(await exec.execute(
      `SELECT p.employee_id, DATE_FORMAT(p.roster_date, '%Y-%m-%d') AS d, s.submission_no, ${NAME_EXPR} AS submitter_name, en.full_name AS employee_name
         FROM roster_team_pending_cell p
         JOIN roster_team_submission s ON s.id = p.submission_id
         LEFT JOIN employees e ON e.id = s.submitter_employee_id
         LEFT JOIN employees en ON en.id = p.employee_id
        WHERE p.employee_id IN (${placeholders(chunk.length)})`, chunk,
    ));
    for (const r of rows) {
      if (!wanted.has(cellKey(String(r.employee_id), String(r.d)))) continue;
      out.push({
        employeeId: String(r.employee_id), employeeName: String(r.employee_name ?? ""), date: String(r.d),
        message: `${formatDmy(String(r.d))} is pending with ${r.submitter_name || "another manager"}${r.submission_no ? ` (${r.submission_no})` : ""}`,
      });
    }
  }
  return out;
}

async function insertPendingCells(conn: SqlExecutor, submissionId: number, lines: SubmitLine[]) {
  for (let i = 0; i < lines.length; i += 500) {
    const chunk = lines.slice(i, i + 500);
    await conn.execute(
      `INSERT INTO roster_team_pending_cell (employee_id, roster_date, submission_id) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")}`,
      chunk.flatMap((l) => [l.employeeId, l.date, submissionId]),
    );
  }
}

export async function submitDraft(actor: Actor, input: { note?: string | null } = {}) {
  const { caller, teamIds } = await requireTeam(actor);
  const head = rowsOf<RowDataPacket>(await db.execute(
    `SELECT id FROM roster_team_submission WHERE draft_owner_key = ? AND status = 'draft' LIMIT 1`, [caller.id],
  ))[0];
  if (!head) throw new TeamRosterError(404, "You have no draft to submit.", "NO_DRAFT");
  const submissionId = Number(head.id);
  const lines = await loadSubmissionLines(submissionId);
  const { problems, verdicts, from, to, info } = await validateLinesForSubmit(lines, teamIds);
  if (problems.length) throw new TeamRosterError(422, "Some cells cannot be submitted.", "SUBMIT_VALIDATION", problems);

  const approver = await resolveManagerApprover(caller);
  const status = approver ? SUBMISSION_STATUS.PENDING_MANAGER : SUBMISSION_STATUS.PENDING_WFM;
  const year = todayIst().slice(0, 4);
  const submissionNo = `RTS-${year}-${String(submissionId).padStart(6, "0")}`;
  const note = input.note ? String(input.note).trim().slice(0, MAX_NOTE_LENGTH) : null;

  try {
    await withTransaction(async (conn) => {
      const locked = rowsOf<RowDataPacket>(await conn.execute(
        `SELECT status FROM roster_team_submission WHERE id = ? FOR UPDATE`, [submissionId],
      ))[0];
      if (!locked || locked.status !== SUBMISSION_STATUS.DRAFT) throw new TeamRosterError(409, "This draft was already submitted.", "NOT_A_DRAFT");
      await insertPendingCells(conn, submissionId, lines);
      for (const l of lines) {
        const w = verdicts.get(cellKey(l.employeeId, l.date))?.warnings ?? [];
        await conn.execute(`UPDATE roster_team_submission_line SET warnings_json = ? WHERE id = ?`, [w.length ? JSON.stringify(w) : null, l.id]);
      }
      await conn.execute(
        `UPDATE roster_team_submission
            SET status = ?, draft_owner_key = NULL, submission_no = ?, from_date = ?, to_date = ?, submitted_at = NOW(),
                manager_approver_employee_id = ?, note = COALESCE(?, note)
          WHERE id = ?`,
        [status, submissionNo, from, to, approver?.employeeId ?? null, note, submissionId],
      );
      await recordAudit(conn, submissionId, "submitted", actor, note, {
        lines: lines.length, from, to, managerStepSkipped: !approver, nextStatus: status,
      });
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      const conflicts = await pendingConflicts(lines.map((l) => ({ employeeId: l.employeeId, date: l.date })), db);
      throw new TeamRosterError(409, "Some cells are already pending in another submission.", "CELL_PENDING", conflicts);
    }
    throw err;
  }

  const link = `/wfm/team-roster?tab=approvals&submission=${submissionId}`;
  const title = `Team roster ${submissionNo} awaiting your approval`;
  const description = `${caller.name} proposed ${lines.length} roster change(s) for ${formatDmy(from)} - ${formatDmy(to)}.`;
  if (approver) {
    await notifyUsers([approver.userId], { type: INBOX_TYPE_APPROVAL, title, description, submissionId, actionUrl: link });
  } else {
    const branches = [...new Set([...info.values()].map((i) => i.branchId).filter((b): b is string => !!b))];
    const processes = [...new Set([...info.values()].map((i) => i.processId).filter((p): p is string => !!p))];
    await notifyUsers(await wfmRecipientUserIds(branches, processes), { type: INBOX_TYPE_APPROVAL, title, description, submissionId, actionUrl: link });
  }
  return { submissionId, submissionNo, status, managerStepSkipped: !approver, lineCount: lines.length };
}

export async function cancelSubmission(actor: Actor, submissionId: number) {
  const caller = await requireCaller(actor);
  await withTransaction(async (conn) => {
    const s = rowsOf<RowDataPacket>(await conn.execute(
      `SELECT id, status, submitter_employee_id FROM roster_team_submission WHERE id = ? FOR UPDATE`, [submissionId],
    ))[0];
    if (!s) throw new TeamRosterError(404, "Submission not found.", "NOT_FOUND");
    if (String(s.submitter_employee_id) !== caller.id) throw new TeamRosterError(403, "Only the submitter can cancel a submission.", "NOT_SUBMITTER");
    if (!(PENDING_STATUSES as readonly string[]).includes(String(s.status))) {
      throw new TeamRosterError(409, "Only a submission that is still pending can be cancelled.", "NOT_PENDING");
    }
    await conn.execute(`UPDATE roster_team_submission SET status = 'cancelled' WHERE id = ?`, [submissionId]);
    await conn.execute(`DELETE FROM roster_team_pending_cell WHERE submission_id = ?`, [submissionId]);
    await recordAudit(conn, submissionId, "cancelled", actor, null, { from: s.status });
  });
  await closeApprovalItems(submissionId);
  return { submissionId, status: SUBMISSION_STATUS.CANCELLED };
}

/** Copies a rejected/cancelled submission of mine back into my draft, re-snapshotting each cell. */
export async function copySubmissionToDraft(actor: Actor, submissionId: number) {
  const caller = await requireCaller(actor);
  const s = rowsOf<RowDataPacket>(await db.execute(
    `SELECT id, status, submitter_employee_id FROM roster_team_submission WHERE id = ? LIMIT 1`, [submissionId],
  ))[0];
  if (!s) throw new TeamRosterError(404, "Submission not found.", "NOT_FOUND");
  if (String(s.submitter_employee_id) !== caller.id) throw new TeamRosterError(403, "You can only copy your own submissions.", "NOT_SUBMITTER");
  if (![SUBMISSION_STATUS.REJECTED, SUBMISSION_STATUS.CANCELLED, SUBMISSION_STATUS.PARTIALLY_APPLIED].includes(String(s.status) as never)) {
    throw new TeamRosterError(409, "Only a rejected, cancelled or partially applied submission can be copied back.", "NOT_COPYABLE");
  }
  const lines = await loadSubmissionLines(submissionId);
  const result = await upsertDraftLines(actor, {
    upserts: lines.map((l) => ({ employeeId: l.employeeId, date: l.date, type: l.newType, shiftStart: l.newStart, shiftEnd: l.newEnd, shiftTemplateId: l.templateId, shiftMasterId: l.newShiftId, reason: l.reason })),
  }, { lenient: true });
  await recordAudit(db, submissionId, "copied_to_draft", actor, null, { draftId: result.draftId, copied: result.lineCount, skipped: result.skipped.length });
  return { draftId: result.draftId, copied: result.lineCount, skipped: result.skipped };
}
