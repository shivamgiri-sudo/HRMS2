import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  submitRequest: vi.fn(),
  completeTask: vi.fn(),
  getById: vi.fn(),
  isHr: true,
}));

vi.mock("../dpdp-withdrawal.service.js", async (orig) => ({
  ...(await orig<typeof import("../dpdp-withdrawal.service.js")>()),
  submitRequest: m.submitRequest,
  completeTask: m.completeTask,
  getById: m.getById,
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _r: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _r: any, next: any) => next() }));
vi.mock("../dpdp-withdrawal.scope.js", () => ({
  buildRequesterScope: vi.fn(async () => null),
  withdrawalScopeGuard: (_q: any, _s: any, next: any) => next(),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: vi.fn(async () => m.isHr) }));

import { dpdpWithdrawalRouter } from "../dpdp-withdrawal.routes.js";
const app = express();
app.use(express.json());
app.use("/api/privacy", dpdpWithdrawalRouter);
app.use((err: any, _q: any, res: any, _n: any) => res.status(err.statusCode ?? 500).json({ message: err.message }));

beforeEach(() => {
  Object.values(m).forEach((f) => typeof f === "function" && (f as any).mockReset?.());
  m.isHr = true;
  m.submitRequest.mockResolvedValue({ id: "i", request_ref: "WDR-1", sla_due_at: "2026-10-06T00:00:00.000Z" });
});

describe("POST /dpdp-withdrawal/request", () => {
  it("accepts a request with no reason and returns the reference and decision deadline", async () => {
    const r = await request(app).post("/api/privacy/dpdp-withdrawal/request").send({ scope_json: ["biometric_data"] });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({ id: "i", request_ref: "WDR-1", sla_due_at: "2026-10-06T00:00:00.000Z" });
    expect(m.submitRequest).toHaveBeenCalledWith("u1", "employee", ["biometric_data"], "", "self", expect.any(Object));
  });
  it("rejects unknown categories and channels with 400 before touching the database", async () => {
    expect((await request(app).post("/api/privacy/dpdp-withdrawal/request").send({ scope_json: ["x"] })).status).toBe(400);
    expect((await request(app).post("/api/privacy/dpdp-withdrawal/request").send({ channel: "x" })).status).toBe(400);
    expect(m.submitRequest).not.toHaveBeenCalled();
  });
  it("surfaces the duplicate-open 409 message to the caller", async () => {
    m.submitRequest.mockRejectedValue(Object.assign(new Error("You already have an open withdrawal request (WDR-9)."), { statusCode: 409 }));
    const r = await request(app).post("/api/privacy/dpdp-withdrawal/request").send({});
    expect(r.status).toBe(409);
    expect(r.body.message).toContain("WDR-9");
  });
});

describe("PATCH /dpdp-withdrawal/:id/tasks/:taskId", () => {
  it("passes the URL's withdrawal id so a task of another request cannot be completed", async () => {
    m.completeTask.mockResolvedValue(false);
    const r = await request(app).patch("/api/privacy/dpdp-withdrawal/w1/tasks/t9").send({});
    expect(r.status).toBe(404);
    expect(m.completeTask).toHaveBeenCalledWith("t9", "u1", undefined, "w1");
  });
  it("200 when the task belongs to it", async () => {
    m.completeTask.mockResolvedValue(true);
    expect((await request(app).patch("/api/privacy/dpdp-withdrawal/w1/tasks/t1").send({ notes: "done" })).status).toBe(200);
  });
});

describe("GET /dpdp-withdrawal/:id role handling", () => {
  it("uses held roles (a super_admin / multi-role reviewer is treated as HR)", async () => {
    m.getById.mockResolvedValue({ id: "w1" });
    await request(app).get("/api/privacy/dpdp-withdrawal/w1");
    expect(m.getById).toHaveBeenCalledWith("w1", "u1", true, true);
  });
  it("a plain employee is not HR, so getById applies the own-record rule", async () => {
    m.isHr = false;
    m.getById.mockResolvedValue(null);
    const r = await request(app).get("/api/privacy/dpdp-withdrawal/w1");
    expect(m.getById).toHaveBeenCalledWith("w1", "u1", false, true);
    expect(r.status).toBe(404);
  });
});
