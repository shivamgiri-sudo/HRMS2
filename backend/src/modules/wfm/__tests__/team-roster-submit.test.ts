import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = await vi.hoisted(async () => (await import("./__fixtures__/team-roster-fake-db.js")).createFakeDb());
const mocks = vi.hoisted(() => ({ policies: [] as any[] }));

vi.mock("../../../db/mysql.js", () => ({ db: fake }));
vi.mock("../rest-policy.service.js", () => ({
  isRestPolicyFeatureActive: vi.fn(async () => false),
  validateMinimumRest: vi.fn(),
  applyRestDecision: vi.fn(),
  withEmployeeRosterLock: vi.fn(async (_id: string, fn: any) => fn(fake.conn)),
}));
vi.mock("../roster-offday-policy.loader.js", () => ({ loadActivePolicies: vi.fn(async () => mocks.policies) }));

import { cancelSubmission, submitDraft, validateLinesForSubmit, resolveManagerApprover } from "../team-roster-submit.js";
import { rows, header } from "./__fixtures__/team-roster-fake-db.js";
import { MANAGER, TEMPLATE, installBase, istDate, lineRow } from "./__fixtures__/team-roster-scenario.js";

const actor = { id: "mgr-user", role: "employee", roles: ["employee"] };
const future = istDate(3);
const shiftLine = (over: Record<string, unknown> = {}) => lineRow({
  id: 1, employee_id: "e1", d: future, kind: "FILL_BLANK", new_assignment_type: "SHIFT", new_shift_template_id: "t1", ...over,
} as any);
const toSubmitLine = (r: ReturnType<typeof lineRow>) => ({
  id: r.id, employeeId: r.employee_id, date: r.d, kind: r.kind,
  old: { assignmentId: r.old_assignment_id ?? null, assignmentType: r.old_assignment_type ?? null, isWeekOff: r.old_is_week_off === 1,
    shiftTemplateId: r.old_shift_template_id ?? null, shiftStartTime: r.old_shift_start_time ?? null, shiftEndTime: r.old_shift_end_time ?? null },
  newType: r.new_assignment_type as any, templateId: r.new_shift_template_id ?? null, reason: r.reason ?? null,
});
const existing = (over: Record<string, unknown> = {}) => ({
  id: "a1", employee_id: "e1", d: future, assignment_type: "SHIFT", is_week_off: 0, shift_template_id: "t1",
  shift_start_time: "09:00:00", shift_end_time: "18:00:00", ...over,
});
const messages = (problems: Array<{ message: string }>) => problems.map((p) => p.message).join(" | ");

beforeEach(() => {
  fake.reset();
  mocks.policies = [];
});

