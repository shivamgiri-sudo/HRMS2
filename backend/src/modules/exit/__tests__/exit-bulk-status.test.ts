import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/exit/bulk-status — one request for a whole selection.
 *
 * The Bulk Actions tab used to PATCH /:id/status once per employee, sequentially, and swallow
 * every error. This proves the replacement: the same per-exit rules still decide each row, a
 * refused row reports WHY, and the selection is processed concurrently rather than serially.
 */

const ACTOR = "user-admin";
const PER_ITEM_MS = 100;

// exit id -> current status; anything not listed is treated as manager_review.
const current: Record<string, string> = {};

const { updateExitStatus, dbExecute } = vi.hoisted(() => ({
  updateExitStatus: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 100));
    return { id: "x", status: "accepted" };
  }),
  dbExecute: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));
vi.mock("../exit.service.js", () => ({ exitService: { updateExitStatus } }));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-actor" })),
  hasRole: vi.fn(async () => true),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee: vi.fn(async () => true) }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "admin", "ceo"],
  hasAnyRole: vi.fn(async () => true),
  hasScopedAccess: vi.fn(async () => true),
  buildScopeWhereClause: vi.fn(async () => ({ sql: "1=1", params: [] })),
}));
vi.mock("../../../shared/reportingSpan.js", () => ({
  hasDirectReports: vi.fn(async () => false),
  reportingSpanClause: vi.fn(() => ({ sql: "1=1", params: [] })),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: ACTOR }; next(); },
}));

const { exitSecureRouter } = await import("../exit.secure.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/exit", exitSecureRouter);
  return a;
}

beforeEach(() => {
  updateExitStatus.mockClear();
  dbExecute.mockReset();
  for (const k of Object.keys(current)) delete current[k];
  dbExecute.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/AS current_status/.test(sql)) {
      const id = String(params[2]);
      return [[{
        current_status: current[id] ?? "manager_review",
        employee_id: `emp-${id}`,
        roles: "admin",
        is_reporting_manager: 0,
      }], []];
    }
    return [[], []];
  });
});

const bulk = (body: Record<string, unknown>) =>
  request(app()).post("/api/exit/bulk-status").send(body);

describe("POST /bulk-status", () => {
  it("applies one status to every id in a single request, concurrently", async () => {
    const ids = Array.from({ length: 16 }, (_, i) => `e${i}`);
    const t0 = Date.now();
    const res = await bulk({ ids, status: "accepted", remarks: "Bulk action: accepted" });
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, total: 16, succeeded: 16, failed: 0 });
    expect(updateExitStatus).toHaveBeenCalledTimes(16);
    // Serial would be 16 x 100ms = 1600ms. 8 workers -> 2 waves ~ 200ms.
    expect(elapsed).toBeLessThan(900);
  });

  it("still enforces the FSM per row and says why a row was refused", async () => {
    current.bad = "submitted"; // submitted -> exited is not a legal transition
    const res = await bulk({ ids: ["ok1", "bad", "ok2"], status: "exited", remarks: "Bulk action: exited" });
    // ok1/ok2 are manager_review, which also cannot go straight to exited.
    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(3);
    const bad = res.body.results.find((r: any) => r.id === "bad");
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(409);
    expect(bad.message).toMatch(/Invalid exit transition: submitted → exited/);
    expect(updateExitStatus).not.toHaveBeenCalled();
  });

  it("reports a mix: legal rows succeed, illegal rows fail, none abort the batch", async () => {
    current.late = "notice_serving"; // notice_serving -> accepted is illegal
    const res = await bulk({ ids: ["a", "late", "b"], status: "accepted", remarks: "r" });
    expect(res.body).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    expect(res.body.results.find((r: any) => r.id === "late").message).toMatch(/Invalid exit transition/);
    expect(updateExitStatus).toHaveBeenCalledTimes(2);
  });

  it("requires remarks for a non-revoke status, per row", async () => {
    const res = await bulk({ ids: ["a"], status: "accepted" });
    expect(res.body.failed).toBe(1);
    expect(res.body.results[0].message).toMatch(/Remarks are required/);
  });

  it("de-duplicates ids and rejects an empty or oversized list", async () => {
    expect((await bulk({ ids: [], status: "accepted" })).status).toBe(400);
    expect((await bulk({ status: "accepted" })).status).toBe(400);
    const many = Array.from({ length: 501 }, (_, i) => `e${i}`);
    expect((await bulk({ ids: many, status: "accepted", remarks: "r" })).status).toBe(400);
    const res = await bulk({ ids: ["a", "a", "a"], status: "accepted", remarks: "r" });
    expect(res.body.total).toBe(1);
  });
});
