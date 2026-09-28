import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "user-1" };
    next();
  },
}));
vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: async () => ({ roleKeys: ["manager"], primaryRole: "manager" }),
}));

const mockAssertAccess = vi.fn().mockResolvedValue(undefined);
const mockGetContext = vi.fn();
const mockConfirm = vi.fn();
const mockReject = vi.fn();

vi.mock("../work-inbox.service.js", async () => {
  const actual = await vi.importActual<typeof import("../work-inbox.service.js")>(
    "../work-inbox.service.js",
  );
  return { ...actual, assertWorkItemAccess: (...args: unknown[]) => mockAssertAccess(...args) };
});
vi.mock("../awol-confirm.service.js", () => ({
  getAwolContext: (...args: unknown[]) => mockGetContext(...args),
  confirmAwolAbsconding: (...args: unknown[]) => mockConfirm(...args),
  rejectAwolSuspected: (...args: unknown[]) => mockReject(...args),
}));

import { workInboxRouter } from "../work-inbox.routes.js";

const app = express();
app.use(express.json());
app.use("/api/work-inbox", workInboxRouter);

describe("AWOL confirm routes", () => {
  beforeEach(() => {
    mockAssertAccess.mockClear();
    mockGetContext.mockReset();
    mockConfirm.mockReset();
    mockReject.mockReset();
  });

  it("GET /:id/awol-context returns the derived context", async () => {
    mockGetContext.mockResolvedValueOnce({
      employeeId: "emp-1",
      employeeName: "Jane Doe",
      lastWorkedDate: "2026-09-10",
    });
    const res = await request(app).get("/api/work-inbox/wi-1/awol-context");
    expect(res.status).toBe(200);
    expect(res.body.data.lastWorkedDate).toBe("2026-09-10");
  });

  it("POST /:id/awol/confirm creates the exit and returns its id", async () => {
    mockConfirm.mockResolvedValueOnce({ exitRequestId: "exit-1" });
    const res = await request(app)
      .post("/api/work-inbox/wi-1/awol/confirm")
      .send({ lastWorkedDate: "2026-09-10", remarks: "confirmed" });
    expect(res.status).toBe(200);
    expect(res.body.data.exitRequestId).toBe("exit-1");
    expect(mockAssertAccess).toHaveBeenCalledWith("user-1", "wi-1", "complete");
  });

  it("POST /:id/awol/reject requires remarks and returns success", async () => {
    const res = await request(app).post("/api/work-inbox/wi-1/awol/reject").send({ remarks: "on leave" });
    expect(res.status).toBe(200);
    expect(mockReject).toHaveBeenCalledWith("wi-1", "user-1", "on leave");
  });
});
