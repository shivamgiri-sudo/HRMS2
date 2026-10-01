import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /recruiter-submission: admin gets the same own-branch "submit on behalf of a recruiter" path as hr
 * (owner ruling 2026-10-01: admin is branch-scoped like hr). A recruiter of another branch is refused.
 */
const { submit, roles, dbExecute, scopeBox } = vi.hoisted(() => ({
  submit: vi.fn(async () => ({ submission: { id: "s1" }, action: "created" })),
  roles: { value: ["admin"] as string[] },
  dbExecute: vi.fn(),
  scopeBox: { value: { orgWide: false, branchIds: ["b-noida"], branchSpellings: ["NOIDA"], branchNames: ["NOIDA"], processNames: [] } as any },
}));
vi.mock("../atsFullParity.service.js", () => ({ atsFullParityService: {} }));
vi.mock("../recruiterInterview.service.js", () => ({ submitInterviewUpdate: submit, resolveRecruiterForActor: vi.fn(async () => null) }));
vi.mock("../../dashboards/metrics-in-flight.js", () => ({ sharedInFlight: (_k: string, fn: () => unknown) => fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-admin" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasScopedAccess: vi.fn(async () => false), getUserRoleKeys: vi.fn(async () => roles.value) }));
vi.mock("../../ats/ats-branch-scope.js", async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolveAtsBranchScope: vi.fn(async () => scopeBox.value) }));

async function post(body: Record<string, unknown>) {
  const { atsFullParityRouter } = await import("../atsFullParity.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/ats-full-parity", atsFullParityRouter);
  return request(a).post("/api/ats-full-parity/recruiter-submission").send(body);
}
const recruiter = (branch: string) => dbExecute.mockResolvedValue([[{ id: "r1", name: "R", recruiter_code: "RC1", email: null, branch, employee_id: null }], []]);

beforeEach(() => {
  vi.clearAllMocks();
  roles.value = ["admin"];
  scopeBox.value = { orgWide: false, branchIds: ["b-noida"], branchSpellings: ["NOIDA"], branchNames: ["NOIDA"], processNames: [] };
});

describe("POST /recruiter-submission on behalf of a recruiter", () => {
  it("admin may submit for a recruiter of their own branch", async () => {
    recruiter("NOIDA");
    const res = await post({ recruiterCode: "RC1" });
    expect(res.status).toBe(200);
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("admin is refused for a recruiter of another branch", async () => {
    recruiter("DELHI");
    const res = await post({ recruiterCode: "RC1" });
    expect(res.status).toBe(403);
    expect(submit).not.toHaveBeenCalled();
  });
  it("hr keeps the same own-branch path", async () => {
    roles.value = ["hr"];
    recruiter("DELHI");
    expect((await post({ recruiterCode: "RC1" })).status).toBe(403);
    recruiter("NOIDA");
    expect((await post({ recruiterCode: "RC1" })).status).toBe(200);
  });
  it("an org-wide caller may submit for any branch", async () => {
    scopeBox.value = { orgWide: true, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };
    roles.value = ["ceo"];
    recruiter("DELHI");
    expect((await post({ recruiterCode: "RC1" })).status).toBe(200);
  });
  it("a plain recruiter (no admin/hr) cannot use the on-behalf path (falls back to their own profile)", async () => {
    roles.value = ["recruiter"];
    recruiter("NOIDA");
    expect((await post({ recruiterCode: "RC1" })).status).toBe(403);
    expect(submit).not.toHaveBeenCalled();
  });
});
