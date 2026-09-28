import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = await vi.hoisted(async () => (await import("./__fixtures__/team-roster-fake-db.js")).createFakeDb());
const mocks = vi.hoisted(() => ({ scope: vi.fn(), apply: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: fake }));
vi.mock("../wfm-scope-fallback.js", () => ({ resolveWfmScope: mocks.scope }));
vi.mock("../team-roster-apply.js", () => ({ applySubmission: mocks.apply }));

import { employeeScopeSql, managerDecide, wfmDecide } from "../team-roster-workflow.js";
import { DashboardScopeConfigurationError } from "../../../shared/dashboardScope.js";
import { rows, header } from "./__fixtures__/team-roster-fake-db.js";
import { MANAGER, installBase } from "./__fixtures__/team-roster-scenario.js";

const submission = (over: Record<string, unknown> = {}) => ({
  id: 7, submission_no: "RTS-2026-000007", status: "pending_manager", submitter_employee_id: "sub-emp", submitter_user_id: "sub-user",
  manager_approver_employee_id: "boss", ...over,
});
const asEmployee = (id: string, over: Record<string, unknown> = {}) => ({ ...MANAGER, id, ...over });
const bossActor = { id: "boss-user", role: "employee", roles: ["employee"] };
const wfmActor = { id: "wfm-user", role: "wfm", roles: ["wfm"] };
const adminActor = { id: "admin-user", role: "admin", roles: ["admin"] };

function serve(row: Record<string, unknown>) {
  fake.on(/SELECT \* FROM roster_team_submission WHERE id = \? FOR UPDATE/, () => rows([row]));
  fake.on(/SELECT \* FROM roster_team_submission WHERE id = \? LIMIT 1/, () => rows([row]));
  fake.on(/UPDATE roster_team_submission /, () => header());
  fake.on(/DELETE FROM roster_team_pending_cell/, () => header());
  fake.on(/UPDATE work_inbox_item/, () => header());
  fake.on(/SELECT DISTINCT e\.branch_id, e\.process_id/, () => rows([{ branch_id: "b1", process_id: "p1" }]));
}
const covers = (total: number, inside: number) =>
  fake.on(/COUNT\(DISTINCT l\.employee_id\) AS total/, () => rows([{ total, inside }]));
const actions = () => fake.statements(/INSERT INTO roster_team_submission_audit/).map((s) => s.params[1]);

beforeEach(() => {
  fake.reset();
  mocks.scope.mockReset();
  mocks.apply.mockReset();
  mocks.scope.mockResolvedValue({ level: "BRANCH_ALL", branchIds: ["b1"], processIds: [], employeeIds: [], userId: "wfm-user", role: "wfm" });
});

