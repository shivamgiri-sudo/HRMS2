/**
 * The resend route, exercised through Express: authorization and branch scope
 * are the same for the one-click and the custom-recipient call, the body is
 * validated before anything is sent, and the response never carries a full address.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const roleGuards: string[][] = [];
let inScope = true;
const resend = vi.fn();
const options = vi.fn();

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: "hr-1" };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => {
    roleGuards.push(roles);
    return (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
  },
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  buildScopeWhereClause: vi.fn(async () => ({ sql: "e.branch_id = ?", params: ["b1"] })),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async () => [inScope ? [{ ok: 1 }] : []]) },
}));
vi.mock("../appointmentLetterResend.service.js", () => ({
  resendAppointmentAcceptLink: (...a: unknown[]) => resend(...a),
  getAppointmentResendOptions: (...a: unknown[]) => options(...a),
  checkAppointmentEsignStatus: vi.fn(),
}));
vi.mock("../appointmentLetterEligibility.service.js", () => ({
  appointmentLetterSearchTerm: vi.fn(), evaluateAppointmentLetterEligibility: vi.fn(), listAppointmentLetterQueue: vi.fn(),
}));
vi.mock("../appointmentLetterIssue.service.js", () => ({ issueAppointmentLetter: vi.fn(), revokeAppointmentLetter: vi.fn() }));
vi.mock("../appointmentLetterPdf.service.js", () => ({ renderAppointmentLetterPdf: vi.fn() }));
vi.mock("../../org/branchAddress.service.js", () => ({
  resolveEmployeeLetterhead: vi.fn(), assertPrintableLetterhead: vi.fn(), EMPTY_LETTERHEAD: {},
}));
vi.mock("../appointmentLetterData.service.js", () => ({ resolveAppointmentLetterSalary: vi.fn() }));

const { appointmentLetterRouter } = await import("../appointmentLetter.routes.js");

const app = express();
app.use(express.json());
app.use("/letters", appointmentLetterRouter);
app.use((err: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.statusCode ?? 500).json({ success: false, message: err.message });
});

const URL = "/letters/appointment-letters/issue-1/resend-link";
const sent = { resent: true, message: "x", emailedTo: ["jane@gmail.com"], letterNumber: "MCN-AL-1", sentAt: "2026-09-24T10:00:00.000Z" };
const body = { recipients: ["jane@gmail.com"], reason: "Employee lost access to inbox" };

beforeEach(() => {
  inScope = true;
  resend.mockReset(); options.mockReset();
  resend.mockResolvedValue(sent);
});

describe("route authorization is identical for one-click and custom resend", () => {
  it("both resend routes use the same role set as issuing (payroll HR included, branch_head excluded)", () => {
    const resendRoles = roleGuards.filter((r) => r.includes("payroll_head") && r.includes("hr") && !r.includes("branch_head"));
    // resend-link, resend-options, esign/check, issue — every one of them the same set
    expect(resendRoles.length).toBeGreaterThanOrEqual(4);
    expect(new Set(resendRoles.map((r) => r.join(","))).size).toBe(1);
  });

  it.each([
    ["no body", undefined],
    ["custom recipients", body],
  ])("403s an out-of-scope letter and sends nothing (%s)", async (_l, payload) => {
    inScope = false;
    const res = await request(app).post(URL).send(payload as object);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/outside your assigned branch/);
    expect(resend).not.toHaveBeenCalled();
  });

  it("scope is checked before the body is validated (no validation oracle for out-of-scope letters)", async () => {
    inScope = false;
    const res = await request(app).post(URL).send({ recipients: ["not-an-email"] });
    expect(res.status).toBe(403);
  });

  it("403s resend-options for an out-of-scope letter", async () => {
    inScope = false;
    const res = await request(app).get("/letters/appointment-letters/issue-1/resend-options");
    expect(res.status).toBe(403);
    expect(options).not.toHaveBeenCalled();
  });
});

describe("POST resend-link", () => {
  it("no body: calls the service with no custom recipients", async () => {
    resend.mockResolvedValue({ ...sent, emailedTo: ["harsh@example.com", "harsh@mas.in"] });
    const res = await request(app).post(URL).send({});
    expect(res.status).toBe(200);
    expect(resend).toHaveBeenCalledWith({ issueId: "issue-1", actorUserId: "hr-1", custom: null });
    expect(res.body.data.emailedTo).toEqual(["h***@e***.com", "h***@m***.in"]);
  });

  it("custom: passes normalised recipients and reason, and answers {letterNumber, emailedTo masked, sentAt}", async () => {
    const res = await request(app).post(URL).send({ recipients: [" Jane@Gmail.com "], reason: "  Employee lost access to inbox " });
    expect(res.status).toBe(200);
    expect(resend).toHaveBeenCalledWith({
      issueId: "issue-1", actorUserId: "hr-1",
      custom: { recipients: ["jane@gmail.com"], reason: "Employee lost access to inbox" },
    });
    expect(res.body.data).toEqual({ letterNumber: "MCN-AL-1", emailedTo: ["j***@g***.com"], sentAt: sent.sentAt });
    expect(JSON.stringify(res.body)).not.toContain("jane@gmail.com");
  });

  it.each([
    ["missing reason", { recipients: ["jane@gmail.com"] }, /reason of at least 8/],
    ["short reason", { recipients: ["jane@gmail.com"], reason: "short" }, /reason of at least 8/],
    ["invalid address", { recipients: ["nope"], reason: "Employee lost access" }, /not a valid email/],
    ["duplicate", { recipients: ["a@x.com", "A@x.com"], reason: "Employee lost access" }, /more than once/],
    ["header injection", { recipients: ["a@x.com\r\nBcc: e@evil.com"], reason: "Employee lost access" }, /invalid characters/],
    ["too many", { recipients: ["a@x.com", "b@x.com", "c@x.com", "d@x.com"], reason: "Employee lost access" }, /at most 3/],
    ["empty list", { recipients: [], reason: "Employee lost access" }, /at least one/],
  ])("400s %s and never reaches the service", async (_l, payload, message) => {
    const res = await request(app).post(URL).send(payload);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
    expect(resend).not.toHaveBeenCalled();
  });

  it("409 for a refusal, with the service's message verbatim", async () => {
    resend.mockResolvedValue({ resent: false, message: "This letter has been revoked — there is nothing to resend." });
    const res = await request(app).post(URL).send(body);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This letter has been revoked — there is nothing to resend.");
  });

  it("429 when rate-limited", async () => {
    resend.mockResolvedValue({ resent: false, status: 429, message: "This letter has already been resent 5 times in the last hour." });
    const res = await request(app).post(URL).send(body);
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/last hour/);
  });
});

describe("GET resend-options", () => {
  it("returns what the service returns for an in-scope letter", async () => {
    options.mockResolvedValue({ letterNumber: "MCN-AL-1", onFile: [], history: [] });
    const res = await request(app).get("/letters/appointment-letters/issue-1/resend-options");
    expect(res.status).toBe(200);
    expect(res.body.data.letterNumber).toBe("MCN-AL-1");
    expect(options).toHaveBeenCalledWith("issue-1");
  });
});
