/**
 * Team Roster - the manager's server-side draft. One open draft per submitter (roster_team_submission
 * .draft_owner_key is UNIQUE), lines upserted as they edit so they can resume. A draft does NOT lock
 * cells; only Submit does (team-roster-submit.ts).
 *
 * Each line snapshots the cell it targets at edit time: no stored row -> FILL_BLANK; a stored row ->
 * CHANGE with the row's identity/type/template/times. Submit and apply re-check the snapshot, so a
 * cell that moved underneath the manager is refused instead of silently overwritten.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { loadTemplatesByIds, templateProblem } from "./team-roster-guards.js";
import { requireTeam } from "./team-roster.service.js";
import { isDuplicateKey, withTransaction } from "./team-roster-tx.js";
import {
  MAX_LINES_PER_SUBMISSION, MAX_NOTE_LENGTH, MAX_RANGE_DAYS, MAX_REASON_LENGTH, NEW_ASSIGNMENT_TYPES, TeamRosterError,
  cellKey, isValidYmd, placeholders, rowsOf, snapshotOf, spanDays, todayIst,
  type Actor, type LineKind, type NewAssignmentType, type OldCellSnapshot, type SqlExecutor,
} from "./team-roster-types.js";

export interface LineInput {
  employeeId: string;
  date: string;
  type: NewAssignmentType;
  shiftTemplateId?: string | null;
  reason?: string | null;
}
export interface CellRef { employeeId: string; date: string }
export interface LineProblem { employeeId: string; date: string; message: string }

export const MAX_UPSERTS_PER_CALL = 2000;

/** Current stored rows for these employees in the window, keyed by employee|date. */
export async function loadCurrentCells(
  employeeIds: string[], from: string, to: string, exec: SqlExecutor = db,
): Promise<Map<string, OldCellSnapshot>> {
  const map = new Map<string, OldCellSnapshot>();
  const unique = [...new Set(employeeIds)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const result = await exec.execute(
      `SELECT id, employee_id, DATE_FORMAT(roster_date, '%Y-%m-%d') AS d, assignment_type, is_week_off,
              shift_template_id, shift_start_time, shift_end_time
         FROM wfm_roster_assignment WHERE employee_id IN (${placeholders(chunk.length)}) AND roster_date BETWEEN ? AND ?`,
      [...chunk, from, to],
    );
    for (const r of rowsOf<RowDataPacket>(result)) map.set(cellKey(String(r.employee_id), String(r.d)), snapshotOf(r));
  }
  return map;
}

/** True when the proposed value is the value already stored (nothing to change). */
function sameAsStored(old: OldCellSnapshot, type: NewAssignmentType, templateId: string | null, tplTimes: { start: string | null; end: string | null }): boolean {
  if (old.assignmentType !== type) return false;
  if (type !== "SHIFT") return true;
  if (old.shiftTemplateId && templateId) return old.shiftTemplateId === templateId;
  return old.shiftStartTime === (tplTimes.start?.slice(0, 5) ?? null) && old.shiftEndTime === (tplTimes.end?.slice(0, 5) ?? null);
}

async function getOrCreateDraftId(conn: SqlExecutor, caller: { id: string }, userId: string): Promise<number> {
  const find = async () => rowsOf<RowDataPacket>(await conn.execute(
    `SELECT id FROM roster_team_submission WHERE draft_owner_key = ? AND status = 'draft' LIMIT 1 FOR UPDATE`, [caller.id],
  ))[0];
  const existing = await find();
  if (existing) return Number(existing.id);
  try {
    const res = await conn.execute(
      `INSERT INTO roster_team_submission (submitter_employee_id, submitter_user_id, status, draft_owner_key)
       VALUES (?, ?, 'draft', ?)`, [caller.id, userId, caller.id],
    );
    return Number((res[0] as { insertId: number }).insertId);
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const raced = await find();
    if (!raced) throw err;
    return Number(raced.id);
  }
}

/**
 * `lenient` (used when copying a rejected submission back into a draft) skips the cells that no longer
 * validate instead of refusing the whole call, and reports them in `skipped`.
 */