describe("manager step", () => {
  it("lets the named reporting manager approve: pending_wfm, WFM notified, cells stay locked", async () => {
    installBase(fake, { caller: asEmployee("boss") });
    serve(submission());
    const out = await managerDecide(bossActor, 7, "approve", "Looks fine");
    expect(out).toEqual({ submissionId: 7, status: "pending_wfm" });
    const upd = fake.statements(/UPDATE roster_team_submission SET status/)[0];
    expect(upd.params.slice(0, 3)).toEqual(["pending_wfm", "approved", "boss-user"]);
    expect(fake.statements(/DELETE FROM roster_team_pending_cell/)).toHaveLength(0);
    expect(actions()).toEqual(["manager_approved"]);
    expect(fake.statements(/INSERT INTO work_inbox_item/)[0].params[0]).toBe("wfm-user");
  });

  it("refuses someone who is not the named manager (403), but lets admin decide on their behalf", async () => {
    installBase(fake, { caller: asEmployee("not-the-boss") });
    serve(submission());
    await expect(managerDecide({ id: "rando", role: "employee", roles: ["employee"] }, 7, "approve")).rejects.toMatchObject({ statusCode: 403, code: "NOT_APPROVER" });
    expect(fake.conn.rollback).toHaveBeenCalled();
    fake.reset();
    installBase(fake, { caller: asEmployee("admin-emp") });
    serve(submission());
    await expect(managerDecide(adminActor, 7, "approve")).resolves.toMatchObject({ status: "pending_wfm" });
  });

  it("refuses self-approval, admins included (by user id and by employee row)", async () => {
    installBase(fake, { caller: asEmployee("sub-emp") });
    serve(submission());
    await expect(managerDecide({ id: "sub-user", role: "admin", roles: ["admin"] }, 7, "approve")).rejects.toMatchObject({ code: "SELF_APPROVAL" });
    // logged in as a different auth user that maps to the submitter's employee row
    await expect(managerDecide({ id: "alias-user", role: "admin", roles: ["admin"] }, 7, "approve")).rejects.toMatchObject({ code: "SELF_APPROVAL" });
  });

  it("requires remarks of at least 8 characters to reject", async () => {
    installBase(fake, { caller: asEmployee("boss") });
    serve(submission());
    await expect(managerDecide(bossActor, 7, "reject", "no")).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    expect(fake.statements(/UPDATE roster_team_submission /)).toHaveLength(0);
  });

  it("reject releases every locked cell, records the audit row and tells the submitter", async () => {
    installBase(fake, { caller: asEmployee("boss") });
    serve(submission());
    const out = await managerDecide(bossActor, 7, "reject", "Coverage is short that week");
    expect(out.status).toBe("rejected");
    expect(fake.statements(/DELETE FROM roster_team_pending_cell WHERE submission_id = \?/)[0].params).toEqual([7]);
    expect(actions()).toEqual(["manager_rejected"]);
    expect(fake.statements(/INSERT INTO work_inbox_item/)[0].params[0]).toBe("sub-user");
  });

  it("refuses a submission that is not awaiting the manager", async () => {
    installBase(fake, { caller: asEmployee("boss") });
    serve(submission({ status: "pending_wfm" }));
    await expect(managerDecide(bossActor, 7, "approve")).rejects.toMatchObject({ statusCode: 409, code: "WRONG_STATE" });
  });
});

