import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const assignEmployeeMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "assign-1" }));
const getShiftTemplateTimesMock = vi.hoisted(() => vi.fn());
vi.mock("../roster.service.js", () => ({ rosterService: { assignEmployee: assignEmployeeMock } }));
vi.mock("../roster-builder.service.js", () => ({
  getRosterGrid: vi.fn(),
  getShiftTemplateTimes: getShiftTemplateTimesMock,
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "user-1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import { rosterBuilderRouter } from "../roster-builder.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/wfm/roster-builder", rosterBuilderRouter);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  assignEmployeeMock.mockResolvedValue({ id: "assign-1" });
  getShiftTemplateTimesMock.mockResolvedValue({ startTime: "21:00:00", endTime: "06:00:00" });
});

describe("POST /assign", () => {
  it("calls assignEmployee with cycleId threaded through", async () => {
    const res = await request(app())
      .post("/api/wfm/roster-builder/assign")
      .send({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1", shiftTemplateId: "shift-1" });

    expect(res.status).toBe(201);
    expect(assignEmployeeMock).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1", shiftTemplateId: "shift-1" }),
      "user-1"
    );
  });

  it("returns 400 when employeeId is missing", async () => {
    const res = await request(app())
      .post("/api/wfm/roster-builder/assign")
      .send({ rosterDate: "2026-08-24", cycleId: "cycle-1" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when cycleId is missing", async () => {
    const res = await request(app())
      .post("/api/wfm/roster-builder/assign")
      .send({ employeeId: "emp-1", rosterDate: "2026-08-24" });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Minimum-rest guard. roster.service.ts validates rest only
// `if (input.shiftStartTime && input.shiftEndTime && await isRestPolicyFeatureActive(conn))`.
// This route originally passed neither, so every builder write skipped the guard that roster
// generation, bulk upload and shift swap all enforce. These tests fail against that version.
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("POST /assign — minimum-rest guard", () => {
  it("resolves the template's own times and passes them, so the rest check actually runs", async () => {
    const res = await request(app())
      .post("/api/wfm/roster-builder/assign")
      .send({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1", shiftTemplateId: "tpl-night" });

    expect(res.status).toBe(201);
    expect(getShiftTemplateTimesMock).toHaveBeenCalledWith("tpl-night");
    expect(assignEmployeeMock).toHaveBeenCalledWith(
      expect.objectContaining({ shiftStartTime: "21:00:00", shiftEndTime: "06:00:00" }),
      "user-1"
    );
  });

  it("never passes a null time alongside a shift template — the exact shape that silently skipped the guard", async () => {
    await request(app())
      .post("/api/wfm/roster-builder/assign")
      .send({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1", shiftTemplateId: "tpl-night" });

    const input = assignEmployeeMock.mock.calls[0][0];
    expect(input.shiftTemplateId).toBeTruthy();
    // toBeTruthy, not not.toBeNull: the pre-fix route omitted these keys entirely, and
    // `expect(undefined).not.toBeNull()` would have passed against the very defect this guards.
    expect(input.shiftStartTime).toBeTruthy();
    expect(input.shiftEndTime).toBeTruthy();
  });

  it("takes the times from the template, never from the request body", async () => {
    await request(app())
      .post("/api/wfm/roster-builder/assign")
      .send({
        employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1", shiftTemplateId: "tpl-night",
        // A caller trying to pick the answer to its own safety check.
        shiftStartTime: "09:00:00", shiftEndTime: "18:00:00",
      });

    expect(assignEmployeeMock).toHaveBeenCalledWith(
      expect.objectContaining({ shiftStartTime: "21:00:00", shiftEndTime: "06:00:00" }),
      "user-1"
    );
  });

  it("refuses a template id that resolves to no template, instead of assigning a shift that does not exist", async () => {
    getShiftTemplateTimesMock.mockResolvedValue(null);

    const res = await request(app())
      .post("/api/wfm/roster-builder/assign")
      .send({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1", shiftTemplateId: "tpl-missing" });

    expect(res.status).toBe(400);
    expect(assignEmployeeMock).not.toHaveBeenCalled();
  });

  it("clearing a cell (no template) needs no lookup and passes nulls through, as before", async () => {
    const res = await request(app())
      .post("/api/wfm/roster-builder/assign")
      .send({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1" });

    expect(res.status).toBe(201);
    expect(getShiftTemplateTimesMock).not.toHaveBeenCalled();
    expect(assignEmployeeMock).toHaveBeenCalledWith(
      expect.objectContaining({ shiftTemplateId: null, shiftStartTime: null, shiftEndTime: null }),
      "user-1"
    );
  });

  it("lets the service's own rest refusal surface rather than swallowing it", async () => {
    const err: any = new Error("Assignment blocked: only 60 minutes rest against the previous shift");
    err.statusCode = 422;
    err.code = "INSUFFICIENT_REST";
    assignEmployeeMock.mockRejectedValue(err);

    const a = app();
    // Mirrors the app's own error handler contract: statusCode on the error drives the response.
    a.use((e: any, _req: any, res: any, _next: any) => res.status(e.statusCode ?? 500).json({ error: e.message, code: e.code }));

    const res = await request(a)
      .post("/api/wfm/roster-builder/assign")
      .send({ employeeId: "emp-1", rosterDate: "2026-08-24", cycleId: "cycle-1", shiftTemplateId: "tpl-night" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INSUFFICIENT_REST");
  });
});
