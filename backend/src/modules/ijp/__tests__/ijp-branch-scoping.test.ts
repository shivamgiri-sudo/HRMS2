import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** IJP branch scoping (owner policy 2026-10-01): hr is branch-limited; org-wide roles are not. */
const { dbExecute, resolveScope } = vi.hoisted(() => ({ dbExecute: vi.fn(), resolveScope: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolveUserBusinessScope: resolveScope }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn(async () => ({ id: "emp-1" })) }));

const scope = (o: Record<string, unknown> = {}) => ({
  userId: "u1", roles: ["hr"], employeeId: "emp-1", employeeCode: "E1", branchId: "branch-A", processId: null, lobId: null,
  departmentId: null, isSuperAdmin: false, isAdmin: false, isHr: true, isPayroll: false, isFinance: false, assignments: [], ...o,
});

/** posting-B belongs to branch-B; the scope predicate is evaluated by params: only branch-A matches branch-A. */
function db() {
  dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT process_id, branch_id, department_id FROM ijp_posting/.test(sql)) return [params[0] === "missing" ? [] : [{ branch_id: "x" }], []];
    if (/SELECT 1 FROM ijp_posting p WHERE p\.id = \?/.test(sql)) return [params.includes("branch-A") && params[0] === "posting-A" ? [{ 1: 1 }] : [], []];
    if (/SELECT \* FROM ijp_application WHERE id/.test(sql)) return [[{ id: "app-1", posting_id: params[0] === "app-A" ? "posting-A" : "posting-B", status: "submitted" }], []];
    if (/COUNT\(\*\) AS total_postings|total_postings/.test(sql)) return [[{ total_postings: 1 }], []];
    return [[], []];
  });
}

beforeEach(() => { dbExecute.mockReset(); resolveScope.mockReset(); db(); });

describe("ijp.service scope", () => {
  it("postingScopeCondition: org-wide is 1=1; hr is own branch (even with no assignment rows); no branch is 1=0", async () => {
    const { postingScopeCondition } = await import("../ijp.service.js");
    const al = { processId: "p.process_id", branchId: "p.branch_id", departmentId: "p.department_id" };
    expect(postingScopeCondition(scope({ roles: ["cfo"] }) as any, al).sql).toBe("1=1");
    const hr = postingScopeCondition(scope() as any, al);
    expect(hr.sql).toContain("p.branch_id = ?");
    expect(hr.params).toEqual(["branch-A"]);
    expect(postingScopeCondition(scope({ branchId: null }) as any, al).sql).toBe("1=0");
  });

  it("getIjpStats is scoped to the caller's postings (was org-wide aggregates)", async () => {
    resolveScope.mockResolvedValue(scope());
    const { getIjpStats } = await import("../ijp.service.js");
    await getIjpStats("u1");
    const [sql, params] = dbExecute.mock.calls[0];
    expect(sql).toContain("p.branch_id = ?");
    expect(params.filter((p: unknown) => p === "branch-A").length).toBe(5);
    dbExecute.mockClear();
    resolveScope.mockResolvedValue(scope({ roles: ["super_admin"] }));
    await getIjpStats("u1");
    expect(dbExecute.mock.calls[0][0]).toContain("1=1");
    // admin is branch-scoped too (owner ruling 2026-10-01)
    dbExecute.mockClear();
    resolveScope.mockResolvedValue(scope({ roles: ["admin"] }));
    await getIjpStats("u1");
    expect(dbExecute.mock.calls[0][0]).toContain("p.branch_id = ?");
  });

  it("resolvePostingBranchForCreate: hr can only create in its own branch; org-wide is free", async () => {
    const { resolvePostingBranchForCreate } = await import("../ijp.service.js");
    resolveScope.mockResolvedValue(scope());
    expect(await resolvePostingBranchForCreate("u1", "branch-B")).toEqual({ ok: false });
    expect(await resolvePostingBranchForCreate("u1", undefined)).toEqual({ ok: true, branchId: "branch-A" });
    expect(await resolvePostingBranchForCreate("u1", "branch-A")).toEqual({ ok: true, branchId: "branch-A" });
    resolveScope.mockResolvedValue(scope({ branchId: null }));
    expect(await resolvePostingBranchForCreate("u1", undefined)).toEqual({ ok: false });
    resolveScope.mockResolvedValue(scope({ roles: ["super_admin"], branchId: null }));
    expect(await resolvePostingBranchForCreate("u1", "branch-Z")).toEqual({ ok: true, branchId: "branch-Z" });
  });
});

describe("ijp routes", () => {
  async function app() {
    const router = (await import("../ijp.routes.js")).default;
    const a = express(); a.use(express.json()); a.use("/api/ijp", router); return a;
  }

  it("PATCH applications/:id/status is 403 for another branch's posting, allowed for own", async () => {
    resolveScope.mockResolvedValue(scope());
    const a = await app();
    expect((await request(a).patch("/api/ijp/applications/app-B/status").send({ status: "shortlisted" })).status).toBe(403);
    const ok = await request(a).patch("/api/ijp/applications/app-A/status").send({ status: "shortlisted" });
    expect(ok.status).toBe(200);
  });

  it("posting update / publish / close are 403 outside the branch", async () => {
    resolveScope.mockResolvedValue(scope());
    const a = await app();
    expect((await request(a).patch("/api/ijp/postings/posting-B").send({ job_title: "Abcd" })).status).toBe(403);
    expect((await request(a).post("/api/ijp/postings/posting-B/publish")).status).toBe(403);
    expect((await request(a).post("/api/ijp/postings/posting-B/close").send({})).status).toBe(403);
  });

  it("GET /stats passes the caller to the service", async () => {
    resolveScope.mockResolvedValue(scope());
    const a = await app();
    expect((await request(a).get("/api/ijp/stats")).status).toBe(200);
    expect(dbExecute.mock.calls[0][0]).toContain("p.branch_id = ?");
  });
});
