import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = await vi.hoisted(async () => (await import("./__fixtures__/team-roster-fake-db.js")).createFakeDb());
const mocks = vi.hoisted(() => ({
  restActive: { value: false },
  validateRest: vi.fn(),
  applyRest: vi.fn(),
  stamp: vi.fn(),
  changeLog: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: fake }));
vi.mock("../rest-policy.service.js", () => ({
  isRestPolicyFeatureActive: vi.fn(async () => mocks.restActive.value),
  validateMinimumRest: mocks.validateRest,
  applyRestDecision: mocks.applyRest,
  withEmployeeRosterLock: vi.fn(async (_id: string, fn: any) => fn(fake.conn)),
}));
vi.mock("../roster-offday-apply.js", async (orig) => ({ ...(await orig<any>()), stampRows: mocks.stamp }));
vi.mock("../shift-scheduling.util.js", async (orig) => ({
  ...(await orig<any>()),
  rosterAssignmentColumns: vi.fn(async () => new Set(["scheduled_minutes", "process_id", "lob_id"])),
}));
vi.mock("../../roster/roster-change-log.js", () => ({ logRosterChange: mocks.changeLog }));
vi.mock("../../../shared/auditLog.js", () => ({ writeAuditLog: mocks.audit }));

import { applySubmission } from "../team-roster-apply.js";
import { rows, header } from "./__fixtures__/team-roster-fake-db.js";
import { installBase, istDate, lineRow } from "./__fixtures__/team-roster-scenario.js";

const actor = { id: "wfm-user", role: "wfm", roles: ["wfm"] };
const d1 = istDate(3);
const fill = (id: number, employee: string, type: string, over: Record<string, unknown> = {}) =>
  lineRow({ id, employee_id: employee, d: d1, kind: "FILL_BLANK", new_assignment_type: type, new_shift_template_id: type === "SHIFT" ? "t1" : null, ...over } as any);
const change = (id: number, employee: string, type: string, over: Record<string, unknown> = {}) =>
  lineRow({
    id, employee_id: employee, d: d1, kind: "CHANGE", old_assignment_id: "a1", old_assignment_type: "SHIFT", old_is_week_off: 0,
    old_shift_template_id: "t1", old_shift_start_time: "09:00", old_shift_end_time: "18:00", new_assignment_type: type,
    new_shift_template_id: type === "SHIFT" ? "t1" : null, reason: "Customer asked for cover", ...over,
  } as any);
const storedRow = (over: Record<string, unknown> = {}) => ({
  id: "a1", cycle_id: "c1", assignment_type: "SHIFT", is_week_off: 0, shift_template_id: "t1", shift_start_time: "09:00:00", shift_end_time: "18:00:00", ...over,
});
const lineMarks = () => fake.statements(/UPDATE roster_team_submission_line SET line_status/).map((s) => ({ status: s.params[0], reason: s.params[1], assignment: s.params[2], id: s.params[3] }));
const inserts = () => fake.statements(/INSERT INTO wfm_roster_assignment/);
const updates = () => fake.statements(/^UPDATE wfm_roster_assignment\s+SET assignment_type/);

function setup(lines: ReturnType<typeof lineRow>[], current: Record<string, unknown> | null = null) {
  installBase(fake, { lines });
  fake.on(/SELECT line_status FROM roster_team_submission_line WHERE id = \?/, () => rows([{ line_status: "pending" }]));
  fake.on(/SELECT id, reporting_manager_id, manager_id FROM employees WHERE id IN/, (_s, p) => rows(p.map((id: string) => ({ id, reporting_manager_id: "boss", manager_id: null }))));
  fake.on(/SELECT is_locked FROM attendance_daily_record/, () => rows([]));
  fake.on(/FROM wfm_roster_assignment WHERE employee_id = \? AND roster_date = \? LIMIT 1 FOR UPDATE/, () => rows(current ? [current] : []));
  fake.on(/INSERT INTO wfm_roster_assignment/, () => header());
  fake.on(/^UPDATE wfm_roster_assignment/, () => header());
  fake.on(/UPDATE roster_team_submission_line SET line_status/, () => header());
}

beforeEach(() => {
  fake.reset();
  mocks.restActive.value = false;
  Object.values(mocks).forEach((m: any) => typeof m?.mockReset === "function" && m.mockReset());
  mocks.stamp.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
  mocks.changeLog.mockResolvedValue(undefined);
});

