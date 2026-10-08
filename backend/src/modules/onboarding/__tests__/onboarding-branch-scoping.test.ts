import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Onboarding admin views (penny-drop history, name-validation flags, DigiLocker session) are branch-scoped. */
const { dbExecute, verdict } = vi.hoisted(() => ({ dbExecute: vi.fn(), verdict: { value: "forbidden" as string } }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../ats-extensions/ats-ext-scope.js", () => ({
  resolveAtsBranchScope: vi.fn(async () => ({})),
  checkCandidateScope: vi.fn(async () => verdict.value),
  OUT_OF_SCOPE_MESSAGE: "Forbidden: record is outside your branch / assigned scope",
}));
vi.mock("../penny-drop.service.js", () => ({ PennyDropService: {} }));
vi.mock("../name-validation.service.js", () => ({ NameValidationService: {} }));
vi.mock("../../integrations/luckpay/luckpay-status.service.js", () => ({ syncDigilockerStatus: vi.fn() }));

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) =>
    /candidate_digilocker_session WHERE id/.test(sql) ? [[{ sessionId: "s1", candidateId: "cand-1" }], []] : [[{ status: "x" }], []]);
});
async function app() {
  const [{ pennyDropRouter }, { nameValidationRouter }, { digiLockerRouter }] = await Promise.all([
    import("../penny-drop.routes.js"), import("../name-validation.routes.js"), import("../digilocker.routes.js"),
  ]);
  const a = express(); a.use(express.json());
  a.use("/penny", pennyDropRouter); a.use("/names", nameValidationRouter); a.use("/dl", digiLockerRouter); return a;
}

describe("candidate-keyed onboarding admin views", () => {
  it("403 for a candidate outside the caller's scope - no candidate data is read", async () => {
    verdict.value = "forbidden";
    const a = await app();
    expect((await request(a).get("/penny/candidate/cand-1")).status).toBe(403);
    expect((await request(a).get("/names/candidate/cand-1")).status).toBe(403);
    expect((await request(a).get("/dl/s1")).status).toBe(403);
    expect(dbExecute.mock.calls.some(([s]) => /onboarding_penny_drop_requests|candidate_payroll_review_flags/.test(s))).toBe(false);
  });
  it("200 for a candidate inside the scope; 404 for a missing one", async () => {
    verdict.value = "ok";
    const a = await app();
    expect((await request(a).get("/penny/candidate/cand-1")).status).toBe(200);
    expect((await request(a).get("/names/candidate/cand-1")).status).toBe(200);
    expect((await request(a).get("/dl/s1")).status).toBe(200);
    verdict.value = "not_found";
    expect((await request(a).get("/penny/candidate/cand-x")).status).toBe(404);
  });
});