describe("WFM step", () => {
  const wfmSetup = (over: Record<string, unknown> = {}) => {
    installBase(fake, { caller: asEmployee("wfm-emp") });
    serve(submission({ status: "pending_wfm", ...over }));
  };

  it("only WFM roles may give the final approval", async () => {
    wfmSetup();
    await expect(wfmDecide(bossActor, 7, "approve")).rejects.toMatchObject({ statusCode: 403, code: "NOT_WFM" });
  });

  it("refuses when the submission includes employees outside the WFM approver's scope", async () => {
    wfmSetup();
    covers(3, 2);
    await expect(wfmDecide(wfmActor, 7, "approve")).rejects.toMatchObject({ statusCode: 403, code: "OUT_OF_SCOPE" });
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("refuses a WFM user with no scope configured", async () => {
    wfmSetup();
    mocks.scope.mockRejectedValue(new DashboardScopeConfigurationError("none"));
    await expect(wfmDecide(wfmActor, 7, "approve")).rejects.toMatchObject({ statusCode: 403, code: "SCOPE_NOT_CONFIGURED" });
  });

  it("refuses self-approval even for a WFM user who is the submitter", async () => {
    installBase(fake, { caller: asEmployee("sub-emp") });
    serve(submission({ status: "pending_wfm" }));
    covers(2, 2);
    await expect(wfmDecide({ id: "sub-user", role: "wfm", roles: ["wfm"] }, 7, "approve")).rejects.toMatchObject({ code: "SELF_APPROVAL" });
  });

  it("refuses to approve before the manager step is done", async () => {
    wfmSetup({ status: "pending_manager" });
    covers(2, 2);
    await expect(wfmDecide(wfmActor, 7, "approve")).rejects.toMatchObject({ code: "WRONG_STATE" });
  });

  it("approve applies the submission then marks it applied and releases the cells", async () => {
    wfmSetup();
    covers(2, 2);
    mocks.apply.mockResolvedValue({ applied: 4, skipped: 0, failed: 0, total: 4, appliedEmployeeIds: ["e1"] });
    const out = await wfmDecide(wfmActor, 7, "approve", "ok");
    expect(out).toMatchObject({ status: "applied", applied: 4 });
    expect(mocks.apply).toHaveBeenCalledWith(7, wfmActor);
    expect(actions()).toEqual(["wfm_approved", "applied"]);
    expect(fake.statements(/DELETE FROM roster_team_pending_cell/)).toHaveLength(1);
    expect(fake.statements(/INSERT INTO work_inbox_item/)[0].params[0]).toBe("sub-user");
  });

  it("a skipped line makes the submission partially_applied (cells still released)", async () => {
    wfmSetup();
    covers(2, 2);
    mocks.apply.mockResolvedValue({ applied: 3, skipped: 1, failed: 0, total: 4, appliedEmployeeIds: ["e1"] });
    expect(await wfmDecide(wfmActor, 7, "approve")).toMatchObject({ status: "partially_applied", skipped: 1 });
    expect(actions()).toEqual(["wfm_approved", "partially_applied"]);
    expect(fake.statements(/DELETE FROM roster_team_pending_cell/)).toHaveLength(1);
  });

  it("reject releases the locks, needs remarks, and never calls apply", async () => {
    wfmSetup();
    covers(2, 2);
    await expect(wfmDecide(wfmActor, 7, "reject", "x")).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const out = await wfmDecide(wfmActor, 7, "reject", "Not enough capacity on those days");
    expect(out.status).toBe("rejected");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(fake.statements(/DELETE FROM roster_team_pending_cell/)).toHaveLength(1);
    expect(actions()).toEqual(["wfm_rejected"]);
  });

  it("admin / super_admin skip the scope query", async () => {
    installBase(fake, { caller: asEmployee("admin-emp") });
    serve(submission({ status: "pending_wfm" }));
    mocks.apply.mockResolvedValue({ applied: 1, skipped: 0, failed: 0, total: 1, appliedEmployeeIds: [] });
    await expect(wfmDecide(adminActor, 7, "approve")).resolves.toMatchObject({ status: "applied" });
    expect(mocks.scope).not.toHaveBeenCalled();
  });
});

describe("employeeScopeSql", () => {
  const base = { employeeIds: [], userId: "u", role: "wfm" };
  it("org-wide has no restriction, branch scope filters on branch, process scope on process", () => {
    expect(employeeScopeSql({ ...base, level: "ORG_ALL", branchIds: [], processIds: [] })).toEqual({ sql: "1=1", params: [] });
    expect(employeeScopeSql({ ...base, level: "BRANCH_ALL", branchIds: ["b1", "b2"], processIds: [] })).toEqual({ sql: "e.branch_id IN (?,?)", params: ["b1", "b2"] });
    expect(employeeScopeSql({ ...base, level: "PROCESS_ALL", branchIds: [], processIds: ["p1"] })).toEqual({ sql: "e.process_id IN (?)", params: ["p1"] });
    expect(employeeScopeSql({ ...base, level: "CUSTOM_SCOPE", branchIds: ["b1"], processIds: ["p1"] }).sql).toBe("(e.branch_id IN (?) OR e.process_id IN (?))");
  });
  it("fails closed for empty or unsupported scopes", () => {
    expect(employeeScopeSql({ ...base, level: "BRANCH_ALL", branchIds: [], processIds: [] }).sql).toBe("1=0");
    expect(employeeScopeSql({ ...base, level: "SELF_ONLY", branchIds: ["b1"], processIds: [] }).sql).toBe("1=0");
    expect(employeeScopeSql({ ...base, level: "TEAM_ONLY", branchIds: ["b1"], processIds: [] }).sql).toBe("1=0");
  });
});
