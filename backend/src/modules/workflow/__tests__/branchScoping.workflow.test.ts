import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Workflow approvals (owner ruling 2026-10-01): approvers see / act only on requests from their own scope. */
const { dbExecute, state } = vi.hoisted(() => ({ dbExecute: vi.fn(), state: { orgWide: false } }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: async () => ({}),
  buildEmployeeScopeCondition: () => (state.orgWide ? { sql: "1=1", params: [] } : { sql: "e.branch_id = ?", params: ["b1"] }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr", roles: ["hr"] }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

const { workflowRouter } = await import("../workflow.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/workflow", workflowRouter); return a; };

beforeEach(() => {
  state.orgWide = false; dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string, params: any[]) => {
    if (/SELECT id FROM approval_request WHERE id/.test(sql)) return [params[0] === "none" ? [] : [{ id: params[0] }], []];
    if (/SELECT 1 AS ok FROM approval_request r/.test(sql)) return [params[0] === "r-mine" ? [{ ok: 1 }] : [], []];
    return [[], []];
  });
});

describe("workflow scoping", () => {
  it("pending approvals carry the requester-scope predicate, not just approver_role", async () => {
    await request(app()).get("/api/workflow/requests/pending");
    const [sql, params] = dbExecute.mock.calls.find(([q]) => /s\.approver_role = \?/.test(q))!;
    expect(sql).toMatch(/\(r\.requested_by = \? OR \(e\.branch_id = \?\)\)/);
    expect(params).toEqual(["hr", "u-hr", "b1"]);
  });
  it("org-wide approvers keep the unfiltered inbox", async () => {
    state.orgWide = true;
    await request(app()).get("/api/workflow/requests/pending");
    const [sql] = dbExecute.mock.calls.find(([q]) => /s\.approver_role = \?/.test(q))!;
    expect(sql).toMatch(/AND 1=1/);
  });
  it("acting on / reading the log of a request from another branch is 403", async () => {
    expect((await request(app()).post("/api/workflow/requests/r-other/act").send({ action: "approved" })).status).toBe(403);
    expect((await request(app()).get("/api/workflow/requests/r-other/actions")).status).toBe(403);
  });
  it("all-requests list is scoped", async () => {
    await request(app()).get("/api/workflow/requests");
    const [sql] = dbExecute.mock.calls.find(([q]) => /FROM approval_request r/.test(q) && /LIMIT/.test(q))!;
    expect(sql).toMatch(/r\.requested_by = \?/);
  });
});
