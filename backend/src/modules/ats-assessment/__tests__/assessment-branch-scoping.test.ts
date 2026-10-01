import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Assessment-admin reads/writes keyed on a candidate or attempt are limited to the caller's branch. */
const U = "11111111-1111-4111-8111-111111111111";
const { dbExecute, scopeBox, svc } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  scopeBox: { value: { orgWide: false, branchIds: ["b-noida"], branchSpellings: ["NOIDA"], branchNames: ["NOIDA"], processNames: [] } as any },
  svc: {
    getAssessmentDashboard: vi.fn(async () => ({})), listAssessmentAttempts: vi.fn(async () => []),
    getCandidateAssessmentSummary: vi.fn(async () => ({})), getAssessmentAttemptDetail: vi.fn(async () => ({})),
    assignAssessmentManually: vi.fn(async () => ({})), reviewAssessment: vi.fn(async () => ({})),
    cancelUnstartedAssessment: vi.fn(async () => ({})), getAttemptCandidateId: vi.fn(),
  },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../assessment.service.js", () => ({ assessmentService: svc }));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../assessment.admin.page.js", () => ({ assessmentAdminPage: () => "" }));
vi.mock("../assessment.page.js", () => ({ candidateAssessmentPage: () => "" }));
vi.mock("../../ats/ats-branch-scope.js", async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolveAtsBranchScope: vi.fn(async () => scopeBox.value) }));

async function app() {
  const { assessmentProtectedRouter } = await import("../assessment.routes.js");
  const a = express(); a.use(express.json());
  a.use((req: any, _res, next) => { req.authUser = { id: "u-hr" }; next(); });
  a.use("/api/ats-ext", assessmentProtectedRouter); return a;
}
beforeEach(() => {
  vi.clearAllMocks();
  scopeBox.value = { orgWide: false, branchIds: ["b-noida"], branchSpellings: ["NOIDA"], branchNames: ["NOIDA"], processNames: [] };
  svc.getAttemptCandidateId.mockResolvedValue(U);
  dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT 1 FROM ats_candidate WHERE id/.test(sql)) return [[{ 1: 1 }], []];
    if (/SELECT 1 FROM ats_candidate c WHERE c\.id/.test(sql)) return [params[0] === U && params.includes("NOIDA") ? [{ 1: 1 }] : [], []];
    return [[], []];
  });
});

const FOREIGN = "22222222-2222-4222-8222-222222222222";
describe("assessment-admin scoping", () => {
  it("candidate summary / assign are 403 for a foreign candidate, fine for an own-branch one", async () => {
    const a = await app();
    expect((await request(a).get(`/api/ats-ext/assessment-admin/candidates/${FOREIGN}/summary`)).status).toBe(403);
    expect((await request(a).post(`/api/ats-ext/assessment-admin/candidates/${FOREIGN}/assign`).send({ templateId: U })).status).toBe(403);
    expect(svc.assignAssessmentManually).not.toHaveBeenCalled();
    expect((await request(a).get(`/api/ats-ext/assessment-admin/candidates/${U}/summary`)).status).toBe(200);
  });

  it("attempt detail / review / cancel resolve the attempt's candidate and refuse a foreign one", async () => {
    svc.getAttemptCandidateId.mockResolvedValue(FOREIGN);
    const a = await app();
    expect((await request(a).get(`/api/ats-ext/assessment-admin/attempts/${U}`)).status).toBe(403);
    expect((await request(a).post(`/api/ats-ext/assessment-admin/attempts/${U}/review`).send({ scores: [] })).status).not.toBe(200);
    expect((await request(a).post(`/api/ats-ext/assessment-admin/attempts/${U}/cancel`).send({ reason: "Cancelled by test, not needed" })).status).toBe(403);
    expect(svc.getAssessmentAttemptDetail).not.toHaveBeenCalled();
    expect(svc.cancelUnstartedAssessment).not.toHaveBeenCalled();
    expect(svc.reviewAssessment).not.toHaveBeenCalled();
    svc.getAttemptCandidateId.mockResolvedValue(undefined);
    expect((await request(a).get(`/api/ats-ext/assessment-admin/attempts/${U}`)).status).toBe(404);
  });

  it("dashboard / attempts list receive the caller's scope; candidate search adds the branch predicate", async () => {
    const a = await app();
    await request(a).get("/api/ats-ext/assessment-admin/dashboard");
    expect(svc.getAssessmentDashboard).toHaveBeenCalledWith(scopeBox.value);
    await request(a).get("/api/ats-ext/assessment-admin/attempts");
    expect(svc.listAssessmentAttempts).toHaveBeenCalledWith(expect.anything(), scopeBox.value);
    await request(a).get("/api/ats-ext/assessment-admin/candidates/search?q=ab");
    const call = dbExecute.mock.calls.find(([s]) => /SELECT id, full_name, candidate_code, mobile/.test(s));
    expect(call![0]).toMatch(/applied_for_branch IN \(/);
    expect(call![1]).toContain("NOIDA");
  });

  it("org-wide roles are unrestricted", async () => {
    scopeBox.value = { orgWide: true, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };
    const a = await app();
    expect((await request(a).get(`/api/ats-ext/assessment-admin/candidates/${FOREIGN}/summary`)).status).toBe(200);
  });
});
