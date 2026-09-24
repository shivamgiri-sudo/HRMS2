import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = await vi.hoisted(async () => (await import("./__fixtures__/team-roster-fake-db.js")).createFakeDb());
const mocks = vi.hoisted(() => ({ scope: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: fake }));
vi.mock("../wfm-scope-fallback.js", () => ({ resolveWfmScope: mocks.scope }));
vi.mock("../rest-policy.service.js", () => ({
  isRestPolicyFeatureActive: vi.fn(async () => false), validateMinimumRest: vi.fn(), applyRestDecision: vi.fn(), withEmployeeRosterLock: vi.fn(),
}));
vi.mock("../roster-offday-policy.loader.js", () => ({ loadActivePolicies: vi.fn(async () => []) }));

import { getGrid, getMe, listTemplates } from "../team-roster.service.js";
import { upsertDraftLines } from "../team-roster-draft.js";
import { getSubmissionDetail, listApprovals, listMySubmissions } from "../team-roster-query.js";
import { rows, header } from "./__fixtures__/team-roster-fake-db.js";
import { MANAGER, TEMPLATE, installBase, istDate } from "./__fixtures__/team-roster-scenario.js";

const actor = { id: "mgr-user", role: "employee", roles: ["employee"] };
const d3 = istDate(3);

beforeEach(() => {
  fake.reset();
  mocks.scope.mockReset();
  mocks.scope.mockResolvedValue({ level: "BRANCH_ALL", branchIds: ["b1"], processIds: [], employeeIds: [], userId: "wfm-user", role: "wfm" });
});

describe("GET /me", () => {
  it("a pure employee-role user with reports is a manager, and is not a WFM approver", async () => {
    installBase(fake);
    fake.on(/SELECT 1 AS x FROM employees c/, () => rows([]));
    fake.on(/SELECT 1 AS x FROM roster_team_submission WHERE manager_approver_employee_id/, () => rows([]));
    const me = await getMe(actor);
    expect(me).toMatchObject({ isManager: true, teamSize: 2, canApproveWfmStep: false, canApproveManagerStep: false, hasReportingManager: true });
    expect(me.employee).toMatchObject({ id: "mgr", name: "Meera Manager" });
  });

  it("someone with no reports is not a manager", async () => {
    installBase(fake, { team: [] });
    fake.on(/SELECT 1 AS x FROM employees c/, () => rows([]));
    fake.on(/SELECT 1 AS x FROM roster_team_submission WHERE manager_approver_employee_id/, () => rows([]));
    expect(await getMe(actor)).toMatchObject({ isManager: false, teamSize: 0 });
  });

  it("a manager of managers can approve the manager step; WFM roles can approve the final step", async () => {
    installBase(fake);
    fake.on(/SELECT 1 AS x FROM employees c/, () => rows([{ x: 1 }]));
    expect((await getMe(actor)).canApproveManagerStep).toBe(true);
    fake.on(/SELECT 1 AS x FROM employees c/, () => rows([]));
    fake.on(/SELECT 1 AS x FROM roster_team_submission WHERE manager_approver_employee_id/, () => rows([]));
    expect((await getMe({ id: "u", role: "branch_wfm", roles: ["branch_wfm"] })).canApproveWfmStep).toBe(true);
  });

  it("a login with no employee record is neither manager nor approver of the manager step", async () => {
    installBase(fake, { caller: null });
    expect(await getMe(actor)).toMatchObject({ isManager: false, employee: null, canApproveManagerStep: false });
  });
});