describe("validateLinesForSubmit", () => {
  it("accepts a valid blank fill and a valid change with a reason", async () => {
    installBase(fake, { assignments: [existing({ employee_id: "e2", d: istDate(4) })] });
    const fill = toSubmitLine(shiftLine());
    const change = toSubmitLine(lineRow({
      id: 2, employee_id: "e2", d: istDate(4), kind: "CHANGE", old_assignment_id: "a1", old_assignment_type: "SHIFT", old_is_week_off: 0,
      old_shift_template_id: "t1", old_shift_start_time: "09:00", old_shift_end_time: "18:00", new_assignment_type: "WEEK_OFF",
      reason: "Employee requested a day off",
    }));
    const { problems } = await validateLinesForSubmit([fill, change], ["e1", "e2"], fake);
    expect(problems).toEqual([]);
  });

  it("rejects past dates", async () => {
    installBase(fake);
    const { problems } = await validateLinesForSubmit([toSubmitLine(shiftLine({ d: istDate(-2) }))], ["e1"], fake);
    expect(messages(problems)).toMatch(/Past dates/);
  });

  it("rejects an employee outside the manager's tree", async () => {
    installBase(fake);
    const { problems } = await validateLinesForSubmit([toSubmitLine(shiftLine({ employee_id: "stranger" }))], ["e1", "e2"], fake);
    expect(messages(problems)).toMatch(/not in your reporting team/);
  });

  it("rejects a blank fill whose date has since been rostered", async () => {
    installBase(fake, { assignments: [existing()] });
    const { problems } = await validateLinesForSubmit([toSubmitLine(shiftLine())], ["e1"], fake);
    expect(messages(problems)).toMatch(/since been rostered/);
  });

  it("rejects a stale CHANGE (stored row no longer equals the snapshot)", async () => {
    installBase(fake, { assignments: [existing({ assignment_type: "WEEK_OFF", is_week_off: 1, shift_template_id: null })] });
    const stale = toSubmitLine(lineRow({
      id: 3, employee_id: "e1", d: future, kind: "CHANGE", old_assignment_id: "a1", old_assignment_type: "SHIFT", old_is_week_off: 0,
      old_shift_template_id: "t1", old_shift_start_time: "09:00", old_shift_end_time: "18:00", new_assignment_type: "TRAINING", reason: "Training session booked",
    }));
    const { problems } = await validateLinesForSubmit([stale], ["e1"], fake);
    expect(messages(problems)).toMatch(/changed since you proposed/);
  });

  it("requires a reason of at least 8 characters on a CHANGE", async () => {
    installBase(fake, { assignments: [existing()] });
    const change = toSubmitLine(lineRow({
      id: 4, employee_id: "e1", d: future, kind: "CHANGE", old_assignment_id: "a1", old_assignment_type: "SHIFT", old_is_week_off: 0,
      old_shift_template_id: "t1", old_shift_start_time: "09:00", old_shift_end_time: "18:00", new_assignment_type: "WEEK_OFF", reason: "short",
    }));
    const { problems } = await validateLinesForSubmit([change], ["e1"], fake);
    expect(messages(problems)).toMatch(/at least 8 characters/);
  });

  it("rejects a shift template that belongs to another process", async () => {
    installBase(fake, { templates: [{ ...TEMPLATE, process_id: "other-process" }] });
    const { problems } = await validateLinesForSubmit([toSubmitLine(shiftLine())], ["e1"], fake);
    expect(messages(problems)).toMatch(/does not belong to this employee's process/);
  });

  it("hard-blocks a working shift over approved full leave, but lets a week off through", async () => {
    installBase(fake, { leave: [{ employee_id: "e1", from_date: future, to_date: future, total_days: 1 }] });
    const shift = toSubmitLine(shiftLine());
    const weekOff = toSubmitLine(shiftLine({ id: 5, employee_id: "e1", d: istDate(4), new_assignment_type: "WEEK_OFF", new_shift_template_id: null }));
    fake.on(/FROM leave_request/, () => rows([{ employee_id: "e1", from_date: `${future}`, to_date: `${istDate(4)}`, total_days: 2 }]));
    const r = await validateLinesForSubmit([shift, weekOff], ["e1"], fake);
    expect(r.problems.filter((p) => p.date === future).map((p) => p.message).join()).toMatch(/approved leave/);
    expect(r.problems.filter((p) => p.date === istDate(4))).toEqual([]);
  });

  it("hard-blocks an attendance-locked date", async () => {
    installBase(fake, { locked: [{ employee_id: "e1", d: future }] });
    const { problems } = await validateLinesForSubmit([toSubmitLine(shiftLine())], ["e1"], fake);
    expect(messages(problems)).toMatch(/locked for payroll/);
  });

  it("attaches an off-day policy warning without blocking", async () => {
    installBase(fake);
    // Fixed weekly off on every weekday of the target date => a working shift on it is a warning.
    const weekday = new Date(`${future}T00:00:00Z`).getUTCDay();
    mocks.policies = [{ id: "pol", process_id: "p1", lob_id: null, branch_id: null, off_type: "FIXED_DAY", fixed_weekdays: [weekday],
      floating_offs_per_week: null, effective_from: "2020-01-01", effective_to: null }];
    const r = await validateLinesForSubmit([toSubmitLine(shiftLine())], ["e1"], fake);
    expect(r.problems).toEqual([]);
    expect(r.verdicts.get(`e1|${future}`)?.warnings.join()).toMatch(/Off-day policy/);
  });

  it("refuses an empty draft", async () => {
    installBase(fake);
    await expect(validateLinesForSubmit([], ["e1"], fake)).rejects.toMatchObject({ code: "EMPTY_DRAFT" });
  });

  it("refuses a range wider than 31 days", async () => {
    installBase(fake);
    const lines = [toSubmitLine(shiftLine()), toSubmitLine(shiftLine({ id: 9, d: istDate(60) }))];
    await expect(validateLinesForSubmit(lines, ["e1"], fake)).rejects.toMatchObject({ code: "RANGE_TOO_LONG" });
  });
});

describe("resolveManagerApprover", () => {
  const caller = { id: "mgr", reportingManagerId: "boss", code: "M", name: "M", branchId: null, processId: null, active: true };
  it("returns the active reporting manager", async () => {
    installBase(fake);
    expect(await resolveManagerApprover(caller, fake)).toEqual({ employeeId: "boss", userId: "boss-user" });
  });
  it("returns null with no reporting manager, a self-reference, or an inactive manager", async () => {
    installBase(fake, { approver: null });
    expect(await resolveManagerApprover({ ...caller, reportingManagerId: null }, fake)).toBeNull();
    expect(await resolveManagerApprover({ ...caller, reportingManagerId: "mgr" }, fake)).toBeNull();
    expect(await resolveManagerApprover(caller, fake)).toBeNull();
  });
});

describe("submitDraft", () => {
  const draftHead = () => fake.on(/FROM roster_team_submission WHERE draft_owner_key = \? AND status = 'draft' LIMIT 1$/, () => rows([{ id: 7 }]));
  const inTx = () => {
    fake.on(/SELECT status FROM roster_team_submission WHERE id = \? FOR UPDATE/, () => rows([{ status: "draft" }]));
    fake.on(/INSERT INTO roster_team_pending_cell/, () => header());
    fake.on(/UPDATE roster_team_submission_line SET warnings_json/, () => header());
    fake.on(/UPDATE roster_team_submission\s+SET status/, () => header());
  };

  it("routes to the reporting manager first: pending_manager, locks the cells, audits, notifies the manager", async () => {
    installBase(fake, { lines: [shiftLine(), shiftLine({ id: 2, employee_id: "e2" })] });
    draftHead();
    inTx();
    const out = await submitDraft(actor, { note: "Festival cover" });
    expect(out).toMatchObject({ submissionId: 7, status: "pending_manager", managerStepSkipped: false, lineCount: 2 });
    expect(out.submissionNo).toMatch(/^RTS-\d{4}-000007$/);
    const lock = fake.statements(/INSERT INTO roster_team_pending_cell/)[0];
    expect(lock.params).toEqual(["e1", future, 7, "e2", future, 7]);
    const upd = fake.statements(/UPDATE roster_team_submission\s+SET status/)[0];
    expect(upd.params[0]).toBe("pending_manager");
    expect(upd.params).toContain("boss"); // approver snapshot
    expect(fake.statements(/INSERT INTO roster_team_submission_audit/)[0].params[1]).toBe("submitted");
    const inbox = fake.statements(/INSERT INTO work_inbox_item/);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].params[0]).toBe("boss-user");
    expect(fake.conn.commit).toHaveBeenCalled();
  });

  it("skips the manager step when the submitter has no reporting manager: straight to pending_wfm, WFM notified", async () => {
    installBase(fake, { caller: { ...MANAGER, reporting_manager_id: null }, lines: [shiftLine()] });
    draftHead();
    inTx();
    const out = await submitDraft(actor);
    expect(out).toMatchObject({ status: "pending_wfm", managerStepSkipped: true });
    const upd = fake.statements(/UPDATE roster_team_submission\s+SET status/)[0];
    expect(upd.params[0]).toBe("pending_wfm");
    expect(upd.params).toContain(null); // manager_approver_employee_id NULL
    expect(fake.statements(/INSERT INTO work_inbox_item/)[0].params[0]).toBe("wfm-user");
  });

  it("returns 409 listing the conflicting cells when another submission already holds them", async () => {
    installBase(fake, { lines: [shiftLine()] });
    draftHead();
    inTx();
    fake.on(/INSERT INTO roster_team_pending_cell/, () => Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 }));
    fake.on(/FROM roster_team_pending_cell p JOIN roster_team_submission s/, () =>
      rows([{ employee_id: "e1", d: future, submission_no: "RTS-2026-000003", submitter_name: "Priya Rao", employee_name: "Asha K" }]));
    await expect(submitDraft(actor)).rejects.toMatchObject({
      statusCode: 409, code: "CELL_PENDING",
      details: [expect.objectContaining({ employeeId: "e1", message: expect.stringMatching(/pending with Priya Rao \(RTS-2026-000003\)/) })],
    });
    expect(fake.conn.rollback).toHaveBeenCalled();
    expect(fake.conn.commit).not.toHaveBeenCalled();
  });

  it("does not lock anything when validation fails (422 with the problem cells)", async () => {
    installBase(fake, { lines: [shiftLine({ d: istDate(-1) })] });
    draftHead();
    await expect(submitDraft(actor)).rejects.toMatchObject({ statusCode: 422, code: "SUBMIT_VALIDATION" });
    expect(fake.statements(/INSERT INTO roster_team_pending_cell/)).toHaveLength(0);
  });

  it("404s when there is no draft", async () => {
    installBase(fake);
    fake.on(/FROM roster_team_submission WHERE draft_owner_key = \? AND status = 'draft' LIMIT 1$/, () => rows([]));
    await expect(submitDraft(actor)).rejects.toMatchObject({ statusCode: 404, code: "NO_DRAFT" });
  });

  it("refuses a caller with nobody reporting to them", async () => {
    installBase(fake, { team: [] });
    await expect(submitDraft(actor)).rejects.toMatchObject({ statusCode: 403, code: "NO_TEAM" });
  });
});