describe("applySubmission - what is written", () => {
  it("FILL_BLANK SHIFT inserts a row shaped like an imported one, then enters the acknowledgement pipeline", async () => {
    setup([fill(1, "e1", "SHIFT")]);
    const result = await applySubmission(7, actor);
    expect(result).toMatchObject({ applied: 1, skipped: 0, failed: 0, total: 1, appliedEmployeeIds: ["e1"] });
    const ins = inserts()[0];
    expect(ins.sql).toMatch(/lifecycle_state, manager_employee_id/);
    expect(ins.sql).toMatch(/'DRAFT'/);
    // id, employee, date, type, is_week_off, start, end, template, scheduled_minutes, manager
    expect(ins.params.slice(1)).toEqual(["e1", d1, "SHIFT", 0, "09:00:00", "18:00:00", "t1", 540, "boss"]);
    expect(fake.statements(/final_roster_status = 'pending_employee_ack'.*final_roster_status = 'generated'/)).toHaveLength(1);
    expect(mocks.stamp).toHaveBeenCalledWith("wra.id = ?", [ins.params[0]], null, fake.conn);
    expect(lineMarks()).toEqual([{ status: "applied", reason: null, assignment: ins.params[0], id: 1 }]);
    expect(fake.conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(fake.conn.commit).toHaveBeenCalledTimes(1);
    expect(fake.statements(/INSERT INTO work_inbox_item[\s\S]*ROSTER_ACK_PENDING/)).toHaveLength(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action_type: "TEAM_ROSTER_LINE_APPLIED", entity_id: ins.params[0] }));
  });

  it("WEEK_OFF sets BOTH is_week_off and assignment_type, with no times or template", async () => {
    setup([fill(1, "e1", "WEEK_OFF")]);
    await applySubmission(7, actor);
    expect(inserts()[0].params.slice(3)).toEqual(["WEEK_OFF", 1, null, null, null, null, "boss"]);
  });

  it("TRAINING and UNSCHEDULED are not week offs and carry no shift times", async () => {
    setup([fill(1, "e1", "TRAINING"), fill(2, "e2", "UNSCHEDULED")]);
    await applySubmission(7, actor);
    const written = inserts().map((i) => i.params.slice(1, 8));
    expect(written).toContainEqual(["e1", d1, "TRAINING", 0, null, null, null]);
    expect(written).toContainEqual(["e2", d1, "UNSCHEDULED", 0, null, null, null]);
  });

  it("CHANGE updates only the matching stored row, resets acknowledgement and logs the change", async () => {
    setup([change(1, "e1", "WEEK_OFF")], storedRow());
    const result = await applySubmission(7, actor);
    expect(result.applied).toBe(1);
    expect(inserts()).toHaveLength(0);
    const upd = updates()[0];
    expect(upd.params).toEqual(["WEEK_OFF", 1, null, null, null, null, "boss", "a1"]);
    expect(fake.statements(/UPDATE wfm_roster_assignment SET final_roster_status = 'pending_employee_ack'/)[0].params).toEqual(["a1"]);
    expect(mocks.changeLog).toHaveBeenCalledWith(fake.conn, expect.objectContaining({
      entityId: "a1", cycleId: "c1", reason: "Customer asked for cover", changedBy: "wfm-user",
      oldValue: { shift_template_id: "t1", is_week_off: false }, newValue: { shift_template_id: null, is_week_off: true },
    }));
    expect(lineMarks()[0]).toMatchObject({ status: "applied", assignment: "a1" });
  });
});