export async function upsertDraftLines(
  actor: Actor,
  input: { upserts?: LineInput[]; deletes?: CellRef[] },
  opts: { lenient?: boolean } = {},
) {
  const { caller, teamIds } = await requireTeam(actor);
  const upserts = input.upserts ?? [];
  const deletes = input.deletes ?? [];
  if (upserts.length > MAX_UPSERTS_PER_CALL) {
    throw new TeamRosterError(400, `At most ${MAX_UPSERTS_PER_CALL} cells can be saved per call.`, "TOO_MANY_LINES");
  }
  const team = new Set(teamIds);
  const today = todayIst();
  const problems: LineProblem[] = [];
  const bad = (l: { employeeId: string; date: string }, message: string) => problems.push({ employeeId: l.employeeId, date: l.date, message });

  const shapeOk = upserts.filter((l) => {
    if (!isValidYmd(l.date)) return bad(l, "Invalid date."), false;
    if (l.date < today) return bad(l, "Past dates cannot be changed."), false;
    if (!team.has(l.employeeId)) return bad(l, "Employee is not in your reporting team."), false;
    if (!(NEW_ASSIGNMENT_TYPES as readonly string[]).includes(l.type)) return bad(l, "Choose Shift, Week off, Training or Unscheduled."), false;
    if (l.type === "SHIFT" && !l.shiftTemplateId) return bad(l, "Pick a shift."), false;
    if (String(l.reason ?? "").length > MAX_REASON_LENGTH) return bad(l, `Reason is limited to ${MAX_REASON_LENGTH} characters.`), false;
    return true;
  });

  const empIds = [...new Set(shapeOk.map((l) => l.employeeId))];
  const dates = shapeOk.map((l) => l.date).sort();
  const processOf = new Map<string, string | null>();
  if (empIds.length) {
    const emp = rowsOf<RowDataPacket>(await db.execute(`SELECT id, process_id FROM employees WHERE id IN (${placeholders(empIds.length)})`, empIds));
    emp.forEach((r) => processOf.set(String(r.id), r.process_id ? String(r.process_id) : null));
  }
  const templates = await loadTemplatesByIds(shapeOk.map((l) => l.shiftTemplateId ?? "").filter(Boolean));
  const current = empIds.length ? await loadCurrentCells(empIds, dates[0], dates[dates.length - 1]) : new Map();

  const prepared = shapeOk.flatMap((l) => {
    const tplId = l.type === "SHIFT" ? l.shiftTemplateId ?? null : null;
    const tpl = tplId ? templates.get(tplId) : undefined;
    if (l.type === "SHIFT") {
      const problem = templateProblem(tpl, processOf.get(l.employeeId) ?? null, l.date);
      if (problem) return bad(l, problem), [];
    }
    const old = current.get(cellKey(l.employeeId, l.date)) ?? null;
    if (old && sameAsStored(old, l.type, tplId, { start: tpl?.start ?? null, end: tpl?.end ?? null })) {
      return bad(l, "This is already what the roster says; nothing to change."), [];
    }
    return [{ ...l, tplId, kind: (old ? "CHANGE" : "FILL_BLANK") as LineKind, old }];
  });
  if (problems.length && !opts.lenient) throw new TeamRosterError(422, "Some cells could not be saved.", "LINE_VALIDATION", problems);

  return withTransaction(async (conn) => {
    const draftId = await getOrCreateDraftId(conn, caller, actor.id);
    for (const d of deletes) {
      await conn.execute(`DELETE FROM roster_team_submission_line WHERE submission_id = ? AND employee_id = ? AND roster_date = ?`, [draftId, d.employeeId, d.date]);
    }
    for (const l of prepared) {
      const o = l.old;
      await conn.execute(
        `INSERT INTO roster_team_submission_line
           (submission_id, employee_id, roster_date, kind, old_assignment_id, old_assignment_type, old_is_week_off,
            old_shift_template_id, old_shift_start_time, old_shift_end_time, new_assignment_type, new_shift_template_id,
            reason, warnings_json, line_status, skip_reason, applied_assignment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, NULL)
         ON DUPLICATE KEY UPDATE kind = VALUES(kind), old_assignment_id = VALUES(old_assignment_id),
           old_assignment_type = VALUES(old_assignment_type), old_is_week_off = VALUES(old_is_week_off),
           old_shift_template_id = VALUES(old_shift_template_id), old_shift_start_time = VALUES(old_shift_start_time),
           old_shift_end_time = VALUES(old_shift_end_time), new_assignment_type = VALUES(new_assignment_type),
           new_shift_template_id = VALUES(new_shift_template_id), reason = VALUES(reason), warnings_json = NULL`,
        [draftId, l.employeeId, l.date, l.kind, o?.assignmentId ?? null, o?.assignmentType ?? null, o ? (o.isWeekOff ? 1 : 0) : null,
          o?.shiftTemplateId ?? null, o?.shiftStartTime ?? null, o?.shiftEndTime ?? null, l.type, l.tplId,
          l.reason ? String(l.reason).trim() : null],
      );
    }
    const span = rowsOf<RowDataPacket>(await conn.execute(
      `SELECT COUNT(*) AS c, DATE_FORMAT(MIN(roster_date), '%Y-%m-%d') AS f, DATE_FORMAT(MAX(roster_date), '%Y-%m-%d') AS t
         FROM roster_team_submission_line WHERE submission_id = ?`, [draftId],
    ))[0];
    const count = Number(span?.c ?? 0);
    if (count > MAX_LINES_PER_SUBMISSION) {
      throw new TeamRosterError(400, `A submission can hold at most ${MAX_LINES_PER_SUBMISSION} cells.`, "TOO_MANY_LINES");
    }
    if (count > 0 && spanDays(String(span.f), String(span.t)) > MAX_RANGE_DAYS) {
      throw new TeamRosterError(400, `One submission can span at most ${MAX_RANGE_DAYS} days; submit this range first, then start another.`, "RANGE_TOO_LONG");
    }
    return { draftId, lineCount: count, from: count ? String(span.f) : null, to: count ? String(span.t) : null, skipped: problems };
  });
}

