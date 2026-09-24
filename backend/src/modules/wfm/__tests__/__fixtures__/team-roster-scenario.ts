import { rows, header, type FakeDb } from "./team-roster-fake-db.js";

const DAY = 86_400_000;
/** YYYY-MM-DD in IST, n days from today (matches todayIst() in the code under test). */
export function istDate(n = 0): string {
  return new Date(Date.now() + 330 * 60_000 + n * DAY).toISOString().slice(0, 10);
}

export const MANAGER = {
  id: "mgr", employee_code: "MAS100", full_name: "Meera Manager", first_name: "Meera", last_name: "Manager",
  branch_id: "b1", process_id: "p1", reporting_manager_id: "boss", manager_id: null, active_status: 1,
};

export const TEMPLATE = {
  id: "t1", shift_code: "GEN", shift_name: "General", process_id: "p1", start_time: "09:00:00", end_time: "18:00:00",
  night_shift: 0, active_status: 1, effective_from: null, effective_to: null,
};

export interface LineRow {
  id: number; employee_id: string; d: string; kind: "FILL_BLANK" | "CHANGE";
  old_assignment_id?: string | null; old_assignment_type?: string | null; old_is_week_off?: number | null;
  old_shift_template_id?: string | null; old_shift_start_time?: string | null; old_shift_end_time?: string | null;
  new_assignment_type: string; new_shift_template_id?: string | null; reason?: string | null;
}

export const lineRow = (l: LineRow) => ({
  old_assignment_id: null, old_assignment_type: null, old_is_week_off: null, old_shift_template_id: null,
  old_shift_start_time: null, old_shift_end_time: null, new_shift_template_id: null, new_shift_start_time: null,
  new_shift_end_time: null, new_shift_id: null, reason: null, ...l,
});

export interface Scenario {
  team?: string[];
  caller?: Record<string, unknown> | null;
  approver?: { id: string; user_id: string | null } | null;
  lines?: ReturnType<typeof lineRow>[];
  templates?: Array<Record<string, unknown>>;
  /** DISTINCT times in use for the process (wfm_roster_assignment), as the query returns them. */
  inUse?: Array<Record<string, unknown>>;
  masters?: Array<Record<string, unknown>>;
  assignments?: Array<Record<string, unknown>>;
  leave?: Array<Record<string, unknown>>;
  locked?: Array<Record<string, unknown>>;
}

/** Routes the read queries every Team Roster entry point issues. Later fake.on() calls override these. */
export function installBase(fake: FakeDb, s: Scenario = {}) {
  const team = s.team ?? ["e1", "e2"];
  fake.on(/FROM employees WHERE user_id = \?/, () => rows(s.caller === null ? [] : [s.caller ?? MANAGER]));
  fake.on(/reporting_manager_id IN/, (_sql, p) => rows(p.includes(((s.caller ?? MANAGER) as any).id) ? team.map((id) => ({ id })) : []));
  fake.on(/SELECT id, process_id, lob_id, branch_id FROM employees WHERE id IN/, (_sql, p) =>
    rows(p.map((id: string) => ({ id, process_id: "p1", lob_id: null, branch_id: "b1" }))));
  fake.on(/FROM process_master WHERE id IN/, (_sql, p) => rows(p.map((id: string) => ({ id, process_name: "Collections" }))));
  fake.on(/FROM wfm_shift_template\s+WHERE process_id IN/, () => rows(s.templates ?? [TEMPLATE]));
  fake.on(/FROM wfm_roster_assignment wra JOIN employees e/, () => rows(s.inUse ?? []));
  fake.on(/FROM wfm_shift_master/, () => rows(s.masters ?? []));
  fake.on(/FROM wfm_roster_assignment WHERE employee_id IN/, () => rows(s.assignments ?? []));
  fake.on(/FROM attendance_daily_record/, () => rows(s.locked ?? []));
  fake.on(/FROM leave_request/, () => rows(s.leave ?? []));
  fake.on(/SELECT id, user_id FROM employees WHERE id = \? AND active_status = 1/, () =>
    rows(s.approver === null ? [] : [s.approver ?? { id: "boss", user_id: "boss-user" }]));
  fake.on(/FROM roster_team_submission_line WHERE submission_id = \? ORDER BY/, () => rows(s.lines ?? []));
  fake.on(/INSERT INTO work_inbox_item/, () => header());
  fake.on(/FROM user_roles ur/, () => rows([{ user_id: "wfm-user" }]));
  fake.on(/INSERT INTO roster_team_submission_audit/, () => header());
}