describe("GET /templates", () => {
  it("returns the newest active version of each shift for the processes of the team only", async () => {
    installBase(fake);
    fake.on(/SELECT DISTINCT e\.process_id, pm\.process_name/, () => rows([{ process_id: "p1", process_name: "Collections" }]));
    fake.on(/FROM wfm_shift_template\s+WHERE process_id IN/, () => rows([
      { id: "t2", shift_code: "GEN", shift_name: "General v2", version: 2, process_id: "p1", start_time: "09:00:00", end_time: "18:00:00", night_shift: 0 },
      { id: "t1", shift_code: "GEN", shift_name: "General v1", version: 1, process_id: "p1", start_time: "09:00:00", end_time: "18:00:00", night_shift: 0 },
      { id: "t3", shift_code: "NGT", shift_name: "Night", version: 1, process_id: "p1", start_time: "22:00:00", end_time: "06:00:00", night_shift: 0 },
    ]));
    const out = await listTemplates(actor);
    expect(out.processes).toHaveLength(1);
    expect(out.processes[0].templates.map((t: any) => t.id)).toEqual(["t2", "t3"]);
    expect(out.processes[0].templates[1]).toMatchObject({ start: "22:00", end: "06:00", night: true });
    expect(out.processes[0].options.map((o: any) => o.key)).toEqual(["09:00-18:00", "22:00-06:00"]);
    const tplQuery = fake.statements(/FROM wfm_shift_template\s+WHERE process_id IN/)[0];
    expect(tplQuery.params.slice(0, 1)).toEqual(["p1"]);
  });
});

describe("GET /grid", () => {
  const gridRoutes = () => {
    fake.on(/SELECT COUNT\(\*\) AS c FROM employees e/, () => rows([{ c: 2 }]));
    fake.on(/SELECT e\.id, e\.employee_code/, () => rows([
      { id: "e1", employee_code: "MAS1", name: "Asha K", process_id: "p1", process_name: "Collections" },
      { id: "e2", employee_code: "MAS2", name: "Ravi S", process_id: "p1", process_name: "Collections" },
    ]));
    fake.on(/FROM wfm_roster_assignment wra LEFT JOIN wfm_shift_template wst/, () => rows([
      { id: "a1", employee_id: "e1", d: d3, assignment_type: "SHIFT", is_week_off: 0, shift_template_id: "t1", shift_start_time: "09:00:00", shift_end_time: "18:00:00", final_roster_status: "acknowledged", shift_code: "GEN", shift_name: "General" },
    ]));
    fake.on(/FROM roster_team_pending_cell p/, () => rows([{ employee_id: "e2", d: d3, submission_id: 9, submission_no: "RTS-2026-000009", status: "pending_wfm", submitter_name: "Priya Rao" }]));
    fake.on(/WHERE s\.draft_owner_key = \? AND l\.employee_id IN/, () => rows([{ employee_id: "e2", d: istDate(4), kind: "FILL_BLANK", new_assignment_type: "WEEK_OFF", new_shift_template_id: null, reason: null }]));
    fake.on(/FROM leave_request/, () => rows([{ employee_id: "e1", from_date: istDate(4), to_date: istDate(4), total_days: 1 }]));
  };

  it("returns team rows with sparse per-date cells: stored assignment, lock-elsewhere, my draft and leave markers", async () => {
    installBase(fake);
    gridRoutes();
    const out = await getGrid(actor, { from: d3, to: istDate(5) });
    expect(out).toMatchObject({ total: 2, dates: [d3, istDate(4), istDate(5)], teamTruncated: false });
    const [asha, ravi] = out.rows as any[];
    expect(asha.cells[d3].assignment).toMatchObject({ id: "a1", type: "SHIFT", shiftCode: "GEN", start: "09:00", end: "18:00" });
    expect(asha.cells[istDate(4)].leave).toBe("FULL");
    expect(ravi.cells[d3].lockedBy).toMatchObject({ submissionNo: "RTS-2026-000009", submitter: "Priya Rao", status: "pending_wfm" });
    expect(ravi.cells[istDate(4)].draft).toMatchObject({ kind: "FILL_BLANK", type: "WEEK_OFF" });
    expect(ravi.cells[istDate(5)]).toBeUndefined();
  });

  it("only ever queries employees inside the caller's tree", async () => {
    installBase(fake);
    gridRoutes();
    await getGrid(actor, { from: d3, to: d3, search: "asha" });
    const q = fake.statements(/SELECT e\.id, e\.employee_code/)[0];
    expect(q.sql).toMatch(/e\.id IN \(\?,\?\)/);
    expect(q.params.slice(0, 2)).toEqual(["e1", "e2"]);
    expect(q.params).toContain("%asha%");
  });

  it("validates the range: bad dates, reversed, and more than 31 days", async () => {
    installBase(fake);
    await expect(getGrid(actor, { from: "2026-13-40", to: d3 })).rejects.toMatchObject({ code: "BAD_DATE" });
    await expect(getGrid(actor, { from: istDate(5), to: d3 })).rejects.toMatchObject({ code: "BAD_RANGE" });
    await expect(getGrid(actor, { from: d3, to: istDate(40) })).rejects.toMatchObject({ code: "RANGE_TOO_LONG" });
  });

  it("caps the page size at 500 and refuses a caller with no team", async () => {
    installBase(fake);
    gridRoutes();
    const out = await getGrid(actor, { from: d3, to: d3, limit: 99999 });
    expect(out.limit).toBe(500);
    fake.reset();
    installBase(fake, { team: [] });
    await expect(getGrid(actor, { from: d3, to: d3 })).rejects.toMatchObject({ statusCode: 403, code: "NO_TEAM" });
  });
});

