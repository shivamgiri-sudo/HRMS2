import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** MCNmeet (owner ruling 2026-10-01): list / detail / reports are limited to the caller's scope. */
const { dbExecute, scopeState, listMeetings, getSummaryReport } = vi.hoisted(() => ({
  dbExecute: vi.fn(), scopeState: { roles: ["hr"] as string[] },
  listMeetings: vi.fn(async () => ({ meetings: [], total: 0 })), getSummaryReport: vi.fn(async () => ({})),
}));
vi.mock("../../../config/env.js", () => ({ env: { MCNMEET_ENABLED: true } }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: async () => ({ roles: scopeState.roles, assignments: [], branchId: "b1", employeeId: "e-self" }),
  buildEmployeeScopeCondition: () => ({ sql: "se.branch_id = ?", params: ["b1"] }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", role: "hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../mcnmeet.service.js", () => ({
  listMeetings, getSummaryReport, getMeetingWithDetails: vi.fn(async () => ({ id: "m1" })), getMeeting: vi.fn(async () => null),
  updateMeeting: vi.fn(async () => true), cancelMeeting: vi.fn(async () => true), resolveInvitees: vi.fn(async () => 0),
  updateAttendance: vi.fn(async () => true), selfJoin: vi.fn(async () => true), acknowledgeInvite: vi.fn(async () => true),
  updateRecording: vi.fn(async () => true), generateRoomName: () => "r", buildJoinUrl: () => "u", listMyMeetings: vi.fn(),
  createMeeting: vi.fn(),
}));

const { mcnmeetRouter } = await import("../mcnmeet.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/mcnmeet", mcnmeetRouter); return a; };

beforeEach(() => {
  scopeState.roles = ["hr"]; dbExecute.mockReset(); listMeetings.mockClear(); getSummaryReport.mockClear();
  dbExecute.mockImplementation(async (sql: string, params: any[]) => {
    if (/SELECT id FROM mcnmeet_meeting WHERE/.test(sql)) return [params[0] === "none" ? [] : [{ id: params[0] }], []];
    if (/SELECT 1 AS ok FROM mcnmeet_meeting m/.test(sql)) return [params[0] === "m-mine" ? [{ ok: 1 }] : [], []];
    return [[], []];
  });
});

describe("mcnmeet scoping", () => {
  it("list receives the caller's meeting scope", async () => {
    await request(app()).get("/api/mcnmeet/meetings");
    const scope = (listMeetings.mock.calls[0] as any)[1];
    expect(scope.sql).toMatch(/m\.created_by = \?/);
    expect(scope.sql).toMatch(/SELECT se\.id FROM employees se/);
    expect(scope.params).toContain("u1");
  });
  it("org-wide roles are unrestricted", async () => {
    scopeState.roles = ["super_admin"];
    await request(app()).get("/api/mcnmeet/meetings");
    expect((listMeetings.mock.calls[0] as any)[1].sql).toBe("1=1");
    expect((await request(app()).get("/api/mcnmeet/meetings/m-other")).status).toBe(200);
  });
  it("admin is scoped like hr (owner ruling 2026-10-01)", async () => {
    scopeState.roles = ["admin"];
    await request(app()).get("/api/mcnmeet/meetings");
    expect((listMeetings.mock.calls[0] as any)[1].sql).toMatch(/m\.created_by = \?/);
    expect((await request(app()).get("/api/mcnmeet/meetings/m-other")).status).toBe(403);
  });
  it("a meeting outside the scope is 403 for detail, patch, cancel, attendance, calendar", async () => {
    const a = app();
    expect((await request(a).get("/api/mcnmeet/meetings/m-other")).status).toBe(403);
    expect((await request(a).patch("/api/mcnmeet/meetings/m-other").send({ title: "x" })).status).toBe(403);
    expect((await request(a).post("/api/mcnmeet/meetings/m-other/cancel").send({ cancel_reason: "because" })).status).toBe(403);
    expect((await request(a).post("/api/mcnmeet/meetings/m-other/attendance").send({})).status).toBe(403);
    expect((await request(a).get("/api/mcnmeet/meetings/m-other/calendar.ics")).status).toBe(403);
  });
  it("an in-scope meeting and an unknown id pass through", async () => {
    expect((await request(app()).get("/api/mcnmeet/meetings/m-mine")).status).toBe(200);
    expect((await request(app()).get("/api/mcnmeet/meetings/none")).status).toBe(200);
  });
  it("summary report is scoped", async () => {
    await request(app()).get("/api/mcnmeet/reports/summary");
    expect((getSummaryReport.mock.calls[0] as any)[2].sql).toMatch(/m\.created_by/);
  });
});
