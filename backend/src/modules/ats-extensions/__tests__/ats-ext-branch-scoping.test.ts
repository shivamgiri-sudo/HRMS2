import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** ats-extensions branch scoping (owner policy 2026-10-01): hr only works inside its own branch's candidates. */
const { dbExecute, scopeBox } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  scopeBox: { value: { orgWide: false, branchIds: ["b-noida"], branchSpellings: ["NOIDA", "b-noida"], branchNames: ["NOIDA"], processNames: [] } as any },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../ats/ats-branch-scope.js", async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolveAtsBranchScope: vi.fn(async () => scopeBox.value) }));
vi.mock("../../ats-assessment/assessment.routes.js", () => ({
  assessmentProtectedRouter: express.Router(), assessmentPublicRouter: express.Router(),
}));
vi.mock("../../ats-assessment/assessment.template-builder.routes.js", () => ({
  assessmentBuilderProtectedRouter: express.Router(), assessmentBuilderPublicRouter: express.Router(),
}));
vi.mock("../../ats-assessment/question-bank.routes.js", () => ({ questionBankRouter: express.Router() }));

/** ats_candidate rows: cand-noida is in scope (SQL "applied_for_branch IN (..)" matches only for it). */
function db() {
  dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT 1 FROM ats_candidate WHERE id = \?/.test(sql)) return [params[0] === "cand-missing" ? [] : [{ 1: 1 }], []];
    if (/SELECT 1 FROM ats_candidate c WHERE c\.id = \?/.test(sql)) return [params[0] === "cand-noida" ? [{ 1: 1 }] : [], []];
    if (/FROM ats_offer WHERE id|SELECT candidate_id FROM ats_offer/.test(sql)) return [[{ candidate_id: params[0] === "offer-noida" ? "cand-noida" : "cand-delhi" }], []];
    if (/SELECT branch_id FROM manpower_requisition/.test(sql)) return [[{ branch_id: params[0] === "mr-noida" ? "b-noida" : "b-delhi" }], []];
    if (/INSERT|UPDATE/.test(sql)) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
}
async function app() {
  const { atsExtRouter } = await import("../ats-ext.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/ats-ext", atsExtRouter); return a;
}
beforeEach(() => {
  dbExecute.mockReset(); db();
  scopeBox.value = { orgWide: false, branchIds: ["b-noida"], branchSpellings: ["NOIDA", "b-noida"], branchNames: ["NOIDA"], processNames: [] };
});

describe("candidate-keyed routes", () => {
  it("BGV read / initiate / update are 403 for a foreign candidate and 404 for a missing one", async () => {
    const a = await app();
    expect((await request(a).get("/api/ats-ext/candidates/cand-delhi/bgv")).status).toBe(403);
    expect((await request(a).post("/api/ats-ext/candidates/cand-delhi/bgv/initiate").send({})).status).toBe(403);
    expect((await request(a).patch("/api/ats-ext/candidates/cand-delhi/bgv").send({})).status).toBe(403);
    expect((await request(a).get("/api/ats-ext/candidates/cand-missing/bgv")).status).toBe(404);
    expect(dbExecute.mock.calls.some(([s]) => /UPDATE ats_bgv_record|INSERT INTO ats_bgv_record/.test(s))).toBe(false);
  });

  it("offers: create for a foreign candidate and status change on a foreign offer are 403", async () => {
    const a = await app();
    expect((await request(a).post("/api/ats-ext/offers").send({ candidate_id: "cand-delhi" })).status).toBe(403);
    expect((await request(a).patch("/api/ats-ext/offers/offer-delhi/status").send({ status: "withdrawn" })).status).toBe(403);
    expect(dbExecute.mock.calls.some(([s]) => /UPDATE ats_offer/.test(s))).toBe(false);
  });

  it("an org-wide caller is not restricted", async () => {
    scopeBox.value = { orgWide: true, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };
    const a = await app();
    expect((await request(a).patch("/api/ats-ext/offers/offer-delhi/status").send({ status: "withdrawn" })).status).toBe(200);
  });
});

describe("list / aggregate routes carry the branch predicate", () => {
  it("offers list, duplicates and funnel add a scope predicate with the caller's spellings", async () => {
    const a = await app();
    await request(a).get("/api/ats-ext/offers");
    await request(a).get("/api/ats-ext/duplicates");
    await request(a).get("/api/ats-ext/analytics/funnel?branch_id=SOMEWHERE");
    for (const re of [/FROM ats_offer o/, /FROM ats_duplicate_log dl/, /FROM ats_candidate\s+WHERE/]) {
      const call = dbExecute.mock.calls.find(([s]) => re.test(s));
      expect(call, String(re)).toBeDefined();
      expect(call![0]).toMatch(/applied_for_branch IN \(/);
      expect(call![1]).toContain("NOIDA");
    }
  });

  it("a scoped caller with no resolvable branch gets 1=0 predicates", async () => {
    scopeBox.value = { orgWide: false, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };
    const a = await app();
    await request(a).get("/api/ats-ext/offers");
    const call = dbExecute.mock.calls.find(([s]) => /FROM ats_offer o/.test(s));
    expect(call![0]).toContain("(1=0)");
  });
});

describe("manpower requisitions", () => {
  it("list is limited to the caller's branch ids; create/approve outside the branch are 403", async () => {
    const a = await app();
    await request(a).get("/api/ats-ext/requisitions?branch_id=b-delhi");
    const listCall = dbExecute.mock.calls.find(([s]) => /FROM manpower_requisition r/.test(s));
    expect(listCall![0]).toContain("r.branch_id IN (?)");
    expect(listCall![1]).toContain("b-noida");
    expect((await request(a).post("/api/ats-ext/requisitions").send({ branch_id: "b-delhi" })).status).toBe(403);
    expect((await request(a).post("/api/ats-ext/requisitions").send({})).status).toBe(403);
    expect((await request(a).post("/api/ats-ext/requisitions/mr-delhi/approve").send({})).status).toBe(403);
    expect((await request(a).post("/api/ats-ext/requisitions/mr-noida/approve").send({})).status).toBe(200);
  });
});
