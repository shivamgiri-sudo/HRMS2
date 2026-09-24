import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const svc = vi.hoisted(() => ({
  getMe: vi.fn(), listTemplates: vi.fn(), getGrid: vi.fn(), getMyDraft: vi.fn(), upsertDraftLines: vi.fn(), setDraftNote: vi.fn(),
  discardDraft: vi.fn(), submitDraft: vi.fn(), listMySubmissions: vi.fn(), listApprovals: vi.fn(), getSubmissionDetail: vi.fn(),
  cancelSubmission: vi.fn(), copySubmissionToDraft: vi.fn(), managerDecide: vi.fn(), wfmDecide: vi.fn(),
  getTeamAttendance: vi.fn(), getTeamAttendanceDetail: vi.fn(),
}));
const roleGuard = vi.hoisted(() => vi.fn());

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-1", role: "employee", roles: ["employee"] }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: (...r: string[]) => { roleGuard(...r); return (_q: any, _s: any, n: any) => n(); } }));
vi.mock("../team-roster.service.js", () => ({ getMe: svc.getMe, listTemplates: svc.listTemplates, getGrid: svc.getGrid }));
vi.mock("../team-roster-draft.js", () => ({ getMyDraft: svc.getMyDraft, upsertDraftLines: svc.upsertDraftLines, setDraftNote: svc.setDraftNote, discardDraft: svc.discardDraft }));
vi.mock("../team-roster-submit.js", () => ({ submitDraft: svc.submitDraft, cancelSubmission: svc.cancelSubmission, copySubmissionToDraft: svc.copySubmissionToDraft }));
vi.mock("../team-roster-query.js", () => ({ listMySubmissions: svc.listMySubmissions, listApprovals: svc.listApprovals, getSubmissionDetail: svc.getSubmissionDetail }));
vi.mock("../team-roster-attendance.js", () => ({ getTeamAttendance: svc.getTeamAttendance, getTeamAttendanceDetail: svc.getTeamAttendanceDetail }));
vi.mock("../team-roster-workflow.js", () => ({ managerDecide: svc.managerDecide, wfmDecide: svc.wfmDecide }));

import { teamRosterRouter } from "../team-roster.routes.js";
import { TeamRosterError } from "../team-roster-types.js";

const app = express();
app.use(express.json());
app.use("/api/wfm/team-roster", teamRosterRouter);
const base = "/api/wfm/team-roster";

beforeEach(() => Object.values(svc).forEach((f) => f.mockReset()));

