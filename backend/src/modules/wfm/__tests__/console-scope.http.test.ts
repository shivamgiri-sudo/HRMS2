/**
 * Router-level behaviour of the console scope guard, over real HTTP (supertest): what a handler sees in
 * req.query after the guard, and that path-param guards refuse another branch's rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { execute, resolveScope } = vi.hoisted(() => ({ execute: vi.fn(), resolveScope: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope: resolveScope }));

import { branchParamGuard, consoleScopeGuard, employeeParamGuard } from "../console-scope.js";

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";
const P2 = "aaaaaaaa-0000-0000-0000-000000000002";

const base = { userId: "u", employeeId: "e", employeeCode: "C", processId: null, lobId: null, departmentId: null, isSuperAdmin: false, isAdmin: false, isHr: false, isPayroll: false, isFinance: false, assignments: [] as unknown[] };
const asBranchHead = () => resolveScope.mockResolvedValue({ ...base, roles: ["branch_head"], branchId: B1 });
const asCeo = () => resolveScope.mockResolvedValue({ ...base, roles: ["ceo"], branchId: B1 });
const asTwoBranchHr = () => resolveScope.mockResolvedValue({
  ...base, roles: ["hr"], branchId: B1,
  assignments: [{ roleKey: "hr", scopeType: "branch", branchId: B1, processId: null }, { roleKey: "hr", scopeType: "branch", branchId: B2, processId: null }],
});

function app() {
  const a = express();
  a.use((req, _res, next) => { (req as unknown as { authUser: { id: string } }).authUser = { id: "u" }; next(); });
  const r = express.Router();
  r.use(consoleScopeGuard({ entityPaths: /^\/employee-profile\/[^/]+/ }));
  r.param("branchId", branchParamGuard());
  r.param("employeeId", employeeParamGuard());
  r.get("/summary", (req, res) => res.json({ query: req.query }));
  r.get("/forecast/:branchId", (req, res) => res.json({ branch: req.params.branchId }));
  r.get("/employee-profile/:employeeId", (req, res) => res.json({ employee: req.params.employeeId }));
  a.use("/x", r);
  return a;
}

beforeEach(() => {
  execute.mockReset();
  // employees lookup: e-own is in B1, e-other is in B2; process P2 is in B2.
  execute.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/FROM employees/i.test(sql)) return [[params[0] === "e-own" ? { branch_id: B1, process_id: null } : params[0] === "e-other" ? { branch_id: B2, process_id: null } : undefined].filter(Boolean)];
    if (/FROM process_master/i.test(sql)) return [[params[0] === P2 ? { branch_id: B2 } : undefined].filter(Boolean)];
    return [[]];
  });
});

describe("consoleScopeGuard over HTTP", () => {
  it("branch head asking for another branch: 403, the handler never runs", async () => {
    asBranchHead();
    const res = await request(app()).get(`/x/summary?branchId=${B2}`);
    expect(res.status).toBe(403);
    expect(res.body.query).toBeUndefined();
  });
  it("branch head naming nothing: the handler sees their own branch injected", async () => {
    asBranchHead();
    const res = await request(app()).get("/x/summary");
    expect(res.status).toBe(200);
    expect(res.body.query.branchId).toBe(B1);
  });
  it("the UI's 'all' placeholder is treated as not asked, then narrowed to the caller's branch", async () => {
    asBranchHead();
    const res = await request(app()).get("/x/summary?branchId=__all__&processId=");
    expect(res.status).toBe(200);
    expect(res.body.query).toEqual({ branchId: B1 });
  });
  it("org-wide role: query passes untouched, any branch", async () => {
    asCeo();
    const res = await request(app()).get(`/x/summary?branchId=${B2}&lobId=l1`);
    expect(res.status).toBe(200);
    expect(res.body.query).toEqual({ branchId: B2, lobId: "l1" });
  });
  it("a process in another branch is refused", async () => {
    asBranchHead();
    expect((await request(app()).get(`/x/summary?processId=${P2}`)).status).toBe(403);
  });
  it("an employee named in the query must be in scope", async () => {
    asBranchHead();
    expect((await request(app()).get("/x/summary?employeeId=e-other")).status).toBe(403);
    expect((await request(app()).get("/x/summary?employeeId=e-own")).status).toBe(200);
  });
  it("multi-branch HR who names no branch gets a 400 asking them to choose", async () => {
    asTwoBranchHr();
    const res = await request(app()).get("/x/summary");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Select a branch/);
    expect((await request(app()).get(`/x/summary?branchId=${B2}`)).status).toBe(200);
  });
  it("no resolvable user: 401", async () => {
    resolveScope.mockResolvedValue(undefined);
    const a = express();
    const r = express.Router();
    r.use(consoleScopeGuard());
    r.get("/summary", (_q, res) => res.json({}));
    a.use("/x", r);
    expect((await request(a).get("/x/summary")).status).toBe(401);
  });
});

describe("path-param guards", () => {
  it(":branchId must be the caller's branch", async () => {
    asBranchHead();
    expect((await request(app()).get(`/x/forecast/${B1}`)).status).toBe(200);
    expect((await request(app()).get(`/x/forecast/${B2}`)).status).toBe(403);
  });
  it(":employeeId must be in scope, and entity routes do not need a branch selection", async () => {
    asTwoBranchHr();
    // multi-branch caller naming no branch is fine on an entity route as long as the employee is theirs...
    resolveScope.mockResolvedValue({ ...base, roles: ["hr"], branchId: B1, assignments: [{ roleKey: "hr", scopeType: "branch", branchId: B1, processId: null }, { roleKey: "hr", scopeType: "branch", branchId: B2, processId: null }] });
    expect((await request(app()).get("/x/employee-profile/e-own")).status).toBe(200);
    // ...and a single-branch caller is refused another branch's employee.
    asBranchHead();
    expect((await request(app()).get("/x/employee-profile/e-other")).status).toBe(403);
  });
});
