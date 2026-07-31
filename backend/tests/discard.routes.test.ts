import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Route contract for /api/discard.
 *
 * The gate matters more than usual here: these endpoints credit leave balances
 * back and rewrite attendance, so anything short of super_admin / wfm must be
 * refused before the service is ever reached.
 */

const { previewLeave, previewRegularization, discardLeave, discardRegularization, listDiscards } =
  vi.hoisted(() => ({
    previewLeave: vi.fn(),
    previewRegularization: vi.fn(),
    discardLeave: vi.fn(),
    discardRegularization: vi.fn(),
    listDiscards: vi.fn(),
  }));

// Roles for the fake authenticated user, swapped per test.
const { currentRoles } = vi.hoisted(() => ({ currentRoles: { value: ["super_admin"] } }));

vi.mock("../src/middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "u1", email: "t@example.com", role: currentRoles.value[0], roles: currentRoles.value, isReadOnly: false };
    next();
  },
  requireWriteAccess: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: (...allowed: string[]) => (req: any, res: any, next: any) => {
    const roles: string[] = req.authUser?.roles ?? [];
    if (roles.includes("super_admin")) return next();
    if (allowed.some((r) => roles.includes(r))) return next();
    return res.status(403).json({ success: false, message: `Access denied. Required: ${allowed.join(" or ")}` });
  },
}));

vi.mock("../src/modules/discard/discard.service.js", () => ({
  discardService: { previewLeave, previewRegularization, discardLeave, discardRegularization, listDiscards },
}));

import { discardRouter } from "../src/modules/discard/discard.routes.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/discard", discardRouter);
  // Mirror the real errorHandler's contract for thrown statusCode errors.
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.statusCode ?? 500).json({ success: false, message: err?.message, errorCode: err?.code ?? null });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentRoles.value = ["super_admin"];
});

describe("POST /api/discard/leave/:id — validation", () => {
  it("rejects a missing reason", async () => {
    const res = await request(makeApp()).post("/api/discard/leave/lr-1").send({});
    expect(res.status).toBe(400);
    expect(discardLeave).not.toHaveBeenCalled();
  });

  it("rejects a reason shorter than 10 characters", async () => {
    const res = await request(makeApp()).post("/api/discard/leave/lr-1").send({ reason: "oops" });
    expect(res.status).toBe(400);
    expect(res.body.errors?.reason?.[0]).toMatch(/at least 10 characters/i);
    expect(discardLeave).not.toHaveBeenCalled();
  });

  it("accepts a proper reason and passes it through untouched", async () => {
    discardLeave.mockResolvedValue({
      discardId: "d1", entityType: "leave", entityId: "lr-1", employeeId: "emp-1",
      restoreMode: "snapshot", daysRestored: 3, balanceBefore: 7, balanceAfter: 10,
      datesRestored: 3, datesDeleted: 0, datesSkipped: 0, attendance: [], warnings: [],
      payrollRecalcStatus: "2026-07:recalculated",
    });
    const res = await request(makeApp())
      .post("/api/discard/leave/lr-1")
      .send({ reason: "approved against the wrong employee" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/3 day\(s\) credited back/);
    expect(discardLeave).toHaveBeenCalledWith(
      "lr-1",
      expect.objectContaining({ userId: "u1" }),
      "approved against the wrong employee"
    );
  });

  it("surfaces a service blocker with its status code", async () => {
    discardLeave.mockRejectedValue(
      Object.assign(new Error("Payroll is closed for 2026-04 (FINALIZED)."), {
        statusCode: 409, code: "PAYROLL_MONTH_CLOSED",
      })
    );
    const res = await request(makeApp())
      .post("/api/discard/leave/lr-1")
      .send({ reason: "duplicate approval by mistake" });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe("PAYROLL_MONTH_CLOSED");
  });
});

describe("/api/discard — role gate", () => {
  const cases: Array<[string, string[], number]> = [
    ["super_admin", ["super_admin"], 200],
    ["wfm", ["wfm"], 200],
    ["hr", ["hr"], 403],
    ["manager", ["manager"], 403],
    ["employee", ["employee"], 403],
    ["payroll_head", ["payroll_head"], 403],
  ];

  for (const [label, roles, expected] of cases) {
    it(`${label} → ${expected} on discard`, async () => {
      currentRoles.value = roles;
      discardLeave.mockResolvedValue({
        discardId: "d1", entityType: "leave", entityId: "lr-1", employeeId: "emp-1",
        restoreMode: "snapshot", daysRestored: 1, balanceBefore: 1, balanceAfter: 2,
        datesRestored: 1, datesDeleted: 0, datesSkipped: 0, attendance: [], warnings: [],
        payrollRecalcStatus: null,
      });
      const res = await request(makeApp())
        .post("/api/discard/leave/lr-1")
        .send({ reason: "wrong employee selected" });
      expect(res.status).toBe(expected);
      if (expected === 403) expect(discardLeave).not.toHaveBeenCalled();
    });
  }

  it("blocks a non-privileged role from even previewing", async () => {
    currentRoles.value = ["hr"];
    const res = await request(makeApp()).get("/api/discard/preview/leave/lr-1");
    expect(res.status).toBe(403);
    expect(previewLeave).not.toHaveBeenCalled();
  });
});

describe("dispute endpoints reuse the regularization path", () => {
  it("POST /dispute/:id calls discardRegularization", async () => {
    discardRegularization.mockResolvedValue({
      discardId: "d2", entityType: "dispute", entityId: "reg-1", employeeId: "emp-1",
      restoreMode: "delete", daysRestored: null, balanceBefore: null, balanceAfter: null,
      datesRestored: 0, datesDeleted: 1, datesSkipped: 0,
      attendance: [{ date: "2026-07-15", currentStatus: "present", currentLwp: 0, mode: "delete", restoredStatus: null, restoredLwp: null }],
      warnings: [], payrollRecalcStatus: null,
    });
    const res = await request(makeApp())
      .post("/api/discard/dispute/reg-1")
      .send({ reason: "employee was not actually working from home" });

    expect(res.status).toBe(200);
    expect(discardRegularization).toHaveBeenCalled();
    expect(res.body.message).toMatch(/dispute discarded/i);
  });

  it("GET /preview/dispute/:id calls previewRegularization", async () => {
    previewRegularization.mockResolvedValue({ entityType: "dispute", blockers: [], attendance: [] });
    const res = await request(makeApp()).get("/api/discard/preview/dispute/reg-1");
    expect(res.status).toBe(200);
    expect(previewRegularization).toHaveBeenCalledWith("reg-1", expect.objectContaining({ userId: "u1" }));
  });
});

describe("GET /api/discard/history", () => {
  it("applies pagination defaults and returns meta", async () => {
    listDiscards.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25 });
    const res = await request(makeApp()).get("/api/discard/history");
    expect(res.status).toBe(200);
    expect(listDiscards).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 25 }));
    expect(res.body.meta).toEqual({ total: 0, page: 1, limit: 25 });
  });

  it("rejects an out-of-range limit rather than silently clamping", async () => {
    const res = await request(makeApp()).get("/api/discard/history?limit=5000");
    expect(res.status).toBe(400);
    expect(listDiscards).not.toHaveBeenCalled();
  });

  it("rejects a malformed date filter", async () => {
    const res = await request(makeApp()).get("/api/discard/history?fromDate=15-07-2026");
    expect(res.status).toBe(400);
  });
});