export async function setDraftNote(actor: Actor, note: string | null) {
  const { caller } = await requireTeam(actor);
  await db.execute(
    `UPDATE roster_team_submission SET note = ? WHERE draft_owner_key = ? AND status = 'draft'`,
    [note ? note.trim().slice(0, MAX_NOTE_LENGTH) : null, caller.id],
  );
}

export async function getMyDraft(actor: Actor) {
  const { caller } = await requireTeam(actor);
  const head = rowsOf<RowDataPacket>(await db.execute(
    `SELECT id, note, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at FROM roster_team_submission
      WHERE draft_owner_key = ? AND status = 'draft' LIMIT 1`, [caller.id],
  ))[0];
  if (!head) return { draft: null };
  const lines = rowsOf<RowDataPacket>(await db.execute(
    `SELECT l.employee_id, DATE_FORMAT(l.roster_date, '%Y-%m-%d') AS d, l.kind, l.new_assignment_type, l.new_shift_template_id, l.reason
       FROM roster_team_submission_line l WHERE l.submission_id = ? ORDER BY l.roster_date, l.employee_id`, [head.id],
  ));
  return {
    draft: {
      id: Number(head.id), note: head.note ? String(head.note) : null, createdAt: String(head.created_at),
      lines: lines.map((l) => ({
        employeeId: String(l.employee_id), date: String(l.d), kind: String(l.kind), type: String(l.new_assignment_type),
        shiftTemplateId: l.new_shift_template_id ? String(l.new_shift_template_id) : null, reason: l.reason ? String(l.reason) : null,
      })),
    },
  };
}

export async function discardDraft(actor: Actor) {
  const { caller } = await requireTeam(actor);
  return withTransaction(async (conn) => {
    const head = rowsOf<RowDataPacket>(await conn.execute(
      `SELECT id FROM roster_team_submission WHERE draft_owner_key = ? AND status = 'draft' LIMIT 1 FOR UPDATE`, [caller.id],
    ))[0];
    if (!head) return { discarded: false };
    await conn.execute(`DELETE FROM roster_team_submission_line WHERE submission_id = ?`, [head.id]);
    await conn.execute(`DELETE FROM roster_team_submission WHERE id = ? AND status = 'draft'`, [head.id]);
    return { discarded: true };
  });
}

