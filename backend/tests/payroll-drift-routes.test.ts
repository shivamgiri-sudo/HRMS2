import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Use vi.hoisted so mock factories are available before imports
const { mockExecute, mockRecalc } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockRecalc: vi.fn(),
}));

vi.mock("../src/db/mysql.js", () => ({ db: { execute: mockExecute } }));

vi.mock("../src/modules/payroll/payroll-targeted-recalculation.service.js", () => ({
  recalculateOpenPayrollForEmployee: mockRecalc,
  drainPayrollRecalcQueue: vi.fn().mockResolvedValue({ processed: 0, failed: 0, skipped_locked: 0 }),
}));

// Mock auth middleware so routes don't require real tokens
vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../src/middleware/authMiddleware.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => {
    (_req as any).authUser = { id: "test-user-id", email: "test@test.com" };
    next();
  },
}));

// Other dependencies imported by the router
vi.mock("../src/shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(),
  hasRole: vi.fn().mockResolvedValue(true),
}));

import { payrollMoreRouter } from "../src/modules/payroll/payroll-more.routes.js";

const app = express();
app.use(express.json());
app.use("/api/payroll", payrollMoreRouter);

beforeEach(() => { vi.clearAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/payroll/runs/:runId/drift-check", () => {
  it("returns drift rows when attendance differs from stored", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-07", attendance_snapshot_locked: 0 }]])
      .mockResolvedValueOnce([[
        {
          employee_id: "emp-1", employee_code: "MAS001",
          first_name: "A", last_name: "B",
          branch_name: "HQ", process_name: "Inbound",
          stored_paid_days: 25, live_paid_days: 26, diff: 1,
        },
      ]]);

    const res = await request(app).get("/api/payroll/runs/run-1/drift-check");
    expect(res.status).toBe(200);
    expect(res.body.data.total_drifted).toBe(1);
    expect(res.body.data.underpaid_count).toBe(1);
    expect(res.body.data.overpaid_count).toBe(0);
    expect(res.body.data.snapshot_locked).toBe(false);
    expect(res.body.data.rows[0].employee_code).toBe("MAS001");
    expect(res.body.data.rows[0].direction).toBe("underpaid");
  });

  it("returns 404 when run does not exist", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // empty run rows
    const res = await request(app).get("/api/payroll/runs/bad-id/drift-check");
    expect(res.status).toBe(404);
  });

  it("returns 409 when snapshot is locked", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-07", attendance_snapshot_locked: 1 }]]);
    const res = await request(app).get("/api/payroll/runs/run-1/drift-check");
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it("returns empty rows when no drift detected", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-07", attendance_snapshot_locked: 0 }]])
      .mockResolvedValueOnce([[]]); // no drift rows
    const res = await request(app).get("/api/payroll/runs/run-1/drift-check");
    expect(res.status).toBe(200);
    expect(res.body.data.total_drifted).toBe(0);
    expect(res.body.data.rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/payroll/runs/:runId/recalculate-drift", () => {
  it("recalculates all drifted employees when no employee_ids given", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-07", attendance_snapshot_locked: 0 }]])
      .mockResolvedValueOnce([[
        { employee_id: "emp-1" },
        { employee_id: "emp-2" },
      ]]);
    mockRecalc.mockResolvedValue({ status: "recalculated", runId: "run-1", message: "ok" });

    const res = await request(app).post("/api/payroll/runs/run-1/recalculate-drift").send({});
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(2);
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.total).toBe(2);
    expect(mockRecalc).toHaveBeenCalledTimes(2);
  });

  it("recalculates only specified employee_ids when provided", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-07", attendance_snapshot_locked: 0 }]]);
    mockRecalc.mockResolvedValue({ status: "recalculated", runId: "run-1", message: "ok" });

    const res = await request(app)
      .post("/api/payroll/runs/run-1/recalculate-drift")
      .send({ employee_ids: ["emp-3"] });
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(1);
    expect(mockRecalc).toHaveBeenCalledTimes(1);
    expect(mockRecalc.mock.calls[0][0].employeeId).toBe("emp-3");
  });

  it("returns 409 when snapshot is locked", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-07", attendance_snapshot_locked: 1 }]]);
    const res = await request(app).post("/api/payroll/runs/run-1/recalculate-drift").send({});
    expect(res.status).toBe(409);
  });

  it("counts skipped_locked when recalc returns queued status", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "run-1", run_month: "2026-07", attendance_snapshot_locked: 0 }]])
      .mockResolvedValueOnce([[{ employee_id: "emp-1" }]]);
    mockRecalc.mockResolvedValue({ status: "queued", runId: "run-1", message: "run is closed" });

    const res = await request(app).post("/api/payroll/runs/run-1/recalculate-drift").send({});
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(0);
    expect(res.body.data.skipped_locked).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/payroll/recalculation-queue/:id/retry", () => {
  it("re-inserts a failed entry as a new pending entry", async () => {
    mockExecute
      .mockResolvedValueOnce([[{
        id: "q-1", employee_id: "emp-1",
        payroll_month: "2026-07-01", reason: "cosec_sync", status: "failed",
      }]])
      .mockResolvedValueOnce([[]]); // INSERT new pending

    const res = await request(app).post("/api/payroll/recalculation-queue/q-1/retry").send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.new_id).toBeDefined();

    // Verify INSERT was called with pending status in the SQL
    const insertCall = mockExecute.mock.calls.find(
      ([sql]: [string]) => /INSERT INTO payroll_recalculation_queue/i.test(sql),
    );
    expect(insertCall).toBeDefined();
    // params array: [newId, employee_id, payroll_month, reason, actor_user_id]
    // 'pending' is embedded in the SQL text itself, not in the params
    expect(insertCall[0]).toMatch(/'pending'/i);
  });

  it("returns 404 when queue item not found", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // no rows
    const res = await request(app).post("/api/payroll/recalculation-queue/nonexistent/retry").send({});
    expect(res.status).toBe(404);
  });

  it("returns 409 when entry is not in failed state", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "q-1", status: "completed" }]]);
    const res = await request(app).post("/api/payroll/recalculation-queue/q-1/retry").send({});
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/completed/);
  });

  it("returns 409 when entry is pending (not failed)", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "q-2", status: "pending" }]]);
    const res = await request(app).post("/api/payroll/recalculation-queue/q-2/retry").send({});
    expect(res.status).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/payroll/recalculation-queue/:id/cancel", () => {
  it("marks a pending entry as skipped_locked", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "q-1", status: "pending" }]])
      .mockResolvedValueOnce([[]]); // UPDATE

    const res = await request(app).post("/api/payroll/recalculation-queue/q-1/cancel").send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updateCall = mockExecute.mock.calls.find(
      ([sql]: [string]) => /UPDATE payroll_recalculation_queue/i.test(sql),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toMatch(/skipped_locked/);
  });

  it("returns 404 when queue item not found", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // no rows
    const res = await request(app).post("/api/payroll/recalculation-queue/nonexistent/cancel").send({});
    expect(res.status).toBe(404);
  });

  it("returns 409 when entry is not pending", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "q-1", status: "failed" }]]);
    const res = await request(app).post("/api/payroll/recalculation-queue/q-1/cancel").send({});
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/failed/);
  });

  it("returns 409 when entry is already completed", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "q-1", status: "completed" }]]);
    const res = await request(app).post("/api/payroll/recalculation-queue/q-1/cancel").send({});
    expect(res.status).toBe(409);
  });
});