describe("PUT /draft/lines", () => {
  const drafting = (assignments: Array<Record<string, unknown>> = []) => {
    installBase(fake, { assignments });
    fake.on(/SELECT id, process_id FROM employees WHERE id IN/, (_s, p) => rows(p.map((id: string) => ({ id, process_id: "p1" }))));
    fake.on(/FROM roster_team_submission WHERE draft_owner_key = \? AND status = 'draft' LIMIT 1 FOR UPDATE/, () => rows([{ id: 7 }]));
    fake.on(/INSERT INTO roster_team_submission_line/, () => header());
    fake.on(/COUNT\(\*\) AS c, DATE_FORMAT\(MIN/, () => rows([{ c: 1, f: d3, t: d3 }]));
  };
  const weekOff = { employeeId: "e1", date: d3, type: "WEEK_OFF" as const };

  it("classifies a blank cell as FILL_BLANK and stores no snapshot", async () => {
    drafting();
    const out = await upsertDraftLines(actor, { upserts: [weekOff] });
    expect(out).toMatchObject({ draftId: 7, lineCount: 1, from: d3, to: d3, skipped: [] });
    const ins = fake.statements(/INSERT INTO roster_team_submission_line/)[0];
    expect(ins.params.slice(0, 5)).toEqual([7, "e1", d3, "FILL_BLANK", null]);
  });

  it("classifies a rostered cell as CHANGE and snapshots what it replaces", async () => {
    drafting([{ id: "a1", employee_id: "e1", d: d3, assignment_type: "SHIFT", is_week_off: 0, shift_template_id: "t1", shift_start_time: "09:00:00", shift_end_time: "18:00:00" }]);
    await upsertDraftLines(actor, { upserts: [{ ...weekOff, reason: "Asked for leave" }] });
    const ins = fake.statements(/INSERT INTO roster_team_submission_line/)[0];
    expect(ins.params.slice(0, 11)).toEqual([7, "e1", d3, "CHANGE", "a1", "SHIFT", 0, "t1", "09:00", "18:00", "WEEK_OFF"]);
  });

  it("refuses past dates, out-of-tree employees, forged / foreign shift times and no-op changes in one 422", async () => {
    drafting([{ id: "a1", employee_id: "e2", d: d3, assignment_type: "WEEK_OFF", is_week_off: 1, shift_template_id: null, shift_start_time: null, shift_end_time: null }]);
    await expect(upsertDraftLines(actor, { upserts: [
      { ...weekOff, date: istDate(-1) },
      { ...weekOff, employeeId: "stranger" },
      { employeeId: "e1", date: d3, type: "SHIFT", shiftStart: "03:15", shiftEnd: "11:45" },
      { employeeId: "e2", date: d3, type: "WEEK_OFF" },
    ] })).rejects.toMatchObject({
      statusCode: 422, code: "LINE_VALIDATION",
      details: expect.arrayContaining([
        expect.objectContaining({ message: "Past dates cannot be changed." }),
        expect.objectContaining({ message: "Employee is not in your reporting team." }),
        expect.objectContaining({ message: expect.stringMatching(/not one of the shifts available for this employee's process/) }),
        expect.objectContaining({ message: expect.stringMatching(/nothing to change/) }),
      ]),
    });
    expect(fake.statements(/INSERT INTO roster_team_submission_line/)).toHaveLength(0);
  });

  it("stores a time-only shift (in use in the process, no template) as times, ignoring client-supplied ids", async () => {
    drafting();
    fake.on(/FROM wfm_shift_template\s+WHERE process_id IN/, () => rows([]));
    fake.on(/FROM wfm_roster_assignment wra JOIN employees e/, () => rows([{ process_id: "p1", shift_start_time: "10:00", shift_end_time: "19:00", uses: 40 }]));
    await upsertDraftLines(actor, { upserts: [{ employeeId: "e1", date: d3, type: "SHIFT", shiftStart: "10:00", shiftEnd: "19:00", shiftTemplateId: "forged", shiftMasterId: "forged" }] });
    const ins = fake.statements(/INSERT INTO roster_team_submission_line/)[0];
    // ... new_assignment_type, new_shift_template_id, new_shift_start_time, new_shift_end_time, new_shift_id, reason
    expect(ins.params.slice(10, 16)).toEqual(["SHIFT", null, "10:00", "19:00", null, null]);
  });

  it("refuses to change a rostered time-only shift to the same times (nothing to change)", async () => {
    drafting([{ id: "a1", employee_id: "e1", d: d3, assignment_type: "SHIFT", is_week_off: 0, shift_template_id: null, shift_start_time: "10:00", shift_end_time: "19:00" }]);
    fake.on(/FROM wfm_shift_template\s+WHERE process_id IN/, () => rows([]));
    fake.on(/FROM wfm_roster_assignment wra JOIN employees e/, () => rows([{ process_id: "p1", shift_start_time: "10:00", shift_end_time: "19:00", uses: 40 }]));
    await expect(upsertDraftLines(actor, { upserts: [{ employeeId: "e1", date: d3, type: "SHIFT", shiftStart: "10:00", shiftEnd: "19:00", reason: "Same shift again" }] }))
      .rejects.toMatchObject({ code: "LINE_VALIDATION", details: [expect.objectContaining({ message: expect.stringMatching(/nothing to change/) })] });
  });

  it("lenient mode (copy back) skips invalid cells instead of failing", async () => {
    drafting();
    const out = await upsertDraftLines(actor, { upserts: [weekOff, { ...weekOff, date: istDate(-3) }] }, { lenient: true });
    expect(out.skipped).toHaveLength(1);
    expect(fake.statements(/INSERT INTO roster_team_submission_line/)).toHaveLength(1);
  });

  it("refuses a draft that would span more than 31 days", async () => {
    drafting();
    fake.on(/COUNT\(\*\) AS c, DATE_FORMAT\(MIN/, () => rows([{ c: 2, f: d3, t: istDate(45) }]));
    await expect(upsertDraftLines(actor, { upserts: [weekOff] })).rejects.toMatchObject({ code: "RANGE_TOO_LONG" });
    expect(fake.conn.rollback).toHaveBeenCalled();
  });
});

describe("drill-down payload and queues", () => {
  const sub = (over: Record<string, unknown> = {}) => ({
    id: 7, submission_no: "RTS-2026-000007", status: "pending_wfm", submitter_employee_id: "sub-emp", submitter_user_id: "sub-user",
    manager_approver_employee_id: "boss", manager_decision: "approved", manager_remarks: "ok", from_d: d3, to_d: d3, note: "cover",
    submitter_code: "MAS9", submitter_name: "Sam Sub", manager_name: "Bo Boss", manager_decided_s: "2026-09-25 10:00:00", ...over,
  });
  const detailRoutes = (s = sub()) => {
    fake.on(/FROM roster_team_submission s\s+LEFT JOIN employees se ON se\.id = s\.submitter_employee_id\s+LEFT JOIN employees me ON me\.id = s\.manager_approver_employee_id WHERE s\.id = \?/, () => rows([s]));
    fake.on(/FROM roster_team_submission_line l\s+LEFT JOIN employees e ON e\.id = l\.employee_id/, () => rows([
      { id: 1, employee_id: "e1", d: d3, kind: "CHANGE", old_assignment_type: "SHIFT", old_shift_start_time: "09:00:00", old_shift_end_time: "18:00:00", new_assignment_type: "WEEK_OFF", reason: "Asked for leave", warnings_json: JSON.stringify(["Off-day policy: x"]), line_status: "skipped", skip_reason: "changed since proposed", applied_assignment_id: null, employee_code: "MAS1", employee_name: "Asha K", old_code: "GEN", new_code: null, new_start: null, new_end: null },
      { id: 2, employee_id: "e2", d: d3, kind: "FILL_BLANK", old_assignment_type: null, old_shift_start_time: null, old_shift_end_time: null, new_assignment_type: "SHIFT", reason: null, warnings_json: null, line_status: "applied", skip_reason: null, applied_assignment_id: "a9", employee_code: "MAS2", employee_name: "Ravi S", old_code: null, new_code: "GEN", new_start: "09:00:00", new_end: "18:00:00" },
    ]));
    fake.on(/FROM roster_team_submission_audit a/, () => rows([
      { action: "submitted", actor_role: "employee", remarks: null, meta_json: JSON.stringify({ lines: 2 }), at: "2026-09-25 09:00:00", actor_name: "Sam Sub" },
      { action: "manager_approved", actor_role: "employee", remarks: "ok", meta_json: null, at: "2026-09-25 10:00:00", actor_name: "Bo Boss" },
    ]));
  };

  it("returns lines with old -> new, warnings, per-line result, the approver timeline and the caller's permissions", async () => {
    installBase(fake, { caller: { ...MANAGER, id: "wfm-emp" } });
    detailRoutes();
    fake.on(/COUNT\(DISTINCT l\.employee_id\) AS total/, () => rows([{ total: 2, inside: 2 }]));
    fake.on(/SELECT 1 AS x FROM roster_team_submission_line l JOIN employees e/, () => rows([{ x: 1 }]));
    const out = await getSubmissionDetail({ id: "wfm-user", role: "wfm", roles: ["wfm"] }, 7);
    expect(out.submission).toMatchObject({ submissionNo: "RTS-2026-000007", status: "pending_wfm", managerStepSkipped: false, submitter: { name: "Sam Sub" }, managerApprover: { name: "Bo Boss" } });
    expect(out.submission.managerDecision).toMatchObject({ decision: "approved", remarks: "ok" });
    expect(out.lines[0]).toMatchObject({ kind: "CHANGE", old: { type: "SHIFT", label: "GEN 09:00-18:00" }, new: { type: "WEEK_OFF", label: null }, warnings: ["Off-day policy: x"], status: "skipped", skipReason: "changed since proposed" });
    expect(out.lines[1]).toMatchObject({ kind: "FILL_BLANK", old: null, new: { type: "SHIFT", label: "GEN 09:00-18:00" }, appliedAssignmentId: "a9" });
    expect(out.summary).toEqual({ total: 2, applied: 1, skipped: 1, failed: 0, pending: 0, withWarnings: 1 });
    expect(out.timeline.map((t) => t.action)).toEqual(["submitted", "manager_approved"]);
    expect(out.timeline[0].meta).toEqual({ lines: 2 });
    expect(out.permissions).toMatchObject({ canWfmDecide: true, canManagerDecide: false, canCancel: false });
  });

  it("lets the submitter cancel a pending submission; a stranger gets 404, not 403", async () => {
    installBase(fake, { caller: { ...MANAGER, id: "sub-emp" } });
    detailRoutes();
    const own = await getSubmissionDetail(actor, 7);
    expect(own.permissions).toMatchObject({ canCancel: true, canWfmDecide: false, canManagerDecide: false });
    fake.reset();
    installBase(fake, { caller: { ...MANAGER, id: "stranger" } });
    detailRoutes();
    await expect(getSubmissionDetail(actor, 7)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("the manager step queue only lists submissions snapshotted to the caller, and never their own", async () => {
    installBase(fake, { caller: { ...MANAGER, id: "boss" } });
    fake.on(/SELECT COUNT\(\*\) AS c FROM roster_team_submission s/, () => rows([{ c: 1 }]));
    fake.on(/ORDER BY s\.submitted_at ASC/, () => rows([{ id: 7, submission_no: "RTS-2026-000007", status: "pending_manager", from_date: d3, to_date: d3, submitter_name: "Sam Sub", manager_name: "Bo Boss", manager_approver_employee_id: "boss", line_count: 2, applied_count: 0, warning_count: 1 }]));
    const out = await listApprovals({ id: "boss-user", role: "employee", roles: ["employee"] }, { step: "manager" });
    expect(out.items[0]).toMatchObject({ id: 7, submitter: { name: "Sam Sub" }, lineCount: 2, warningCount: 1 });
    const q = fake.statements(/ORDER BY s\.submitted_at ASC/)[0];
    expect(q.sql).toMatch(/s\.manager_approver_employee_id = \?/);
    expect(q.sql).toMatch(/s\.submitter_employee_id <> \?/);
    expect(q.params.slice(0, 1)).toEqual(["boss"]);
  });

  it("the WFM queue is refused to non-WFM roles and is filtered by branch scope for WFM", async () => {
    installBase(fake, { caller: { ...MANAGER, id: "wfm-emp" } });
    await expect(listApprovals(actor, { step: "wfm" })).rejects.toMatchObject({ statusCode: 403, code: "NOT_WFM" });
    fake.on(/SELECT COUNT\(\*\) AS c FROM roster_team_submission s/, () => rows([{ c: 0 }]));
    fake.on(/ORDER BY s\.submitted_at ASC/, () => rows([]));
    await listApprovals({ id: "wfm-user", role: "wfm", roles: ["wfm"] }, { step: "wfm" });
    const q = fake.statements(/ORDER BY s\.submitted_at ASC/)[0];
    expect(q.sql).toMatch(/e\.branch_id IN \(\?\)/);
    expect(q.sql).toMatch(/s\.status = 'pending_wfm'/);
    expect(q.params).toContain("b1");
  });

  it("'my submissions' lists only the caller's own non-draft submissions", async () => {
    installBase(fake, { caller: { ...MANAGER, id: "sub-emp" } });
    fake.on(/SELECT COUNT\(\*\) AS c FROM roster_team_submission s/, () => rows([{ c: 0 }]));
    fake.on(/ORDER BY s\.id DESC/, () => rows([]));
    await listMySubmissions(actor, { status: "rejected" });
    const q = fake.statements(/ORDER BY s\.id DESC/)[0];
    expect(q.sql).toMatch(/s\.submitter_employee_id = \? AND s\.status <> 'draft' AND s\.status = \?/);
    expect(q.params).toEqual(["sub-emp", "rejected"]);
  });
});
