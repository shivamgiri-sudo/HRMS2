import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** ATS command center: hr no longer bypasses the row scope; only the org-wide exempt roles do. */
const { svc, scopeBox } = vi.hoisted(() => ({
  svc: {
    webData: vi.fn(async () => ({ queueRows: [], candidateRows: [] })),
    commandCenterData: vi.fn(async () => ({})),
    candidateJourney: vi.fn(async () => ({ candidate: { applied_for_branch: "DELHI", branch_text: null } })),
    dailyReportSnapshot: vi.fn(async () => []),
  },
  scopeBox: { value: { orgWide: false, branchIds: ["b-noida"], branchSpellings: ["NOIDA"], branchNames: ["NOIDA"], processNames: [] } as any },
}));
vi.mock("../atsFullParity.service.js", () => ({ atsFullParityService: svc }));
vi.mock("../recruiterInterview.service.js", () => ({ submitInterviewUpdate: vi.fn(), resolveRecruiterForActor: vi.fn(async () => null) }));
vi.mock("../../dashboards/metrics-in-flight.js", () => ({ sharedInFlight: (_k: string, fn: () => unknown) => fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[], []]) } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasScopedAccess: vi.fn(async () => false), getUserRoleKeys: vi.fn(async () => ["hr"]) }));
vi.mock("../../ats/ats-branch-scope.js", async (orig) => ({ ...(await orig<Record<string, unknown>>()), resolveAtsBranchScope: vi.fn(async () => scopeBox.value) }));

async function app() {
  const { atsFullParityRouter } = await import("../atsFullParity.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/ats-full-parity", atsFullParityRouter); return a;
}
beforeEach(() => {
  vi.clearAllMocks();
  scopeBox.value = { orgWide: false, branchIds: ["b-noida"], branchSpellings: ["NOIDA"], branchNames: ["NOIDA"], processNames: [] };
});

describe("ats-full-parity scope", () => {
  it("web-data / command-center / queue / submissions are scoped for hr (bypassScope=false)", async () => {
    const a = await app();
    for (const p of ["web-data", "command-center", "queue", "submissions"]) await request(a).get(`/api/ats-full-parity/${p}`);
    const calls = [...svc.webData.mock.calls, ...svc.commandCenterData.mock.calls] as any[];
    expect(calls.length).toBe(4);
    for (const [arg] of calls) { expect(arg.bypassScope).toBe(false); expect(arg.actorId).toBe("u-hr"); }
  });

  it("an org-wide role (ceo, finance...) bypasses the scope", async () => {
    scopeBox.value = { orgWide: true, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };
    const a = await app();
    await request(a).get("/api/ats-full-parity/web-data");
    expect((svc.webData.mock.calls[0] as any[])[0].bypassScope).toBe(true);
  });

  it("journey: hr gets 403 for a candidate of another branch (was: any candidate)", async () => {
    const a = await app();
    expect((await request(a).get("/api/ats-full-parity/journey?query=x")).status).toBe(403);
    svc.candidateJourney.mockResolvedValueOnce({ candidate: { applied_for_branch: "NOIDA" } } as any);
    expect((await request(a).get("/api/ats-full-parity/journey?query=x")).status).toBe(200);
  });

  it("daily report: hr gets its own branch's report only; org-wide gets everything", async () => {
    const a = await app();
    await request(a).get("/api/ats-full-parity/daily-report/snapshot");
    expect(svc.dailyReportSnapshot).toHaveBeenLastCalledWith("preview", "u-hr");
    await request(a).post("/api/ats-full-parity/daily-report/send");
    expect(svc.dailyReportSnapshot).toHaveBeenLastCalledWith("send", "u-hr");
    scopeBox.value = { orgWide: true, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };
    await request(a).post("/api/ats-full-parity/daily-report/send");
    expect(svc.dailyReportSnapshot).toHaveBeenLastCalledWith("send", undefined);
  });
});
