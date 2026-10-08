import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/exit/ff/:id/paid — the endpoint that completes the F&F lifecycle.
 *
 * Until migration 1220 + ffService.markFfPaid, 'paid' was unreachable and unrecordable, so
 * a settlement could be approved and disbursed with nothing in the system saying so. These
 * cases pin the route's own contract; the workflow rules (approved-only, maker-checker) are
 * the service's and are covered in ff-paid-transition.test.ts.
 */

const FF_ID = "ff-1";
const ACTOR = "user-payer";

const { markFfPaid } = vi.hoisted(() => ({ markFfPaid: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(),
  hasRole: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee: vi.fn().mockResolvedValue(true) }));
// exit.routes.ts .bind()s these at import time, so every one the router touches must exist.
vi.mock("../exit.controller.js", () => ({
  exitController: {
    getExitStats: vi.fn(), listExitRequests: vi.fn(), createExitRequest: vi.fn(),
    getExitRequest: vi.fn(), updateExitStatus: vi.fn(), deleteExitRequest: vi.fn(),
    getExitAnalytics: vi.fn(), listExitInterviews: vi.fn(),
  },
}));
vi.mock("../ff.service.js", async (orig) => {
  const actual = await orig<Record<string, unknown>>().catch(() => ({}));
  return { ...actual, ffService: { markFfPaid, setProvisionalFalse: vi.fn(), createFF: vi.fn(), getFF: vi.fn(), approveFF: vi.fn() } };
});
vi.mock("../exit-intelligence.service.js", () => ({
  addRetentionAction: vi.fn(), createDefaultClearanceTasks: vi.fn(),
  createExitHealthSnapshot: vi.fn(), getExitCommandCenter: vi.fn(), saveExitInterview: vi.fn(),
}));
vi.mock("../resignation.routes.js", () => {
  const { Router } = require("express");
  return { resignationRouter: Router() };
});

let allowRole = true;
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: ACTOR }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    (req as any).__roles = roles;
    return allowRole ? next() : res.status(403).json({ success: false, message: "denied" });
  },
}));

const { exitRouter } = await import("../exit.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/exit", exitRouter);
  return a;
}

beforeEach(() => {
  allowRole = true;
  markFfPaid.mockReset().mockResolvedValue({ id: FF_ID, status: "paid" });
});

describe("POST /ff/:id/paid", () => {
  it("passes the payment reference through to the service and returns the updated record", async () => {
    const res = await request(app())
      .post(`/api/exit/ff/${FF_ID}/paid`)
      .send({ paymentReference: "UTR123456789" });

    expect(res.status).toBe(200);
    expect(markFfPaid).toHaveBeenCalledWith(FF_ID, ACTOR, "UTR123456789", expect.anything());
    expect(res.body.data.status).toBe("paid");
  });

  it("accepts the snake_case spelling too, since callers in this repo use both", async () => {
    await request(app()).post(`/api/exit/ff/${FF_ID}/paid`).send({ payment_reference: "CHQ-88" });
    expect(markFfPaid).toHaveBeenCalledWith(FF_ID, ACTOR, "CHQ-88", expect.anything());
  });

  it("400s a missing reference WITHOUT calling the service", async () => {
    const res = await request(app()).post(`/api/exit/ff/${FF_ID}/paid`).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/paymentReference is required/);
    expect(markFfPaid).not.toHaveBeenCalled();
  });

  it("400s a whitespace-only reference — blank evidence is not evidence", async () => {
    const res = await request(app()).post(`/api/exit/ff/${FF_ID}/paid`).send({ paymentReference: "   " });
    expect(res.status).toBe(400);
    expect(markFfPaid).not.toHaveBeenCalled();
  });

  it("is role-gated, and to the same set that gates F&F approval", async () => {
    allowRole = false;
    const res = await request(app()).post(`/api/exit/ff/${FF_ID}/paid`).send({ paymentReference: "UTR1" });
    expect(res.status).toBe(403);
    expect(markFfPaid).not.toHaveBeenCalled();

    // Pin the actual role list: hr is deliberately excluded (it verifies/approves, it does not
    // record disbursement), matching the approval route this mirrors.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/modules/exit/exit.routes.ts", "utf8"));
    const block = source.slice(source.indexOf('"/ff/:id/paid"'), source.indexOf('"/ff/:id/paid"') + 200);
    expect(block).toContain('requireRole("admin", "finance", "payroll")');
    expect(block).not.toContain('"hr"');
  });

  it("surfaces a service rejection rather than reporting a false success", async () => {
    markFfPaid.mockRejectedValue(Object.assign(new Error("F&F is 'draft', not 'approved'")));
    const res = await request(app())
      .post(`/api/exit/ff/${FF_ID}/paid`)
      .send({ paymentReference: "UTR1" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