describe("cancelSubmission", () => {
  it("lets the submitter cancel a pending submission and releases its cells", async () => {
    installBase(fake);
    fake.on(/FROM roster_team_submission WHERE id = \? FOR UPDATE/, () => rows([{ id: 7, status: "pending_wfm", submitter_employee_id: "mgr" }]));
    fake.on(/UPDATE roster_team_submission SET status = 'cancelled'/, () => header());
    fake.on(/DELETE FROM roster_team_pending_cell/, () => header());
    fake.on(/UPDATE work_inbox_item/, () => header());
    await expect(cancelSubmission(actor, 7)).resolves.toMatchObject({ status: "cancelled" });
    expect(fake.statements(/DELETE FROM roster_team_pending_cell WHERE submission_id = \?/)).toHaveLength(1);
  });

  it("refuses anyone but the submitter, and anything no longer pending", async () => {
    installBase(fake);
    fake.on(/FROM roster_team_submission WHERE id = \? FOR UPDATE/, () => rows([{ id: 7, status: "pending_wfm", submitter_employee_id: "someone-else" }]));
    await expect(cancelSubmission(actor, 7)).rejects.toMatchObject({ statusCode: 403 });
    fake.on(/FROM roster_team_submission WHERE id = \? FOR UPDATE/, () => rows([{ id: 7, status: "applied", submitter_employee_id: "mgr" }]));
    await expect(cancelSubmission(actor, 7)).rejects.toMatchObject({ statusCode: 409, code: "NOT_PENDING" });
  });
});