describe("applySubmission - re-checks at apply time", () => {
  it("skips a stale CHANGE ('changed since proposed') and writes nothing", async () => {
    setup([change(1, "e1", "WEEK_OFF")], storedRow({ shift_template_id: "t-other" }));
    const result = await applySubmission(7, actor);
    expect(result).toMatchObject({ applied: 0, skipped: 1 });
    expect(updates()).toHaveLength(0);
    expect(lineMarks()[0]).toMatchObject({ status: "skipped", reason: "changed since proposed" });
  });

  it("skips a CHANGE whose row has vanished", async () => {
    setup([change(1, "e1", "WEEK_OFF")], null);
    await applySubmission(7, actor);
    expect(lineMarks()[0]).toMatchObject({ status: "skipped", reason: "changed since proposed" });
  });

  it("skips a FILL_BLANK whose date has since been rostered ('date already rostered')", async () => {
    setup([fill(1, "e1", "SHIFT")], storedRow());
    await applySubmission(7, actor);
    expect(inserts()).toHaveLength(0);
    expect(lineMarks()[0]).toMatchObject({ status: "skipped", reason: "date already rostered" });
  });

  it("treats a duplicate-key race on INSERT as 'date already rostered'", async () => {
    setup([fill(1, "e1", "SHIFT")]);
    fake.on(/INSERT INTO wfm_roster_assignment/, () => Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY", errno: 1062 }));
    await applySubmission(7, actor);
    expect(lineMarks()[0]).toMatchObject({ status: "skipped", reason: "date already rostered" });
    expect(fake.conn.commit).toHaveBeenCalled();
  });

  it("hard block: attendance locked for payroll", async () => {
    setup([fill(1, "e1", "SHIFT")]);
    fake.on(/SELECT is_locked FROM attendance_daily_record/, () => rows([{ is_locked: 1 }]));
    await applySubmission(7, actor);
    expect(inserts()).toHaveLength(0);
    expect(lineMarks()[0]).toMatchObject({ status: "skipped", reason: "attendance locked for payroll" });
  });

  it("hard block: approved full leave over a working shift, but a week off still applies", async () => {
    setup([fill(1, "e1", "SHIFT"), fill(2, "e2", "WEEK_OFF")]);
    fake.on(/FROM leave_request/, () => rows([
      { employee_id: "e1", from_date: d1, to_date: d1, total_days: 1 },
      { employee_id: "e2", from_date: d1, to_date: d1, total_days: 1 },
    ]));
    const result = await applySubmission(7, actor);
    expect(result).toMatchObject({ applied: 1, skipped: 1 });
    const marks = lineMarks();
    expect(marks.find((m) => m.id === 1)).toMatchObject({ status: "skipped", reason: "approved leave on this date" });
    expect(marks.find((m) => m.id === 2)?.status).toBe("applied");
  });

  it("hard block: minimum-rest BLOCK policy refuses the shift; a warn-mode result is allowed through", async () => {
    mocks.restActive.value = true;
    setup([fill(1, "e1", "SHIFT"), fill(2, "e2", "SHIFT")]);
    mocks.validateRest.mockResolvedValue({ ok: false, reason: "INSUFFICIENT_REST", actualRestMinutes: 300, requiredRestMinutes: 660, policy: { enforcementMode: "block" } });
    mocks.applyRest.mockImplementation(async (_r: any, ctx: any) => ({ allowed: ctx.employeeId === "e2", warned: ctx.employeeId === "e2" }));
    const result = await applySubmission(7, actor);
    expect(result).toMatchObject({ applied: 1, skipped: 1 });
    expect(lineMarks().find((m) => m.id === 1)).toMatchObject({ status: "skipped", reason: "Minimum rest not met (300 of 660 minutes)." });
    expect(lineMarks().find((m) => m.id === 2)?.status).toBe("applied");
  });

  it("a missing rest policy refuses the shift (REST_POLICY_MISSING), as roster import does", async () => {
    mocks.restActive.value = true;
    setup([fill(1, "e1", "SHIFT")]);
    mocks.validateRest.mockResolvedValue({ ok: false, reason: "REST_POLICY_MISSING", policy: null });
    mocks.applyRest.mockResolvedValue({ allowed: false, warned: false });
    await applySubmission(7, actor);
    expect(lineMarks()[0].reason).toMatch(/No minimum-rest policy/);
  });
});

describe("applySubmission - isolation and idempotence", () => {
  it("one employee's failure rolls back that employee only; the others still apply", async () => {
    setup([fill(1, "e1", "SHIFT"), fill(2, "e2", "SHIFT")]);
    fake.on(/INSERT INTO wfm_roster_assignment/, (_s, p) => (p[1] === "e1" ? new Error("deadlock") : header()));
    fake.on(/UPDATE roster_team_submission_line SET line_status = 'failed'/, () => header());
    const result = await applySubmission(7, actor);
    expect(result).toMatchObject({ applied: 1, failed: 1, skipped: 0, appliedEmployeeIds: ["e2"] });
    expect(fake.conn.rollback).toHaveBeenCalledTimes(1);
    const failed = fake.statements(/line_status = 'failed'/)[0];
    expect(failed.params).toEqual(["deadlock", 7, "e1"]);
    expect(mocks.audit).toHaveBeenCalledTimes(1); // nothing audited for the rolled-back employee
  });

  it("only lines still 'pending' are processed, so a resumed apply never duplicates", async () => {
    setup([fill(1, "e1", "SHIFT")]);
    fake.on(/SELECT line_status FROM roster_team_submission_line WHERE id = \?/, () => rows([{ line_status: "applied" }]));
    const result = await applySubmission(7, actor);
    expect(result.total).toBe(0);
    expect(inserts()).toHaveLength(0);
    expect(fake.conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("processes an employee's lines in date order inside one transaction", async () => {
    setup([fill(1, "e1", "WEEK_OFF", { d: istDate(3) }), fill(2, "e1", "WEEK_OFF", { d: istDate(4) })]);
    await applySubmission(7, actor);
    expect(fake.conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(fake.conn.commit).toHaveBeenCalledTimes(1);
    expect(inserts().map((i) => i.params[2])).toEqual([istDate(3), istDate(4)]);
  });
});