describe("team-roster routes", () => {
  it("is authentication-only at the router level (no role list: the audience is 'anyone with reports')", () => {
    expect(roleGuard).not.toHaveBeenCalled();
  });

  it("GET /me returns the service payload in the success envelope", async () => {
    svc.getMe.mockResolvedValue({ isManager: true, teamSize: 3, canApproveManagerStep: false, canApproveWfmStep: false });
    const res = await request(app).get(`${base}/me`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { isManager: true, teamSize: 3, canApproveManagerStep: false, canApproveWfmStep: false } });
    expect(svc.getMe).toHaveBeenCalledWith(expect.objectContaining({ id: "u-1", roles: ["employee"] }));
  });

  it("GET /grid validates the query before touching the service", async () => {
    const bad = await request(app).get(`${base}/grid?from=nope&to=2026-10-01`);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION");
    expect(bad.body.error).toBeUndefined();
    expect(svc.getGrid).not.toHaveBeenCalled();
    svc.getGrid.mockResolvedValue({ rows: [] });
    const ok = await request(app).get(`${base}/grid?from=2026-10-01&to=2026-10-07&limit=50&search=asha`);
    expect(ok.status).toBe(200);
    expect(svc.getGrid).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ from: "2026-10-01", limit: 50, search: "asha" }));
  });

  it("PUT /draft/lines accepts only the four cell types", async () => {
    const bad = await request(app).put(`${base}/draft/lines`).send({ upserts: [{ employeeId: "e1", date: "2026-10-01", type: "HOLIDAY" }] });
    expect(bad.status).toBe(400);
    svc.upsertDraftLines.mockResolvedValue({ draftId: 1, lineCount: 1 });
    const ok = await request(app).put(`${base}/draft/lines`).send({ upserts: [{ employeeId: "e1", date: "2026-10-01", type: "SHIFT", shiftTemplateId: "t1" }], deletes: [] });
    expect(ok.status).toBe(200);
    expect(svc.upsertDraftLines).toHaveBeenCalledWith(expect.anything(), { upserts: [{ employeeId: "e1", date: "2026-10-01", type: "SHIFT", shiftTemplateId: "t1", reason: null }], deletes: [] });
  });

  it("POST /draft/submit returns 201; a 409 conflict carries its cell details", async () => {
    svc.submitDraft.mockResolvedValue({ submissionId: 7, status: "pending_manager" });
    expect((await request(app).post(`${base}/draft/submit`).send({})).status).toBe(201);
    svc.submitDraft.mockRejectedValue(new TeamRosterError(409, "Some cells are already pending in another submission.", "CELL_PENDING", [{ employeeId: "e1", date: "2026-10-01", message: "pending with Priya" }]));
    const res = await request(app).post(`${base}/draft/submit`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, code: "CELL_PENDING", details: [{ message: "pending with Priya" }] });
  });

  it("static paths are not captured by /submissions/:id and the id must be a positive integer", async () => {
    svc.listMySubmissions.mockResolvedValue({ items: [], total: 0 });
    expect((await request(app).get(`${base}/submissions`)).status).toBe(200);
    expect((await request(app).get(`${base}/submissions/abc`)).status).toBe(400);
    svc.getSubmissionDetail.mockResolvedValue({ submission: { id: 7 } });
    expect((await request(app).get(`${base}/submissions/7`)).status).toBe(200);
    expect(svc.getSubmissionDetail).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it("GET /approvals needs step=manager|wfm", async () => {
    expect((await request(app).get(`${base}/approvals`)).status).toBe(400);
    expect((await request(app).get(`${base}/approvals?step=admin`)).status).toBe(400);
    svc.listApprovals.mockResolvedValue({ items: [], total: 0 });
    expect((await request(app).get(`${base}/approvals?step=wfm`)).status).toBe(200);
    expect(svc.listApprovals).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ step: "wfm" }));
  });

  it("wires the four decision endpoints to the right step and decision", async () => {
    svc.managerDecide.mockResolvedValue({ status: "pending_wfm" });
    svc.wfmDecide.mockResolvedValue({ status: "applied" });
    await request(app).post(`${base}/submissions/7/manager-approve`).send({ remarks: "ok" });
    await request(app).post(`${base}/submissions/7/manager-reject`).send({ remarks: "not enough cover" });
    await request(app).post(`${base}/submissions/7/wfm-approve`).send({});
    await request(app).post(`${base}/submissions/7/wfm-reject`).send({ remarks: "capacity is full" });
    expect(svc.managerDecide.mock.calls.map((c) => [c[1], c[2], c[3]])).toEqual([[7, "approve", "ok"], [7, "reject", "not enough cover"]]);
    expect(svc.wfmDecide.mock.calls.map((c) => [c[1], c[2]])).toEqual([[7, "approve"], [7, "reject"]]);
  });

  it("maps a service refusal to its status and an unexpected error to a generic 500", async () => {
    svc.managerDecide.mockRejectedValue(new TeamRosterError(403, "You cannot approve or reject your own submission.", "SELF_APPROVAL"));
    const refused = await request(app).post(`${base}/submissions/7/manager-approve`).send({});
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("SELF_APPROVAL");
    svc.getMe.mockRejectedValue(new Error("ER_BAD_FIELD_ERROR secret table detail"));
    const boom = await request(app).get(`${base}/me`);
    expect(boom.status).toBe(500);
    expect(JSON.stringify(boom.body)).not.toMatch(/secret table detail/);
  });
  it("GET /attendance needs month=YYYY-MM, passes it through, and maps a future-month refusal to 400", async () => {
    expect((await request(app).get(`${base}/attendance`)).status).toBe(400);
    expect((await request(app).get(`${base}/attendance?month=2026-9`)).status).toBe(400);
    expect(svc.getTeamAttendance).not.toHaveBeenCalled();
    svc.getTeamAttendance.mockResolvedValue({ rows: [], total: 0 });
    const ok = await request(app).get(`${base}/attendance?month=2026-09&search=asha&limit=25&offset=50`);
    expect(ok.status).toBe(200);
    expect(svc.getTeamAttendance).toHaveBeenCalledWith(expect.objectContaining({ id: "u-1" }), expect.objectContaining({ month: "2026-09", search: "asha", limit: 25, offset: 50 }));
    svc.getTeamAttendance.mockRejectedValue(new TeamRosterError(400, "Attendance is only available for the current or a past month.", "FUTURE_MONTH"));
    const future = await request(app).get(`${base}/attendance?month=2999-01`);
    expect(future.status).toBe(400);
    expect(future.body.code).toBe("FUTURE_MONTH");
  });

  it("GET /attendance/:employeeId never takes the employee from the query and surfaces the tree refusal as 403", async () => {
    svc.getTeamAttendanceDetail.mockRejectedValue(new TeamRosterError(403, "This employee is not in your reporting team.", "NOT_IN_TEAM"));
    const res = await request(app).get(`${base}/attendance/emp-9?month=2026-09&employeeId=other`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_IN_TEAM");
    expect(svc.getTeamAttendanceDetail).toHaveBeenCalledWith(expect.anything(), "emp-9", "2026-09");
    expect((await request(app).get(`${base}/attendance/emp-9`)).status).toBe(400);
  });
});
